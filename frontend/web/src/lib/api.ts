import axios from "axios";
import { getSupabaseClient } from "./supabase";
import { apiBase } from "./apiBase";
import type { DetailLevel } from "./detailLevel";

const BASE_URL = apiBase();

// `withCredentials: true` is what makes the browser send/receive the httpOnly
// `access_token`/`refresh_token` cookies the backend now sets on login/register/
// refresh — the token is never read into JS here, so an XSS bug on this site
// can no longer exfiltrate it from localStorage the way it used to.
const api = axios.create({ baseURL: BASE_URL, withCredentials: true });

// Auto-refresh on 401 — the request itself carries no token; the cookie does.
let isRefreshing = false;
let failedQueue: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

const flushQueue = (error: unknown) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve()));
  failedQueue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    const status = error.response?.status;
    if (status !== 401 || original._retry) return Promise.reject(error);

    if (isRefreshing) {
      return new Promise<void>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then(() => api(original));
    }

    original._retry = true;
    isRefreshing = true;

    try {
      // No body needed — the backend reads the refresh_token cookie itself.
      // The response's Set-Cookie header refreshes both cookies automatically;
      // there's nothing for JS to store.
      await axios.post(`${BASE_URL}/api/auth/refresh`, {}, { withCredentials: true });
      flushQueue(null);
      return api(original);
    } catch (refreshErr) {
      // Only force logout when the server explicitly rejects the refresh
      // (expired/invalid). For network errors or server outages, leave the
      // cookie alone so the user stays logged in and can retry once
      // connectivity is restored.
      const refreshStatus = (refreshErr as { response?: { status?: number } })?.response?.status;
      if (refreshStatus === 401 || refreshStatus === 403) {
        // Before giving up, try Supabase's own client-side session — handles
        // the multi-tab race where another tab already refreshed via the
        // Supabase SDK directly. The token only ever lives in JS memory for
        // this one call, passed straight through to re-mint our cookie —
        // never persisted to storage.
        try {
          const { data: { session } } = await getSupabaseClient().auth.getSession();
          if (session?.access_token) {
            await axios.post(`${BASE_URL}/api/auth/set-session`, {
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            }, { withCredentials: true });
            flushQueue(null);
            return api(original);
          }
        } catch {}
        // Supabase also has no session — truly expired, clear the cookie and force logout.
        try { await axios.post(`${BASE_URL}/api/auth/logout`, {}, { withCredentials: true }); } catch {}
        import("./store").then(({ useAuthStore }) => {
          useAuthStore.getState().setSessionExpired(true);
          useAuthStore.getState().clearAuth();
        }).catch(() => {});
      }
      flushQueue(refreshErr);
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

export const auth = {
  register: (email: string, password: string, language?: string) =>
    api.post("/api/auth/register", { email, password, language }),
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
  setSession: (access_token: string, refresh_token?: string) =>
    api.post("/api/auth/set-session", { access_token, refresh_token }),
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
  deleteHistory: (sessionId: string) => api.delete(`/api/chat/history/${encodeURIComponent(sessionId)}`),
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
  getHistoricalBacktest: (positions: { ticker: string; shares: number; avg_price: number }[]) =>
    api.post("/api/market/portfolio/historical-backtest", { positions }),
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
  get: (lang?: string) => api.get("/api/profile/insights", { params: { lang } }),
};

export const mentorLetter = {
  get: () => api.get("/api/profile/mentor-letter"),
};

export const referral = {
  getCode:       () => api.get("/api/referral/code"),
  getStats:      () => api.get("/api/referral/stats"),
  applyCode:     (code: string) => api.post("/api/referral/apply", { code }),
  redeemSession: () => api.post("/api/referral/redeem-session"),
};

export const cashHoldings = {
  list:   () => api.get("/api/cash-holdings"),
  add:    (amount: number, instrument: string, currency: string, label?: string, ratePct?: number | null) =>
    api.post("/api/cash-holdings", { amount, instrument, currency, label, rate_pct: ratePct ?? null }),
  update: (id: string, body: { amount?: number; instrument?: string; currency?: string; label?: string; rate_pct?: number | null }) =>
    api.put(`/api/cash-holdings/${id}`, body),
  remove: (id: string) => api.delete(`/api/cash-holdings/${id}`),
};

export const dividends = {
  getIncome: () => api.get("/api/dividends/income"),
};

export const support = {
  chat:         (message: string, history: {role:string;content:string}[]) =>
    fetch(`${BASE_URL}/api/support/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
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
  pushLanguage: (language: "es" | "en") => api.post("/api/sync/language", { language }),
  getLanguage: () => api.get("/api/sync/language"),
  pushPortfolioViewMode: (mode: "basic" | "advanced") => api.post("/api/sync/portfolio-view-mode", { mode }),
  pushWatchlistViewMode: (mode: "basic" | "advanced") => api.post("/api/sync/watchlist-view-mode", { mode }),
  // Fase 4, Incremento 1 — the "Nivel de Detalle" preference (Principiante/
  // Intermedio/Avanzado/Profesional), deliberately separate from the
  // basic/advanced view-mode toggles above (see src/lib/detailLevel.ts).
  pushDetailLevel: (level: DetailLevel) => api.post("/api/sync/detail-level", { level }),
  // Fase 4, Incremento 12 (Personalización, Parte L) — partial update,
  // omit a key entirely to leave it untouched server-side.
  pushPersonalization: (patch: {
    required_return_pct?: number | null; min_margin_of_safety_pct?: number | null;
    preferred_discount_rate_method?: string; favorite_metrics?: string[]; dashboard_section_order?: string[];
  }) => api.post("/api/sync/personalization", patch),
  pushChecklistDone: () => api.post("/api/sync/checklist-done"),
  pushMaturity: (score: number, history: unknown[]) =>
    api.post("/api/sync/maturity", { score, history }),
  pushNavOrder: (order: string[]) => api.post("/api/sync/nav-order", { order }),
  getNavOrder: () => api.get("/api/sync/nav-order"),
  pushWatchlistOrder: (order: string[]) => api.post("/api/sync/watchlist-order", { order }),
  pushBehavioralRisk: (score: number) => api.post("/api/sync/behavioral-risk", { score }),
};

export const explain = {
  explain: (screen: string, context: Record<string, unknown>, lang?: string, textOnly?: boolean) =>
    api.post("/api/explain", { screen, context, lang, text_only: textOnly }, { timeout: 25000 }),
};

export const notifications = {
  getAll: () => api.get("/api/notifications"),
  markRead: (id: string) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post("/api/notifications/mark-all-read"),
  getMorningBrief: () => api.get("/api/notifications/morning-brief"),
};

export const billing = {
  getStatus: () => api.get("/api/billing/status"),
  createCheckout: (plan: "monthly" | "yearly" = "monthly") =>
    api.post("/api/billing/create-checkout", { plan }),
  brokerCallCheckout: () => api.post("/api/billing/broker-call-checkout"),
  brokerOfferSeen: () => api.post("/api/billing/broker-offer-seen"),
  duoSetup: (secondary_email: string) => api.post("/api/billing/duo-setup", { secondary_email }),
  getDuoPartner: () => api.get("/api/billing/duo-partner"),
};

export const upsells = {
  checkout: (offer: string, variant: string, trigger_source: string, extra?: Record<string, unknown>) =>
    api.post("/api/upsells/checkout", { offer, variant, trigger_source, ...extra }),
};

export const researchApi = {
  createPlan: (requestText: string) =>
    api.post("/api/research/plan", { request_text: requestText }),
  start: (jobId: string, stripeSessionId: string) =>
    api.post("/api/research/start", { job_id: jobId, stripe_session_id: stripeSessionId }),
  startFree: (jobId: string) => api.post("/api/research/start-free", { job_id: jobId }),
  getJob: (jobId: string) => api.get(`/api/research/jobs/${jobId}`),
  getActiveJob: () => api.get("/api/research/jobs/active"),
  listReports: () => api.get("/api/research/reports"),
  getReport: (id: string) => api.get(`/api/research/reports/${id}`),
  // Protected endpoint — needs the auth header, so this fetches a blob and
  // triggers the download client-side rather than linking directly to the URL.
  downloadPdf: (id: string) => api.get(`/api/research/reports/${id}/pdf`, { responseType: "blob" }),
};

// Fase 3's Investment Research Engine (backend/app/api/routes/research_engine.py)
// — deliberately a separate object from `researchApi` above, which is the
// unrelated Deep Research paid one-off report feature (`/api/research/...`).
// These target `/api/research-engine/...`.
export const researchEngineApi = {
  getDossier: (ticker: string, lang?: string) =>
    api.get(`/api/research-engine/company/${ticker}/dossier`, { params: { lang }, timeout: 30000 }),
  getBusinessUnderstanding: (ticker: string, lang?: string) =>
    api.get(`/api/research-engine/company/${ticker}/business-understanding`, { params: { lang } }),
  getCompetitiveIntelligence: (ticker: string, lang?: string) =>
    api.get(`/api/research-engine/company/${ticker}/competitive-intelligence`, { params: { lang } }),
  getIndustryIntelligence: (ticker: string, lang?: string) =>
    api.get(`/api/research-engine/company/${ticker}/industry-intelligence`, { params: { lang } }),
  getManagementIntelligence: (ticker: string, lang?: string) =>
    api.get(`/api/research-engine/company/${ticker}/management-intelligence`, { params: { lang } }),
  getTimeline: (ticker: string, limit = 100) =>
    api.get(`/api/research-engine/company/${ticker}/timeline`, { params: { limit } }),
  getThesisDraft: (ticker: string) =>
    api.get(`/api/research-engine/company/${ticker}/thesis/draft`),
  refreshThesisDraft: (ticker: string, lang?: string) =>
    api.post(`/api/research-engine/company/${ticker}/thesis/draft/refresh`, {}, { params: { lang }, timeout: 30000 }),
  forkThesis: (ticker: string) =>
    api.post(`/api/research-engine/company/${ticker}/thesis/fork`, {}),
  getMyThesis: (ticker: string) =>
    api.get(`/api/research-engine/company/${ticker}/thesis/mine`),
  // Fase 4, Incremento 11 — manual create/edit of the user's own thesis
  // (always a new version, never overwrites — same rule as fork/review).
  saveMyThesis: (ticker: string, body: {
    thesis_summary: string; strengths?: string[]; critical_variables?: string[];
    key_risks?: string[]; invalidation_events?: string[];
  }) => api.post(`/api/research-engine/company/${ticker}/thesis/mine`, body),
  // Every ticker the user has a current personal thesis for — powers the
  // Investment Journal page's "your theses" list.
  getAllMyTheses: () => api.get("/api/research-engine/theses/mine"),
  // Fase 4, Incremento 6 — every real version of the user's own thesis.
  getThesisHistory: (ticker: string) =>
    api.get(`/api/research-engine/company/${ticker}/thesis/history`),
  reviewThesis: (ticker: string, lang?: string) =>
    api.post(`/api/research-engine/company/${ticker}/thesis/review`, {}, { params: { lang }, timeout: 30000 }),
  getMemo: (ticker: string, lang?: string) =>
    api.get(`/api/research-engine/company/${ticker}/memo`, { params: { lang }, timeout: 30000 }),
  getBenchmark: () => api.get("/api/research-engine/benchmark"),
};

// Fase 4, Incremento 8 (Investment Checklist, Parte H) — the user's
// personalized checklist + per-ticker checked state + "Invertible" mark.
export const checklistApi = {
  getItems: () => api.get("/api/checklist/items"),
  addItem: (label: string) => api.post("/api/checklist/items", { label }),
  removeItem: (itemKey: string) => api.delete(`/api/checklist/items/${itemKey}`),
  getForTicker: (ticker: string) => api.get(`/api/checklist/${ticker}`),
  toggleItem: (ticker: string, itemKey: string, checked: boolean) =>
    api.post(`/api/checklist/${ticker}/${itemKey}`, { checked }),
  setInvestable: (ticker: string, marked: boolean) =>
    api.post(`/api/checklist/${ticker}/investable`, { marked }),
};

export const weeklyRitualsApi = {
  getQuestion: (lang?: string) => api.get("/api/weekly-rituals/question", { params: { lang } }),
  vote: (choice: "a" | "b") => api.post("/api/weekly-rituals/question/vote", { choice }),
  getSundayPrep: () => api.get("/api/weekly-rituals/sunday-prep"),
  saveReflection: (body: { went_well?: string; learned?: string; would_do_differently?: string }) =>
    api.post("/api/weekly-rituals/reflection", body),
  getReflectionHistory: () => api.get("/api/weekly-rituals/reflection/history"),
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
  analyze: (positions: unknown[], trades: unknown[], totalReturnPct: number, cash: number, portfolioValue: number, lang?: string) =>
    api.post("/api/paper/analyze", { positions, trades, total_return_pct: totalReturnPct, cash, portfolio_value: portfolioValue, lang }),
};

export const earningsApi = {
  getCalendar: (symbols: string[]) =>
    api.get("/api/earnings/calendar", { params: { symbols: symbols.join(",") } }),
  getAnalysis: (symbol: string, shares = 0, avgCost = 0, lang?: string) =>
    api.get(`/api/earnings/analysis/${symbol}`, { params: { shares, avg_cost: avgCost, lang } }),
  getRecentReporters: (symbols: string[]) =>
    api.get("/api/earnings/recent-reporters", { params: { symbols: symbols.join(",") } }),
};

export const screenerApi = {
  screen: (sector: string | null, query: string) =>
    api.post("/api/market/screener", { sector, query }),
  getWeekly: (existingTickers: string[] = []) =>
    api.get("/api/market/screener/weekly", { params: { tickers: existingTickers.join(",") } }),
  getUndervalued: (sector?: string, limit = 10, lang?: string, browse?: boolean) =>
    api.get("/api/market/screener/undervalued", { params: { sector, limit, lang, browse } }),
  quickAnalysis: (query: string, lang?: string) =>
    api.get("/api/market/screener/quick-analysis", { params: { query, lang }, timeout: 25000 }),
  nifDashboard: (query: string, lang?: string) =>
    api.get("/api/market/screener/nif-dashboard", { params: { query, lang }, timeout: 25000 }),
  companyDiagnostic: (query: string, lang?: string) =>
    api.get("/api/market/screener/company-diagnostic", { params: { query, lang }, timeout: 25000 }),
  getValuationBacktest: () => api.get("/api/market/screener/valuation-backtest"),
};

export const savedValuationsApi = {
  list: () => api.get("/api/saved-valuations"),
  save: (ticker: string, growthPct: number, discountRatePct: number, terminalGrowthPct: number) =>
    api.post("/api/saved-valuations", {
      ticker, growth_pct: growthPct, discount_rate_pct: discountRatePct, terminal_growth_pct: terminalGrowthPct,
    }),
  remove: (ticker: string) => api.delete(`/api/saved-valuations/${encodeURIComponent(ticker)}`),
};

export const simulateApi = {
  whatIf: (
    scenarioType: string,
    scenarioParams: Record<string, unknown>,
    portfolio: unknown[]
  ) => api.post("/api/simulate", { scenario_type: scenarioType, scenario_params: scenarioParams, portfolio }),
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
  getThenNow: (ticker: string) => api.get(`/api/graph/company/${ticker}/then-now`),
  getGlobalTimeline: (limit = 100) => api.get("/api/graph/timeline", { params: { limit } }),
  getMetrics: () => api.get("/api/graph/metrics"),
};

export const watchlist = {
  get: () => api.get("/api/watchlist"),
  add: (ticker: string, name?: string) => api.post("/api/watchlist", { ticker, name }),
  remove: (ticker: string) => api.delete(`/api/watchlist/${encodeURIComponent(ticker)}`),
  // Fase 4, Incremento 9 (Watchlist Inteligente, Parte I) — cache-only,
  // Premium-gated batch read; never triggers a fresh valuation/quality run.
  getBatchScores: (tickers: string[], lang?: string) =>
    api.post("/api/watchlist/batch-scores", { tickers }, { params: { lang } }),
};

export const priceAlerts = {
  list: () => api.get("/api/price-alerts"),
  create: (ticker: string, targetPrice: number, condition: "above" | "below", name?: string) =>
    api.post("/api/price-alerts", { ticker, target_price: targetPrice, condition, name }),
  remove: (ticker: string) => api.delete(`/api/price-alerts/${encodeURIComponent(ticker)}`),
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

// Belvo — LatAm open banking (bank accounts first; brokerage sync is
// Phase 2, see /Users/diegoarria/.claude/plans/cosmic-munching-crown.md).
// Separate from brokerageApi above even though both back the same
// BrokerConnectModal — Belvo's widget flow (institutions/widget-token/
// register-link) doesn't map onto Plaid's public_token-exchange shape.
export const belvoApi = {
  listInstitutions: (category: "banking" | "investment" = "banking") =>
    api.get("/api/belvo/institutions", { params: { category } }),
  createWidgetToken: (linkId?: string) =>
    api.post("/api/belvo/widget-token", linkId ? { link_id: linkId } : {}),
  registerLink: (linkId: string, institutionName: string) =>
    api.post("/api/belvo/register-link", { link_id: linkId, institution_name: institutionName }),
  listConnections: () => api.get("/api/belvo/connections"),
  deleteConnection: (id: string) => api.delete(`/api/belvo/connections/${id}`),
};

export const progressApi = {
  getPersonalizedMessage: () => api.get("/api/progress/personalized-message"),
};

export const benchmarkApi = {
  getMine: () => api.get("/api/benchmark/me"),
};

export const voiceCallsApi = {
  list: () => api.get("/api/voice/calls"),
  get: (id: string) => api.get(`/api/voice/calls/${id}`),
  delete: (id: string) => api.delete(`/api/voice/calls/${id}`),
  getTicket: () => api.post("/api/voice/call/ticket"),
};

export const adminApi = {
  getUserSnapshot: (email: string) => api.get("/api/admin/user-snapshot", { params: { email } }),
  testMarketOpen: () => api.post("/api/admin/test-market-open"),
  testPriceAlertWhy: (ticker: string, pct: number) =>
    api.post("/api/admin/test-price-alert-why", null, { params: { ticker, pct } }),
  llmUsage: (days: number = 1) =>
    api.get("/api/admin/llm-usage", { params: { days } }),
};

export default api;
