import axios from "axios";
import { getSupabaseClient } from "./supabase";


const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://iainvestmentadvisor-production.up.railway.app"
    : "http://localhost:8000");

const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401 (mirrors mobile SecureStore flow but with localStorage)
let isRefreshing = false;
let failedQueue: Array<{ resolve: (t: string) => void; reject: (e: unknown) => void }> = [];

const flushQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    const status = error.response?.status;
    if (status !== 401 || original._retry) return Promise.reject(error);

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = localStorage.getItem("refresh_token");
      if (!refreshToken) {
        isRefreshing = false;
        flushQueue(error);
        return Promise.reject(error);
      }
      const res = await axios.post(`${BASE_URL}/api/auth/refresh`, { refresh_token: refreshToken });
      const { access_token, refresh_token: newRefresh } = res.data;
      localStorage.setItem("access_token", access_token);
      localStorage.setItem("refresh_token", newRefresh);
      api.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
      original.headers.Authorization = `Bearer ${access_token}`;
      flushQueue(null, access_token);
      return api(original);
    } catch (refreshErr) {
      // Only clear tokens when the server explicitly rejects them (expired/invalid).
      // For network errors or server outages, preserve tokens so the user stays logged
      // in and can retry when connectivity is restored.
      const refreshStatus = (refreshErr as { response?: { status?: number } })?.response?.status;
      if (refreshStatus === 401 || refreshStatus === 403) {
        // Before clearing tokens, try Supabase native session — handles multi-tab
        // race condition where another tab already refreshed and stored new tokens.
        try {
          const { data: { session } } = await getSupabaseClient().auth.getSession();
          if (session?.access_token) {
            localStorage.setItem("access_token", session.access_token);
            if (session.refresh_token) localStorage.setItem("refresh_token", session.refresh_token);
            api.defaults.headers.common["Authorization"] = `Bearer ${session.access_token}`;
            original.headers.Authorization = `Bearer ${session.access_token}`;
            flushQueue(null, session.access_token);
            return api(original);
          }
        } catch {}
        // Supabase also has no session — truly expired, clear tokens and force logout
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        import("./store").then(({ useAuthStore }) => useAuthStore.getState().clearAuth()).catch(() => {});
      }
      flushQueue(refreshErr);
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

export const auth = {
  register: (email: string, password: string) =>
    api.post("/api/auth/register", { email, password }),
  login: (email: string, password: string) =>
    api.post("/api/auth/login", { email, password }),
  logout: () => api.post("/api/auth/logout"),
  deleteAccount: () => api.delete("/api/auth/account"),
  forgotPassword: (email: string) =>
    api.post("/api/auth/forgot-password", { email }),
  forgotPasswordSms: (email: string, phone: string) =>
    api.post("/api/auth/forgot-password-sms", { email, phone }),
  resetPassword: (email: string, code: string, new_password: string, phone?: string) =>
    api.post("/api/auth/reset-password", { email, code, new_password, ...(phone ? { phone } : {}) }),
};

export const profile = {
  get: () => api.get("/api/profile"),
  create: (data: Record<string, unknown>) => api.post("/api/profile", data),
  update: (data: Record<string, unknown>) => api.put("/api/profile", data),
  uploadAvatar: (imageBase64: string) =>
    api.post("/api/profile/avatar", { image_base64: imageBase64 }),
  deleteAvatar: () => api.delete("/api/profile/avatar"),
};

export const chat = {
  getHistory: (since?: string) => api.get("/api/chat/history", since ? { params: { since } } : undefined),
  saveMessage: (role: string, content: string, sessionId?: string | null) =>
    api.post("/api/chat/save-message", { role, content, session_id: sessionId }),
  transcribe: (blob: Blob) => {
    const form = new FormData();
    form.append("audio", blob, "recording.webm");
    return api.post("/api/chat/transcribe", form, { headers: { "Content-Type": "multipart/form-data" } });
  },
  speak: (text: string) => api.post("/api/chat/speak", { text }),

  stream: async (
    message: string,
    history: Array<{ role: string; content: string }>,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    onAssessment?: (a: { s: number; p: string; sig: string[]; conf: string }) => void,
    onTickers?: (tickers: string[]) => void,
    mentor?: string | null,
    cancelSignal?: { cancelled: boolean },
    imageData?: string | null,
    imageType?: string | null,
    images?: Array<{ data: string; type: string }> | null,
    notificationContext?: string | null,
    onActions?: (actions: Array<{ type: string; label: string; data: Record<string, unknown> }>) => void,
  ) => {
    const res = await api.post("/api/chat/message", {
      message,
      conversation_history: history,
      mentor: mentor ?? null,
      image_data: imageData ?? null,
      image_type: imageType ?? null,
      images: images ?? [],
      notification_context: notificationContext ?? null,
    });
    const reply: string = res.data.reply ?? "";
    const assessment = res.data.risk_assessment ?? null;
    const tickers: string[] = res.data.tickers ?? [];
    const actions = res.data.actions ?? null;
    const words = reply.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (cancelSignal?.cancelled) break;
      onChunk((i === 0 ? "" : " ") + words[i]);
      await new Promise((r) => setTimeout(r, 8));
    }
    if (!cancelSignal?.cancelled) {
      if (assessment && onAssessment) onAssessment(assessment);
      if (tickers.length > 0 && onTickers) onTickers(tickers);
      if (actions && onActions) onActions(actions);
    }
    onDone();
  },
};

