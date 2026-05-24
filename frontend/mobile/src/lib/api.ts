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
      if (!refreshToken) throw new Error("no refresh token");
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
};

export const profileApi = {
  get: () => api.get("/api/profile"),
  create: (data: Record<string, unknown>) => api.post("/api/profile", data),
  update: (data: Record<string, unknown>) => api.put("/api/profile", data),
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
    mentor?: string | null
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
      onChunk((i === 0 ? "" : " ") + words[i]);
      await new Promise((r) => setTimeout(r, 18));
    }
    if (assessment && onAssessment) onAssessment(assessment);
    if (tickers.length > 0 && onTickers) onTickers(tickers);
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
  analyzeScreenshot: (base64: string, mimeType: string) =>
    api.post("/api/market/portfolio/from-screenshot", { image: base64, type: mimeType }),
  getIndices: () => api.get("/api/market/indices"),
  getChart: (ticker: string, period = "1y") =>
    api.get(`/api/market/chart/${encodeURIComponent(ticker)}`, { params: { period } }),
  screener: (sector: string | null, query: string) =>
    api.post("/api/market/screener", { sector, query }),
  alertContext: (ticker: string, change_pct: number) =>
    api.post("/api/market/screener/alert-context", { ticker, change_pct }),
  getNews: (symbols: string[]) =>
    api.get("/api/market/news", { params: { symbols: symbols.join(",") } }),
};

export const notificationsApi = {
  getAll: () => api.get("/api/notifications"),
  markRead: (id: string) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post("/api/notifications/mark-all-read"),
};

export default api;
