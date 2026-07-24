import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";


export const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || "https://iainvestmentadvisor-production.up.railway.app";

const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync("access_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {}
  return config;
});

// Auto-refresh on 401
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
      const refreshToken = await SecureStore.getItemAsync("refresh_token");
      if (!refreshToken) {
        isRefreshing = false;
        flushQueue(error);
        return Promise.reject(error);
      }
      const res = await axios.post(`${BASE_URL}/api/auth/refresh`, { refresh_token: refreshToken });
      const { access_token, refresh_token: newRefresh } = res.data;
      await SecureStore.setItemAsync("access_token", access_token);
      await SecureStore.setItemAsync("refresh_token", newRefresh);
      api.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
      original.headers.Authorization = `Bearer ${access_token}`;
      flushQueue(null, access_token);
      return api(original);
    } catch (refreshErr) {
      flushQueue(refreshErr);
      await SecureStore.deleteItemAsync("access_token");
      await SecureStore.deleteItemAsync("refresh_token");
      router.replace("/");
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

export const authApi = {
  login: (email: string, password: string) =>
    api.post("/api/auth/login", { email, password }),
  register: (email: string, password: string) =>
    api.post("/api/auth/register", { email, password }),
  deleteAccount: () =>
    api.delete("/api/auth/account"),
  forgotPassword: (email: string) =>
    api.post("/api/auth/forgot-password", { email }),
  forgotPasswordSms: (email: string, phone: string) =>
    api.post("/api/auth/forgot-password-sms", { email, phone }),
  resetPassword: (email: string, code: string, new_password: string, phone?: string) =>
    api.post("/api/auth/reset-password", { email, code, new_password, ...(phone ? { phone } : {}) }),
};

export const profileApi = {
  get: () => api.get("/api/profile"),
  create: (data: Record<string, unknown>) => api.post("/api/profile", data),
  update: (data: Record<string, unknown>) => api.put("/api/profile", data),
  uploadAvatar: (imageBase64: string) =>
    api.post("/api/profile/avatar", { image_base64: imageBase64 }),
  deleteAvatar: () => api.delete("/api/profile/avatar"),
};

export const chatApi = {
  getHistory: (since?: string) => api.get("/api/chat/history", since ? { params: { since } } : undefined),
  deleteHistory: (sessionId: string) => api.delete(`/api/chat/history/${encodeURIComponent(sessionId)}`),
  saveMessage: (role: string, content: string, sessionId?: string | null) =>
    api.post("/api/chat/save-message", { role, content, session_id: sessionId }),
  transcribe: (audioUri: string) => {
    const formData = new FormData();
    formData.append("audio", { uri: audioUri, name: "recording.m4a", type: "audio/m4a" } as unknown as Blob);
    return api.post("/api/chat/transcribe", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
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

export const marketApi = {
  getSummary: () => api.get("/api/market/summary"),
  analyzePortfolio: (positions: Array<{ ticker: string; shares: number; avg_price: number; name?: string; current_price?: number }>) =>
    api.post("/api/simulate/analyze-portfolio", { positions }),
  getPrices: (symbols: string[]) => api.post("/api/market/prices", { symbols }),
  searchTickers: (q: string) => api.get("/api/market/search", { params: { q } }),
  analyzeScreenshot: (base64: string, mimeType: string) =>
    api.post("/api/market/portfolio/from-screenshot", { image: base64, type: mimeType }),
  getIndices: () => api.get("/api/market/indices"),
  getIndexNews: (symbol: string) => api.get("/api/market/index-news", { params: { symbol } }),
  getChart: (ticker: string, period = "1y") =>
    api.get(`/api/market/chart/${encodeURIComponent(ticker)}`, { params: { period } }),
  screener: (sector: string | null, query: string) =>
    api.post("/api/market/screener", { sector, query }),
  alertContext: (ticker: string, change_pct: number) =>
    api.post("/api/market/screener/alert-context", { ticker, change_pct }),
  getNews: (symbols: string[]) =>
    api.get("/api/market/news", { params: { symbols: symbols.join(",") } }),
  summarizeNews: (title: string, url: string) =>
    api.post("/api/market/summarize-news", { title, url }),
  getPortfolioReturns: (
    positions: { ticker: string; shares: number; purchase_date?: string | null; avg_price?: number | null }[],
    closedPositions?: { ticker: string; shares: number; avg_price: number; close_price: number; purchase_date?: string | null; close_date?: string | null }[],
    inceptionDate?: string | null
  ) =>
    api.post("/api/market/portfolio-returns", { positions, closed_positions: closedPositions ?? [], inception_date: inceptionDate ?? null }),
  getPortfolioChart: (positions: { ticker: string; shares: number; purchase_date?: string | null; avg_price?: number | null }[], period: string) =>
    api.post("/api/market/portfolio-chart", { positions, period }),
  getHistoricalBacktest: (positions: { ticker: string; shares: number; avg_price: number }[]) =>
    api.post("/api/market/portfolio/historical-backtest", { positions }),
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
  getFinancials: (symbol: string, limit = 5) =>
    api.get(`/api/stocks/${encodeURIComponent(symbol)}/financials`, { params: { limit } }),
};

export const notificationsApi = {
  getAll: () => api.get("/api/notifications"),
  markRead: (id: string) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post("/api/notifications/mark-all-read"),
};

export const billingApi = {
  createCheckout: (plan: "monthly" | "yearly" = "monthly") => api.post("/api/billing/create-checkout", { plan }),
  getStatus: () => api.get("/api/billing/status"),
  brokerCallCheckout: () => api.post("/api/billing/broker-call-checkout"),
  brokerOfferSeen: () => api.post("/api/billing/broker-offer-seen"),
  duoSetup: (secondary_email: string) => api.post("/api/billing/duo-setup", { secondary_email }),
  getDuoPartner: () => api.get("/api/billing/duo-partner"),
};

export const upsellsApi = {
  checkout: (offer: string, variant: string, trigger_source: string, extra?: Record<string, unknown>) =>
    api.post("/api/upsells/checkout", { offer, variant, trigger_source, ...extra }),
};

export const researchApi = {
  createPlan: (requestText: string) =>
    api.post("/api/research/plan", { request_text: requestText }),
  getActiveJob: () => api.get("/api/research/jobs/active"),
  getJob: (jobId: string) => api.get(`/api/research/jobs/${jobId}`),
  listReports: () => api.get("/api/research/reports"),
  getReport: (id: string) => api.get(`/api/research/reports/${id}`),
  downloadPdfUrl: (id: string) => `${BASE_URL}/api/research/reports/${id}/pdf`,
};

export const learnApi = {
  getScenario: (difficulty: string) => api.post("/api/learn/scenario", { difficulty }),
  submitScenarioResult: (scenarioId: string, choice: string, difficulty: string) =>
    api.post("/api/learn/scenario/result", { scenario_id: scenarioId, choice, difficulty }),
  syncStreak: (streak: number, lastLearnDate: string, completedTopicIds?: string[]) =>
    api.post("/api/learn/streak/sync", { streak, last_learn_date: lastLearnDate, completed_topic_ids: completedTopicIds }),
  claimMilestone: (days: number) =>
    api.post("/api/learn/streak/milestone-claim", { days }),
  getHallOfFame: () => api.get("/api/learn/hall-of-fame"),
};

export const insightsApi = {
  get: () => api.get("/api/profile/insights"),
};

export const mentorLetterApi = {
  get: () => api.get("/api/profile/mentor-letter"),
};

export const syncApi = {
  // Single call to restore everything after login
  getAll: () => api.get("/api/sync/all"),
  // Individual push endpoints (fire-and-forget)
  pushPortfolio: (
    positions: unknown[],
    currency?: string,
    portfolioId?: string,
    portfolioName?: string,
    closedPositions?: unknown[],
    inceptionDate?: string | null,
  ) =>
    api.post("/api/sync/portfolio", {
      positions,
      currency,
      closed_positions: closedPositions ?? [],
      inception_date: inceptionDate ?? null,
      ...(portfolioId ? { portfolio_id: portfolioId, portfolio_name: portfolioName ?? "Mi portafolio" } : {}),
    }),
  getAllPortfolios: () => api.get("/api/sync/portfolios"),
  createPortfolio: (name: string) => api.post("/api/sync/portfolios", { name }),
  renamePortfolio: (portfolioId: string, name: string) => api.put(`/api/sync/portfolios/${portfolioId}`, { name }),
  deletePortfolio: (portfolioId: string) => api.delete(`/api/sync/portfolios/${portfolioId}`),
  pushPaper: (state: { cash: number; positions: unknown[]; trades: unknown[]; freeTradeMonth: string | null; freeTradeCount: number }) =>
    api.post("/api/sync/paper", state),
  pushMaturity: (score: number, history: unknown[]) =>
    api.post("/api/sync/maturity", { score, history }),
  startTrial: () =>
    api.post("/api/sync/trial/start"),
  getTrialStatus: () =>
    api.get("/api/sync/trial/status"),
  // Nav/tab order sync
  pushNavOrder: (order: string[]) =>
    api.post("/api/sync/nav-order", { order }),
  getNavOrder: () =>
    api.get("/api/sync/nav-order"),
  // Theme sync
  pushTheme: (theme: "dark" | "light") =>
    api.post("/api/sync/theme", { theme }),
  getTheme: () =>
    api.get("/api/sync/theme"),
  // Language sync
  pushLanguage: (language: "es" | "en") =>
    api.post("/api/sync/language", { language }),
  getLanguage: () =>
    api.get("/api/sync/language"),
  // Watchlist view mode sync
  pushWatchlistViewMode: (mode: "basic" | "advanced") =>
    api.post("/api/sync/watchlist-view-mode", { mode }),
};

export const referralApi = {
  getCode:   () => api.get("/api/referral/code"),
  getStats:  () => api.get("/api/referral/stats"),
  applyCode: (code: string) => api.post("/api/referral/apply", { code }),
};

export const feedbackApi = {
  status: () => api.get("/api/feedback/status"),
  seen:   () => api.post("/api/feedback/seen"),
  submit: (rating: number, message?: string) =>
    api.post("/api/feedback/submit", { rating, message }),
};

export const paperApi = {
  analyze: (
    positions: unknown[], trades: unknown[],
    totalReturnPct: number, cash: number, portfolioValue: number, lang?: string,
  ) => api.post("/api/paper/analyze", {
    positions, trades,
    total_return_pct: totalReturnPct,
    cash,
    portfolio_value: portfolioValue,
    lang,
  }),
};

export const supportApi = {
  chat:         (message: string, history: { role: string; content: string }[]) =>
    api.post("/api/support/chat", { message, history }, { responseType: "text" }),
  createTicket: (subject: string, message: string) =>
    api.post("/api/support/ticket", { subject, message }),
  getTickets:   () => api.get("/api/support/tickets"),
};

export const earningsApi = {
  getCalendar: (symbols: string[]) =>
    api.get("/api/earnings/calendar", { params: { symbols: symbols.join(",") } }),
  getAnalysis: (symbol: string, shares = 0, avgCost = 0, lang?: string) =>
    api.get(`/api/earnings/analysis/${symbol}`, { params: { shares, avg_cost: avgCost, lang } }),
  getRecentReporters: (symbols: string[]) =>
    api.get("/api/earnings/recent-reporters", { params: { symbols: symbols.join(",") } }),
};

export const screenerWeeklyApi = {
  getWeekly: (existingTickers: string[] = []) =>
    api.get("/api/market/screener/weekly", { params: { tickers: existingTickers.join(",") } }),
  getUndervalued: (sector?: string, limit = 10, lang?: string) =>
    api.get("/api/market/screener/undervalued", { params: { sector, limit, lang } }),
  quickAnalysis: (query: string, lang?: string) =>
    api.get("/api/market/screener/quick-analysis", { params: { query, lang } }),
};

export const feedApi = {
  getClips: (params: { cursor?: number; speaker?: string; tag?: string; sort?: string }) =>
    api.get("/api/feed/clips", { params }),
  likeClip:    (clipId: string) => api.post(`/api/feed/clips/${clipId}/like`),
  saveClip:    (clipId: string) => api.post(`/api/feed/clips/${clipId}/save`),
  viewClip:    (clipId: string, watchedPct: number) =>
    api.post(`/api/feed/clips/${clipId}/view`, { watched_pct: watchedPct }),
  getComments: (clipId: string) => api.get(`/api/feed/clips/${clipId}/comments`),
  postComment: (clipId: string, text: string, parentId?: string) =>
    api.post(`/api/feed/clips/${clipId}/comments`, { text, parent_id: parentId }),
  deleteComment: (clipId: string, commentId: string) =>
    api.delete(`/api/feed/clips/${clipId}/comments/${commentId}`),
  getClip:   (clipId: string) => api.get(`/api/feed/clips/${clipId}`),
  getSaved:  () => api.get("/api/feed/saved"),
  getLiked:  () => api.get("/api/feed/liked"),
  downloadClipUrl: (clipId: string) => `${BASE_URL}/api/feed/clips/${clipId}/download`,
};

export const simulateApi = {
  whatIf: (
    scenarioType: string,
    scenarioParams: Record<string, unknown>,
    portfolio: unknown[]
  ) => api.post("/api/simulate", { scenario_type: scenarioType, scenario_params: scenarioParams, portfolio }),
};


export const watchlistExtApi = {
  batchPrices: (tickers: string[]) =>
    api.post("/api/watchlist/batch-prices", { tickers }),
};

export const watchlistServerApi = {
  getAll:  () => api.get("/api/watchlist"),
  add:     (ticker: string, name?: string) => api.post("/api/watchlist", { ticker, name }),
  remove:  (ticker: string) => api.delete(`/api/watchlist/${ticker}`),
};

export const priceAlertsApi = {
  list:   () => api.get("/api/price-alerts"),
  create: (ticker: string, targetPrice: number, condition: "above" | "below", name?: string) =>
    api.post("/api/price-alerts", { ticker, target_price: targetPrice, condition, name }),
  remove: (ticker: string) => api.delete(`/api/price-alerts/${ticker}`),
};

export const decisionsApi = {
  log: (decision: Record<string, unknown>) => api.post("/api/decisions/log", decision),
  getAll: (limit = 50) => api.get("/api/decisions", { params: { limit } }),
  getBiases: () => api.get("/api/decisions/biases"),
  deleteOne: (id: string) => api.delete(`/api/decisions/${id}`),
  deleteAll: () => api.delete("/api/decisions"),
};

export const graphApi = {
  getCompanyTimeline: (ticker: string, limit = 100) => api.get(`/api/graph/company/${ticker}`, { params: { limit } }),
  getGlobalTimeline: (limit = 100) => api.get("/api/graph/timeline", { params: { limit } }),
  getMetrics: () => api.get("/api/graph/metrics"),
};


export const brokerageApi = {
  createLinkToken:      ()                              => api.post("/api/brokerage/plaid/link-token"),
  exchangePlaidToken:   (publicToken: string, institutionId: string, institutionName: string) =>
    api.post("/api/brokerage/plaid/exchange", { public_token: publicToken, institution_id: institutionId, institution_name: institutionName }),
  getPlaidHoldings:     ()                              => api.get("/api/brokerage/plaid/holdings"),
  connectIOL:           (username: string, password: string) =>
    api.post("/api/brokerage/iol/connect", { username, password }),
  getIOLHoldings:       ()                              => api.get("/api/brokerage/iol/holdings"),
  listConnections:      ()                              => api.get("/api/brokerage/connections"),
  deleteConnection:     (id: string)                    => api.delete(`/api/brokerage/connections/${id}`),
  syncAll:              ()                              => api.post("/api/brokerage/sync"),
};


export const progressApi = {
  getPersonalizedMessage: () => api.get("/api/progress/personalized-message"),
};

export const benchmarkApi = {
  getMine: () => api.get("/api/benchmark/me"),
};

export const financialProfileApi = {
  get: () => api.get("/api/profile/financial"),
  update: (fields: Partial<{
    net_worth_usd: number;
    monthly_expenses_usd: number;
    currency: string;
    preferred_language: string;
    investing_style: string;
    time_horizon_years: number;
    financial_freedom_target_usd: number;
  }>) => api.patch("/api/profile/financial", fields),
  getGoals: () => api.get("/api/profile/financial/goals"),
  addGoal: (goal: { goal_type: string; label?: string; target_usd?: number; target_date?: string; is_primary?: boolean }) =>
    api.post("/api/profile/financial/goals", goal),
  deleteGoal: (id: string) => api.delete(`/api/profile/financial/goals/${id}`),
  getSectors: () => api.get("/api/profile/financial/sectors"),
  setSectors: (sectors: string[]) => api.put("/api/profile/financial/sectors", { sectors }),
};

export const libraryApi = {
  list: (params?: { ticker?: string; item_type?: string; limit?: number }) =>
    api.get("/api/library", { params }),
  get: (id: string) => api.get(`/api/library/${id}`),
  save: (item: { item_type: string; title: string; body?: string; ticker?: string; source?: "user" | "ai"; file_url?: string; metadata?: object }) =>
    api.post("/api/library", item),
  update: (id: string, patch: { title?: string; body?: string }) => api.patch(`/api/library/${id}`, patch),
  delete: (id: string) => api.delete(`/api/library/${id}`),
};

export const voiceCallsApi = {
  list: () => api.get("/api/voice/calls"),
  get: (id: string) => api.get(`/api/voice/calls/${id}`),
  delete: (id: string) => api.delete(`/api/voice/calls/${id}`),
};

export default api;