export const market = {
  getSummary: () => api.get("/api/market/summary"),
  getIndices: () => api.get("/api/market/indices"),
  getAsset: (symbol: string) => api.get(`/api/market/asset/${symbol}`),
  getPrices: (symbols: string[]) => api.post("/api/market/prices", { symbols }),
  analyze: (symbols: string[]) => api.post("/api/market/analyze", { symbols }),
  getPortfolio: (
    scenario: string,
    capital?: number,
    positions?: { ticker: string; shares: number; avg_price: number; name?: string }[]
  ) => api.post("/api/market/portfolio", { scenario, capital, positions }),
  analyzePortfolio: (positions: { ticker: string; shares: number; avg_price: number; name?: string; current_price?: number }[]) =>
    api.post("/api/simulate/analyze-portfolio", { positions }),
  analyzeScreenshot: (imageData: string, imageType: string, currency = "USD") =>
    api.post("/api/market/portfolio/from-screenshot", { image: imageData, type: imageType, currency }),
  analyzePdf: (file: File, currency = "USD") => {
    const form = new FormData();
    form.append("file", file);
    form.append("currency", currency);
    return api.post("/api/market/portfolio/from-pdf", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  getMovers: (threshold?: number) =>
    api.get("/api/market/movers", { params: { threshold } }),
  getEarnings: () => api.get("/api/market/earnings"),
  getChart: (ticker: string, period = "1d") =>
    api.get(`/api/market/chart/${encodeURIComponent(ticker)}`, { params: { period } }),
  getNews: (symbols: string[]) =>
    api.get("/api/market/news", { params: { symbols: symbols.join(",") } }),
  getIndexNews: (symbol: string) =>
    api.get("/api/market/index-news", { params: { symbol } }),
  alertContext: (ticker: string, change_pct: number) =>
    api.post("/api/market/screener/alert-context", { ticker, change_pct }),
  searchTickers: (q: string) => api.get("/api/market/search", { params: { q } }),
  getQuoteDetails: (symbols: string[]) =>
    api.get("/api/market/quote-details", { params: { symbols: symbols.join(",") } }),
  getStockDetail: (symbol: string, includeScore = false) =>
    api.get(`/api/market/stock-detail/${encodeURIComponent(symbol)}`, {
      params: includeScore ? { include_score: true } : undefined,
    }),
  getStockScore: (symbol: string) =>
    api.get(`/api/market/stock-score/${encodeURIComponent(symbol)}`),
  getIncomeAnalysis: (symbol: string) =>
    api.get(`/api/market/stock-income-analysis/${encodeURIComponent(symbol)}`),
  getPeers: (symbol: string) =>
    api.get(`/api/market/peers/${encodeURIComponent(symbol)}`),
  getFxRate: (to: string) =>
    api.get("/api/market/fx-rate", { params: { to } }),
  summarizeNews: (title: string, url: string) =>
    api.post("/api/market/summarize-news", { title, url }),
  screener: (sector: string | null, query: string) =>
    api.post("/api/market/screener", { sector, query }),
  getPortfolioReturns: (
    positions: { ticker: string; shares: number; purchase_date?: string | null; avg_price?: number | null }[],
    closedPositions?: { ticker: string; shares: number; avg_price: number; close_price: number; purchase_date?: string | null; close_date?: string | null }[],
    inceptionDate?: string | null
  ) =>
    api.post("/api/market/portfolio-returns", { positions, closed_positions: closedPositions ?? [], inception_date: inceptionDate ?? null }),
  getPortfolioChart: (positions: { ticker: string; shares: number; purchase_date?: string | null; avg_price?: number | null }[], period: string) =>
    api.post("/api/market/portfolio-chart", { positions, period }),
  getFinancials: (ticker: string, limit = 5) =>
    api.get(`/api/stocks/${encodeURIComponent(ticker)}/financials`, { params: { limit } }),
};

export const learn = {
  getScenario: (difficulty: string) => api.post("/api/learn/scenario", { difficulty }),
  submitScenarioResult: (scenarioId: string, choice: string, difficulty: string) =>
    api.post("/api/learn/scenario/result", { scenario_id: scenarioId, choice, difficulty }),
  syncStreak: (streak: number, lastLearnDate: string, completedTopicIds?: string[]) =>
    api.post("/api/learn/streak/sync", { streak, last_learn_date: lastLearnDate, completed_topic_ids: completedTopicIds }),
  claimMilestone: (days: number) =>
    api.post("/api/learn/streak/milestone-claim", { days }),
  getHallOfFame: () => api.get("/api/learn/hall-of-fame"),
};

export const insights = {
  get: () => api.get("/api/profile/insights"),
};

export const mentorLetter = {
  get: () => api.get("/api/profile/mentor-letter"),
};

export const referral = {
  getCode:    () => api.get("/api/referral/code"),
  getStats:   () => api.get("/api/referral/stats"),
  applyCode:  (code: string) => api.post("/api/referral/apply", { code }),
};

export const support = {
  chat:         (message: string, history: {role:string;content:string}[]) =>
    fetch(`${BASE_URL}/api/support/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}` },
      body: JSON.stringify({ message, history }),
    }),
  createTicket: (subject: string, message: string) => api.post("/api/support/ticket", { subject, message }),
  getTickets:   () => api.get("/api/support/tickets"),
};

