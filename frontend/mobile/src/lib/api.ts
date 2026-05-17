import axios from "axios";
import * as SecureStore from "expo-secure-store";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync("access_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {}
  return config;
});

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
    onTickers?: (tickers: string[]) => void
  ) => {
    const res = await api.post("/api/chat/message", {
      message,
      conversation_history: history,
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
};

export const notificationsApi = {
  getAll: () => api.get("/api/notifications"),
  markRead: (id: string) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post("/api/notifications/mark-all-read"),
};

export default api;
