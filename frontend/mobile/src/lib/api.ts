import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

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
    if (error.response?.status !== 401 || original._retry) return Promise.reject(error);

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
  getHistory: () => api.get("/api/chat/history"),
  saveMessage: (role: string, content: string) =>
    api.post("/api/chat/save-message", { role, content }),
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
  ) => {
    const res = await api.post("/api/chat/message", {
      message,
      conversation_history: history,
      mentor: mentor ?? null,
      image_data: imageData ?? null,
      image_type: imageType ?? null,
      images: images ?? [],
    });
    const reply: string = res.data.reply ?? "";
    const assessment = res.data.risk_assessment ?? null;
    const tickers: string[] = res.data.tickers ?? [];
    const words = reply.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (cancelSignal?.cancelled) break;
      onChunk((i === 0 ? "" : " ") + words[i]);
      await new Promise((r) => setTimeout(r, 8));
    }
    if (!cancelSignal?.cancelled) {
      if (assessment && onAssessment) onAssessment(assessment);
      if (tickers.length > 0 && onTickers) onTickers(tickers);
    }
    onDone();
  },
};

export const marketApi = {
  getSummary: () => api.get("/api/market/summary"),
  analyze: (symbols: string[]) => api.post("/api/market/analyze", { symbols }),
  getPortfolio: (
    scenario: string,
    capital?: number,
    positions?: Array<{ ticker: string; shares: number; avg_price: number; name?: string }>
  ) => api.post("/api/market/portfolio", { scenario, capital, positions }),
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
  getPortfolioReturns: (positions: { ticker: string; shares: number; purchase_date?: string | null; avg_price?: number | null }[]) =>
    api.post("/api/market/portfolio-returns", { positions }),
  getPortfolioChart: (positions: { ticker: string; shares: number; purchase_date?: string | null; avg_price?: number | null }[], period: string) =>
    api.post("/api/market/portfolio-chart", { positions, period }),
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
};

export const notificationsApi = {
  getAll: () => api.get("/api/notifications"),
  markRead: (id: string) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post("/api/notifications/mark-all-read"),
};

export const billingApi = {
  createCheckout: (plan: "monthly" | "yearly" = "monthly") => api.post("/api/billing/create-checkout", { plan }),
  getStatus: () => api.get("/api/billing/status"),
};

export const learnApi = {
  getScenario: (difficulty: string) => api.post("/api/learn/scenario", { difficulty }),
  submitScenarioResult: (scenarioId: string, choice: string, difficulty: string) =>
    api.post("/api/learn/scenario/result", { scenario_id: scenarioId, choice, difficulty }),
  startDebate: (thesis: string, difficulty: string) =>
    api.post("/api/learn/debate", { thesis, difficulty }),
  replyDebate: (thesis: string, previousDebate: string, userResponse: string, round: number, difficulty: string) =>
    api.post("/api/learn/debate/reply", { thesis, previous_debate: previousDebate, user_response: userResponse, round, difficulty }),
  syncStreak: (streak: number, lastLearnDate: string) =>
    api.post("/api/learn/streak/sync", { streak, last_learn_date: lastLearnDate }),
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
  pushPortfolio: (positions: unknown[], currency?: string) =>
    api.post("/api/sync/portfolio", { positions, currency }),
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
};

export const referralApi = {
  getCode:   () => api.get("/api/referral/code"),
  getStats:  () => api.get("/api/referral/stats"),
  applyCode: (code: string) => api.post("/api/referral/apply", { code }),
};

export const paperApi = {
  analyze: (
    positions: unknown[], trades: unknown[],
    totalReturnPct: number, cash: number, portfolioValue: number,
  ) => api.post("/api/paper/analyze", {
    positions, trades,
    total_return_pct: totalReturnPct,
    cash,
    portfolio_value: portfolioValue,
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
  getAnalysis: (symbol: string, shares = 0, avgCost = 0) =>
    api.get(`/api/earnings/analysis/${symbol}`, { params: { shares, avg_cost: avgCost } }),
};

export const screenerWeeklyApi = {
  getWeekly: (existingTickers: string[] = []) =>
    api.get("/api/market/screener/weekly", { params: { tickers: existingTickers.join(",") } }),
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

export const watchlistExtApi = {
  batchPrices: (tickers: string[]) =>
    api.post("/api/watchlist/batch-prices", { tickers }),
};

export const watchlistServerApi = {
  getAll:  () => api.get("/api/watchlist"),
  add:     (ticker: string, name?: string) => api.post("/api/watchlist", { ticker, name }),
  remove:  (ticker: string) => api.delete(`/api/watchlist/${ticker}`),
};

export const decisionsApi = {
  log: (decision: Record<string, unknown>) => api.post("/api/decisions/log", decision),
  getAll: (limit = 50) => api.get("/api/decisions", { params: { limit } }),
  getBiases: () => api.get("/api/decisions/biases"),
};

export const portfolioLeaderboardApi = {
  get: (period: "ytd" | "1m" | "1w") =>
    api.get("/api/leaderboard", { params: { period } }),
};

export const investorsApi = {
  list: () => api.get("/api/investors"),
  getHoldings: (investorId: string) => api.get(`/api/investors/${investorId}`),
};

export default api;
