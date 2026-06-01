import axios from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
      const refreshToken = localStorage.getItem("refresh_token");
      if (!refreshToken) throw new Error("no refresh token");
      const res = await axios.post(`${BASE_URL}/api/auth/refresh`, { refresh_token: refreshToken });
      const { access_token, refresh_token: newRefresh } = res.data;
      localStorage.setItem("access_token", access_token);
      localStorage.setItem("refresh_token", newRefresh);
      api.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
      original.headers.Authorization = `Bearer ${access_token}`;
      flushQueue(null, access_token);
      return api(original);
    } catch (refreshErr) {
      flushQueue(refreshErr);
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      window.location.href = "/";
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
    cancelSignal?: { cancelled: boolean }
  ) => {
    const res = await api.post("/api/chat/message", {
      message,
      conversation_history: history,
      mentor: mentor ?? null,
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
  analyzeScreenshot: (imageData: string, imageType: string) =>
    api.post("/api/market/portfolio/from-screenshot", { image: imageData, type: imageType }),
  getMovers: (threshold?: number) =>
    api.get("/api/market/movers", { params: { threshold } }),
  getEarnings: () => api.get("/api/market/earnings"),
  getChart: (ticker: string, period = "1d") =>
    api.get(`/api/market/chart/${encodeURIComponent(ticker)}`, { params: { period } }),
  getNews: (symbols: string[]) =>
    api.get("/api/market/news", { params: { symbols: symbols.join(",") } }),
  alertContext: (ticker: string, change_pct: number) =>
    api.post("/api/market/screener/alert-context", { ticker, change_pct }),
  searchTickers: (q: string) => api.get("/api/market/search", { params: { q } }),
  screener: (sector: string | null, query: string) =>
    api.post("/api/market/screener", { sector, query }),
};

export const learn = {
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

export const insights = {
  get: () => api.get("/api/profile/insights"),
};

export const mentorLetter = {
  get: () => api.get("/api/profile/mentor-letter"),
};

export const referral = {
  getCode:  () => api.get("/api/referral/code"),
  getStats: () => api.get("/api/referral/stats"),
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
};

export const paperApi = {
  getLeaderboard: () => api.get("/api/paper/leaderboard"),
  setAlias: (alias: string) => api.post("/api/paper/alias", { alias }),
  syncState: (cash: number, positions: unknown[], trades: unknown[]) =>
    api.post("/api/sync/paper", { cash, positions, trades, freeTradeMonth: null, freeTradeCount: 0 }),
};

export default api;