export const sync = {
  getPortfolio: (portfolioId?: string) =>
    api.get("/api/sync/portfolio", { params: portfolioId ? { portfolio_id: portfolioId } : undefined }),
  pushPortfolio: (positions: unknown[], currency?: string, portfolioId?: string, portfolioName?: string) =>
    api.post("/api/sync/portfolio", {
      positions,
      currency: currency ?? "USD",
      ...(portfolioId ? { portfolio_id: portfolioId, portfolio_name: portfolioName ?? "Mi portafolio" } : {}),
    }),
  getAllPortfolios: () => api.get("/api/sync/portfolios"),
  createPortfolio: (name: string) => api.post("/api/sync/portfolios", { name }),
  renamePortfolio: (portfolioId: string, name: string) => api.put(`/api/sync/portfolios/${portfolioId}`, { name }),
  deletePortfolio: (portfolioId: string) => api.delete(`/api/sync/portfolios/${portfolioId}`),
  getAll: () => api.get("/api/sync/all"),
  pushTheme: (theme: "dark" | "light") => api.post("/api/sync/theme", { theme }),
  pushPortfolioViewMode: (mode: "basic" | "advanced") => api.post("/api/sync/portfolio-view-mode", { mode }),
  pushWatchlistViewMode: (mode: "basic" | "advanced") => api.post("/api/sync/watchlist-view-mode", { mode }),
  pushChecklistDone: () => api.post("/api/sync/checklist-done"),
  pushMaturity: (score: number, history: unknown[]) =>
    api.post("/api/sync/maturity", { score, history }),
  pushNavOrder: (order: string[]) => api.post("/api/sync/nav-order", { order }),
  getNavOrder: () => api.get("/api/sync/nav-order"),
  pushWatchlistOrder: (order: string[]) => api.post("/api/sync/watchlist-order", { order }),
  pushBehavioralRisk: (score: number) => api.post("/api/sync/behavioral-risk", { score }),
};

