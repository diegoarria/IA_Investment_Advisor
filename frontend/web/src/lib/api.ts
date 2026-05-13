import axios from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const auth = {
  register: (email: string, password: string) =>
    api.post("/api/auth/register", { email, password }),
  login: (email: string, password: string) =>
    api.post("/api/auth/login", { email, password }),
  logout: () => api.post("/api/auth/logout"),
};

export const profile = {
  get: () => api.get("/api/profile"),
  create: (data: Record<string, unknown>) => api.post("/api/profile", data),
  update: (data: Record<string, unknown>) => api.put("/api/profile", data),
};

export const chat = {
  getHistory: () => api.get("/api/chat/history"),
  saveMessage: (role: string, content: string) =>
    api.post("/api/chat/save-message", { role, content }),

  stream: async (
    message: string,
    history: Array<{ role: string; content: string }>,
    onChunk: (chunk: string) => void,
    onDone: () => void
  ) => {
    const token = localStorage.getItem("access_token");
    const response = await fetch(`${BASE_URL}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message, conversation_history: history }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) return;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
    onDone();
  },
};

export const market = {
  getSummary: () => api.get("/api/market/summary"),
  getAsset: (symbol: string) => api.get(`/api/market/asset/${symbol}`),
  analyze: (symbols: string[]) => api.post("/api/market/analyze", { symbols }),
  getPortfolio: (scenario: string, capital?: number) =>
    api.post("/api/market/portfolio", { scenario, capital }),
  getMovers: (threshold?: number) =>
    api.get("/api/market/movers", { params: { threshold } }),
  getEarnings: () => api.get("/api/market/earnings"),
};

export const notifications = {
  getAll: () => api.get("/api/notifications"),
  markRead: (id: string) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post("/api/notifications/mark-all-read"),
};

export default api;