export const notifications = {
  getAll: () => api.get("/api/notifications"),
  markRead: (id: string) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post("/api/notifications/mark-all-read"),
};

export const billing = {
  getStatus: () => api.get("/api/billing/status"),
  createCheckout: (plan: "monthly" | "yearly" = "monthly") =>
    api.post("/api/billing/create-checkout", { plan }),
  brokerCallCheckout: (offer: "49" | "89") =>
    api.post("/api/billing/broker-call-checkout", { offer }),
  brokerOfferSeen: () => api.post("/api/billing/broker-offer-seen"),
  duoSetup: (secondary_email: string) => api.post("/api/billing/duo-setup", { secondary_email }),
  getDuoPartner: () => api.get("/api/billing/duo-partner"),
};

export const upsells = {
  checkout: (offer: string, variant: string, trigger_source: string) =>
    api.post("/api/upsells/checkout", { offer, variant, trigger_source }),
};

export const feedbackApi = {
  status: () => api.get("/api/feedback/status"),
  seen:   () => api.post("/api/feedback/seen"),
  submit: (rating: number, message?: string) =>
    api.post("/api/feedback/submit", { rating, message }),
};

export const paperApi = {
  getLeaderboard: () => api.get("/api/paper/leaderboard"),
  setAlias: (alias: string) => api.post("/api/paper/alias", { alias }),
  syncState: (cash: number, positions: unknown[], trades: unknown[], freeTradeMonth?: string | null, freeTradeCount?: number) =>
    api.post("/api/sync/paper", { cash, positions, trades, freeTradeMonth: freeTradeMonth ?? null, freeTradeCount: freeTradeCount ?? 0 }),
  analyze: (positions: unknown[], trades: unknown[], totalReturnPct: number, cash: number, portfolioValue: number) =>
    api.post("/api/paper/analyze", { positions, trades, total_return_pct: totalReturnPct, cash, portfolio_value: portfolioValue }),
};

export const earningsApi = {
  getCalendar: (symbols: string[]) =>
    api.get("/api/earnings/calendar", { params: { symbols: symbols.join(",") } }),
  getAnalysis: (symbol: string, shares = 0, avgCost = 0) =>
    api.get(`/api/earnings/analysis/${symbol}`, { params: { shares, avg_cost: avgCost } }),
};

export const screenerApi = {
  screen: (sector: string | null, query: string) =>
    api.post("/api/market/screener", { sector, query }),
  getWeekly: (existingTickers: string[] = []) =>
    api.get("/api/market/screener/weekly", { params: { tickers: existingTickers.join(",") } }),
};

export const simulateApi = {
  whatIf: (
    scenarioType: string,
    scenarioParams: Record<string, unknown>,
    portfolio: unknown[]
  ) => api.post("/api/simulate", { scenario_type: scenarioType, scenario_params: scenarioParams, portfolio }),
};

export const reportApi = {
  monthly: (portfolio: unknown[]) =>
    api.post("/api/report/monthly", { portfolio }),
};

export const decisionsApi = {
  log: (decision: Record<string, unknown>) => api.post("/api/decisions/log", decision),
  getAll: (limit = 50) => api.get("/api/decisions", { params: { limit } }),
  getBiases: () => api.get("/api/decisions/biases"),
};

export const watchlist = {
  get: () => api.get("/api/watchlist"),
  add: (ticker: string, name?: string) => api.post("/api/watchlist", { ticker, name }),
  remove: (ticker: string) => api.delete(`/api/watchlist/${encodeURIComponent(ticker)}`),
};

export const priceAlerts = {
  list: () => api.get("/api/price-alerts"),
  create: (ticker: string, targetPrice: number, condition: "above" | "below", name?: string) =>
    api.post("/api/price-alerts", { ticker, target_price: targetPrice, condition, name }),
  remove: (ticker: string) => api.delete(`/api/price-alerts/${encodeURIComponent(ticker)}`),
};

export const feedApi = {
  getClips: (params: { cursor?: number; speaker?: string; tag?: string; sort?: string }) =>
    api.get("/api/feed/clips", { params }),
  getLiked: () => api.get("/api/feed/liked"),
  like: (clipId: string) =>
    api.post(`/api/feed/clips/${clipId}/like`),
  save: (clipId: string) =>
    api.post(`/api/feed/clips/${clipId}/save`),
  view: (clipId: string, watchedPct: number) =>
    api.post(`/api/feed/clips/${clipId}/view`, { watched_pct: watchedPct }),
  getComments: (clipId: string) =>
    api.get(`/api/feed/clips/${clipId}/comments`),
  postComment: (clipId: string, text: string, parentId?: string) =>
    api.post(`/api/feed/clips/${clipId}/comments`, { text, parent_id: parentId }),
  deleteComment: (clipId: string, commentId: string) =>
    api.delete(`/api/feed/clips/${clipId}/comments/${commentId}`),

  getClip: (clipId: string) => api.get(`/api/feed/clips/${clipId}`),
  getSaved: () => api.get("/api/feed/saved"),
  downloadUrl: (clipId: string) => `${BASE_URL}/api/feed/clips/${clipId}/download`,

  // Admin
  adminList: (status = "draft") =>
    api.get("/api/feed/admin/clips", { params: { status } }),
  adminCreate: (clip: Record<string, unknown>) =>
    api.post("/api/feed/admin/clips", clip),
  adminUpdate: (clipId: string, updates: Record<string, unknown>) =>
    api.patch(`/api/feed/admin/clips/${clipId}`, updates),
  adminDelete: (clipId: string) =>
    api.delete(`/api/feed/admin/clips/${clipId}`),
  generateAudio: (clipId: string) =>
    api.post(`/api/feed/admin/clips/${clipId}/generate-audio`),
};


export const brokerageApi = {
  // Plaid
  createLinkToken: () => api.post("/api/brokerage/plaid/link-token"),
  exchangePlaidToken: (public_token: string, institution_id: string, institution_name: string) =>
    api.post("/api/brokerage/plaid/exchange", { public_token, institution_id, institution_name }),
  getPlaidHoldings: () => api.get("/api/brokerage/plaid/holdings"),

  // IOL
  connectIOL: (username: string, password: string) =>
    api.post("/api/brokerage/iol/connect", { username, password }),
  getIOLHoldings: () => api.get("/api/brokerage/iol/holdings"),

  // Management
  listConnections: () => api.get("/api/brokerage/connections"),
  deleteConnection: (id: string) => api.delete(`/api/brokerage/connections/${id}`),
  syncAll: () => api.post("/api/brokerage/sync"),
};

export const fmgApi = {
  getSummary: () => api.get("/api/fmg/summary"),
  getMemories: () => api.get("/api/fmg/memories"),
  getPatterns: () => api.get("/api/fmg/patterns"),
  getTimeline: () => api.get("/api/fmg/timeline"),
  addMemory: (type: string, content: string) =>
    api.post("/api/fmg/memories", { type, content }),
  deleteMemory: (id: string) => api.delete(`/api/fmg/memories/${id}`),
};

export const progressApi = {
  getSummary: () => api.get("/api/progress/summary"),
  getMilestones: () => api.get("/api/progress/milestones"),
  getDecisionsThatHelped: () => api.get("/api/progress/decisions-that-helped"),
  getPersonalizedMessage: () => api.get("/api/progress/personalized-message"),
};

export const benchmarkApi = {
  getMine: () => api.get("/api/benchmark/me"),
};

export const voiceCallsApi = {
  list: () => api.get("/api/voice/calls"),
  get: (id: string) => api.get(`/api/voice/calls/${id}`),
  delete: (id: string) => api.delete(`/api/voice/calls/${id}`),
};

export const adminApi = {
  getUserSnapshot: (email: string) => api.get("/api/admin/user-snapshot", { params: { email } }),
};

export default api;
