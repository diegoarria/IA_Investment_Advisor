/**
 * Nuvos AI — k6 Load Test Suite
 *
 * Covers all 11 user flows across 7 concurrency tiers.
 *
 * Usage:
 *   # Install k6: brew install k6
 *
 *   # Run a specific tier (env vars override the default scenario):
 *   k6 run -e TIER=50   nuvos_load_test.js
 *   k6 run -e TIER=100  nuvos_load_test.js
 *   k6 run -e TIER=200  nuvos_load_test.js
 *   k6 run -e TIER=500  nuvos_load_test.js
 *   k6 run -e TIER=1000 nuvos_load_test.js
 *   k6 run -e TIER=5000 nuvos_load_test.js  # expect failures
 *   k6 run -e TIER=10000 nuvos_load_test.js # stress ceiling
 *
 *   # Run against prod:
 *   k6 run -e BASE_URL=https://api.nuvosai.com -e TIER=200 nuvos_load_test.js
 *
 *   # Export JSON results for dashboards:
 *   k6 run --out json=results.json -e TIER=100 nuvos_load_test.js
 *
 *   # Live Grafana dashboard (requires k6 Cloud or OSS Grafana):
 *   k6 run --out influxdb=http://localhost:8086/k6 -e TIER=100 nuvos_load_test.js
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { randomIntBetween, randomItem } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
const TIER     = parseInt(__ENV.TIER || "50");

// Test credentials — in real runs use a separate test-user pool
const TEST_EMAIL_PREFIX = __ENV.TEST_EMAIL_PREFIX || "loadtest";
const TEST_EMAIL_DOMAIN = __ENV.TEST_EMAIL_DOMAIN || "nuvosai-test.com";
const TEST_PASSWORD      = __ENV.TEST_PASSWORD    || "LoadTest2024!";

// Sample data for realistic requests
const TICKERS     = ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "GOOG", "META", "SPY", "QQQ", "VOO"];
const SCREENER_Q  = ["mejor tecnología para largo plazo", "acciones defensivas", "alta rentabilidad por dividendo"];
const CHAT_MSGS   = [
  "¿Qué opinas de Apple como inversión a largo plazo?",
  "Explícame qué es el P/E ratio",
  "¿Cuál es la diferencia entre ETF y acción individual?",
  "¿Cómo diversifico mi portafolio con $5000?",
  "¿Qué sectores son más resistentes en recesiones?",
];

// ── Custom metrics ─────────────────────────────────────────────────────────────

const loginErrors       = new Rate("login_errors");
const chatErrors        = new Rate("chat_errors");
const portfolioErrors   = new Rate("portfolio_errors");
const screenerErrors    = new Rate("screener_errors");
const timeoutErrors     = new Rate("timeout_errors");
const authLatency       = new Trend("auth_latency_ms",       true);
const portfolioLatency  = new Trend("portfolio_latency_ms",  true);
const chatLatency       = new Trend("chat_latency_ms",       true);
const marketLatency     = new Trend("market_latency_ms",     true);
const screenerLatency   = new Trend("screener_latency_ms",   true);
const feedLatency       = new Trend("feed_latency_ms",       true);
const notifLatency      = new Trend("notif_latency_ms",      true);
const syncLatency       = new Trend("sync_latency_ms",       true);
const totalRequests     = new Counter("total_requests");

// ── Scenario matrix by tier ────────────────────────────────────────────────────

function buildScenario(vus) {
  // Ramp up over 30 s, sustain 2 min, ramp down 30 s
  const rampUp  = Math.ceil(vus * 0.3);  // VUs at ramp-up start
  return {
    default: {
      executor: "ramping-vus",
      startVUs: Math.max(1, Math.floor(vus * 0.1)),
      stages: [
        { duration: "30s", target: rampUp },
        { duration: "30s", target: vus },
        { duration: "2m",  target: vus },
        { duration: "30s", target: 0  },
      ],
      gracefulRampDown: "15s",
    },
  };
}

export const options = {
  scenarios: buildScenario(TIER),

  // SLO thresholds — test FAILS if breached
  thresholds: {
    // P95 < 2 s for non-AI endpoints
    "http_req_duration{type:auth}":      ["p(95)<2000"],
    "http_req_duration{type:portfolio}": ["p(95)<2000"],
    "http_req_duration{type:sync}":      ["p(95)<1500"],
    "http_req_duration{type:market}":    ["p(95)<3000"],
    "http_req_duration{type:feed}":      ["p(95)<2000"],
    "http_req_duration{type:notif}":     ["p(95)<1000"],

    // Error rates
    "login_errors":     ["rate<0.01"],   // <1% login failures
    "portfolio_errors": ["rate<0.02"],
    "chat_errors":      ["rate<0.05"],   // Chat can be slower (AI)
    "screener_errors":  ["rate<0.05"],
    "timeout_errors":   ["rate<0.02"],

    // Overall HTTP
    "http_req_failed": ["rate<0.05"],
    "http_req_duration": ["p(95)<5000", "p(99)<10000"],
  },

  // Pretty console output
  summaryTrendStats: ["min", "med", "avg", "p(90)", "p(95)", "p(99)", "max"],
};

// ── Auth helpers ──────────────────────────────────────────────────────────────

function buildEmail(vu) {
  return `${TEST_EMAIL_PREFIX}+${vu}@${TEST_EMAIL_DOMAIN}`;
}

function login(email, password) {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    {
      headers: { "Content-Type": "application/json" },
      tags:    { type: "auth" },
      timeout: "10s",
    }
  );
  authLatency.add(Date.now() - start);
  totalRequests.add(1);

  const ok = check(res, {
    "login 200":        (r) => r.status === 200,
    "has access_token": (r) => !!JSON.parse(r.body || "{}").access_token,
  });

  loginErrors.add(!ok);
  if (res.status === 0) timeoutErrors.add(1);

  if (!ok) return null;
  return JSON.parse(res.body).access_token;
}

function authHeaders(token) {
  return {
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
}

// ── Flow 1: Login ─────────────────────────────────────────────────────────────

function flowLogin(email, password) {
  return login(email, password);
}

// ── Flow 2: Portfolio ─────────────────────────────────────────────────────────

function flowPortfolio(token) {
  group("portfolio", () => {
    // Get synced portfolio
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/sync/portfolio`,
      { ...authHeaders(token), tags: { type: "portfolio" } }
    );
    portfolioLatency.add(Date.now() - start);
    totalRequests.add(1);
    const ok = check(res, { "portfolio 200": (r) => r.status === 200 });
    portfolioErrors.add(!ok);

    // Get market prices for positions
    const tickers = [randomItem(TICKERS), randomItem(TICKERS)];
    const res2 = http.post(
      `${BASE_URL}/api/market/prices`,
      JSON.stringify({ symbols: tickers }),
      { ...authHeaders(token), tags: { type: "market" } }
    );
    const start2 = Date.now();
    marketLatency.add(Date.now() - start2);
    totalRequests.add(1);
    check(res2, { "prices 200": (r) => r.status === 200 });

    // Portfolio returns
    const res3 = http.post(
      `${BASE_URL}/api/market/portfolio-returns`,
      JSON.stringify({
        positions: tickers.map((t) => ({
          ticker: t, shares: randomIntBetween(1, 20),
          avg_price: randomIntBetween(50, 500),
        })),
      }),
      { ...authHeaders(token), tags: { type: "portfolio" }, timeout: "15s" }
    );
    totalRequests.add(1);
    check(res3, { "returns 200": (r) => [200, 422].includes(r.status) });
  });
}

// ── Flow 3: Chat open + Flow 4: Send message ──────────────────────────────────

function flowChat(token) {
  group("chat", () => {
    // History (opening chat)
    const res = http.get(
      `${BASE_URL}/api/chat/history`,
      { ...authHeaders(token), tags: { type: "chat" } }
    );
    totalRequests.add(1);
    check(res, { "history 200": (r) => r.status === 200 });

    // Send a message (AI call — the main cost)
    const msg = randomItem(CHAT_MSGS);
    const start = Date.now();
    const res2 = http.post(
      `${BASE_URL}/api/chat/message`,
      JSON.stringify({
        message: msg,
        conversation_history: [],
        mentor: null,
      }),
      {
        ...authHeaders(token),
        tags:    { type: "chat" },
        timeout: "60s",  // AI can take up to 30 s
      }
    );
    chatLatency.add(Date.now() - start);
    totalRequests.add(1);

    const ok = check(res2, {
      "chat 200":   (r) => r.status === 200,
      "has reply":  (r) => !!JSON.parse(r.body || "{}").reply,
    });
    chatErrors.add(!ok);
    if (res2.status === 0) timeoutErrors.add(1);
  });
}

// ── Flow 5: Navigation (profile + notifications) ───────────────────────────────

function flowNavigation(token) {
  group("navigation", () => {
    const res = http.get(
      `${BASE_URL}/api/profile`,
      { ...authHeaders(token), tags: { type: "auth" } }
    );
    totalRequests.add(1);
    check(res, { "profile 200": (r) => [200, 404].includes(r.status) });

    const start = Date.now();
    const res2 = http.get(
      `${BASE_URL}/api/notifications`,
      { ...authHeaders(token), tags: { type: "notif" } }
    );
    notifLatency.add(Date.now() - start);
    totalRequests.add(1);
    check(res2, { "notif 200": (r) => r.status === 200 });
  });
}

// ── Flow 6: Screener ──────────────────────────────────────────────────────────

function flowScreener(token) {
  group("screener", () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/market/screener`,
      JSON.stringify({ sector: null, query: randomItem(SCREENER_Q) }),
      {
        ...authHeaders(token),
        tags:    { type: "screener" },
        timeout: "30s",
      }
    );
    screenerLatency.add(Date.now() - start);
    totalRequests.add(1);
    const ok = check(res, { "screener 200": (r) => r.status === 200 });
    screenerErrors.add(!ok);
  });
}

// ── Flow 7: Videos ────────────────────────────────────────────────────────────

function flowVideos(token) {
  group("videos", () => {
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/feed/clips?page=1&limit=10`,
      { ...authHeaders(token), tags: { type: "feed" } }
    );
    feedLatency.add(Date.now() - start);
    totalRequests.add(1);
    check(res, { "feed 200": (r) => r.status === 200 });
  });
}

// ── Flow 8: Like ─────────────────────────────────────────────────────────────

function flowLike(token, clipId) {
  group("like", () => {
    const res = http.post(
      `${BASE_URL}/api/feed/clips/${clipId}/like`,
      null,
      { ...authHeaders(token), tags: { type: "feed" } }
    );
    totalRequests.add(1);
    check(res, { "like 200/409": (r) => [200, 201, 409].includes(r.status) });
  });
}

// ── Flow 9: Save ─────────────────────────────────────────────────────────────

function flowSave(token, clipId) {
  group("save", () => {
    const res = http.post(
      `${BASE_URL}/api/feed/clips/${clipId}/save`,
      null,
      { ...authHeaders(token), tags: { type: "feed" } }
    );
    totalRequests.add(1);
    check(res, { "save 200/409": (r) => [200, 201, 409].includes(r.status) });
  });
}

// ── Flow 10: Notifications ────────────────────────────────────────────────────

function flowNotifications(token) {
  group("notifications", () => {
    const res = http.get(
      `${BASE_URL}/api/notifications`,
      { ...authHeaders(token), tags: { type: "notif" } }
    );
    totalRequests.add(1);
    check(res, { "notif 200": (r) => r.status === 200 });
  });
}

// ── Flow 11: Real-time sync ───────────────────────────────────────────────────

function flowSync(token) {
  group("sync", () => {
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/sync/all`,
      { ...authHeaders(token), tags: { type: "sync" } }
    );
    syncLatency.add(Date.now() - start);
    totalRequests.add(1);
    check(res, { "sync/all 200": (r) => r.status === 200 });

    // Push nav order (lightweight write)
    http.post(
      `${BASE_URL}/api/sync/nav-order`,
      JSON.stringify({ order: ["/chat", "/portfolio", "/watchlist", "/learn"] }),
      { ...authHeaders(token), tags: { type: "sync" } }
    );
    totalRequests.add(1);
  });
}

// ── Market data flows ─────────────────────────────────────────────────────────

function flowMarket(token) {
  group("market", () => {
    // Indices (cached, should be fast)
    const r1 = http.get(
      `${BASE_URL}/api/market/indices`,
      { ...authHeaders(token), tags: { type: "market" } }
    );
    totalRequests.add(1);
    check(r1, { "indices 200": (r) => r.status === 200 });

    // Single stock detail
    const ticker = randomItem(TICKERS);
    const start = Date.now();
    const r2 = http.get(
      `${BASE_URL}/api/market/stock-detail/${ticker}`,
      { ...authHeaders(token), tags: { type: "market" }, timeout: "15s" }
    );
    marketLatency.add(Date.now() - start);
    totalRequests.add(1);
    check(r2, { "stock-detail 200": (r) => r.status === 200 });
  });
}

// ── Paper trading flow ────────────────────────────────────────────────────────

function flowPaper(token) {
  group("paper", () => {
    const r = http.get(
      `${BASE_URL}/api/sync/paper`,  // fallback — GET paper state
      { ...authHeaders(token), tags: { type: "sync" } }
    );
    totalRequests.add(1);
    check(r, { "paper sync 200": (r) => r.status === 200 });

    // Push a simulated trade state
    http.post(
      `${BASE_URL}/api/sync/paper`,
      JSON.stringify({
        cash: 8500,
        positions: [{ id: "AAPL-1", ticker: "AAPL", shares: 2, avgPrice: 180, name: "Apple", buyDate: Date.now() }],
        trades: [],
        freeTradeMonth: null,
        freeTradeCount: 0,
      }),
      { ...authHeaders(token), tags: { type: "sync" } }
    );
    totalRequests.add(1);
  });
}

// ── Main VU function ──────────────────────────────────────────────────────────

export default function () {
  const vuId    = __VU;
  const email   = buildEmail(vuId);
  const password = TEST_PASSWORD;

  // ── Flow 1: Login ──
  const token = flowLogin(email, password);
  if (!token) {
    sleep(2);
    return;
  }

  sleep(randomIntBetween(1, 3));

  // ── Flow 5: Navigation on entry ──
  flowNavigation(token);
  sleep(1);

  // ── Flow 11: Sync state on login ──
  flowSync(token);
  sleep(1);

  // ── Flow 2: Portfolio ──
  flowPortfolio(token);
  sleep(randomIntBetween(2, 5));

  // ── Flow 7: Videos (feed) ──
  flowVideos(token);
  sleep(1);

  // ── Flow 8 & 9: Like + Save ──
  const clipId = `clip-${randomIntBetween(1, 100)}`;
  flowLike(token, clipId);
  flowSave(token, clipId);
  sleep(randomIntBetween(1, 3));

  // ── Flow 10: Notifications ──
  flowNotifications(token);
  sleep(1);

  // ── Market data ──
  flowMarket(token);
  sleep(randomIntBetween(1, 2));

  // ── Paper trading ──
  flowPaper(token);
  sleep(1);

  // ── Flow 3 & 4: Chat (heavy — only 60% of users per cycle) ──
  if (Math.random() < 0.6) {
    flowChat(token);
    sleep(randomIntBetween(3, 8));
  }

  // ── Flow 6: Screener (30% of users) ──
  if (Math.random() < 0.3) {
    flowScreener(token);
    sleep(randomIntBetween(2, 5));
  }

  // Cool-down between iterations
  sleep(randomIntBetween(5, 15));
}

// ── Teardown: print summary ───────────────────────────────────────────────────

export function handleSummary(data) {
  const tier = TIER;
  const p95  = data.metrics.http_req_duration?.values?.["p(95)"] ?? 0;
  const p99  = data.metrics.http_req_duration?.values?.["p(99)"] ?? 0;
  const errRate = (data.metrics.http_req_failed?.values?.rate ?? 0) * 100;
  const rps   = data.metrics.http_reqs?.values?.rate ?? 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  NUVOS AI — LOAD TEST TIER ${tier} USUARIOS`);
  console.log("=".repeat(60));
  console.log(`  VUs (peak):        ${tier}`);
  console.log(`  Requests/seg:      ${rps.toFixed(1)}`);
  console.log(`  P95 latency:       ${p95.toFixed(0)} ms`);
  console.log(`  P99 latency:       ${p99.toFixed(0)} ms`);
  console.log(`  Error rate:        ${errRate.toFixed(2)}%`);
  console.log(`  Login errors:      ${((data.metrics.login_errors?.values?.rate ?? 0) * 100).toFixed(2)}%`);
  console.log(`  Chat errors:       ${((data.metrics.chat_errors?.values?.rate ?? 0) * 100).toFixed(2)}%`);
  console.log(`  Timeout errors:    ${((data.metrics.timeout_errors?.values?.rate ?? 0) * 100).toFixed(2)}%`);
  console.log("=".repeat(60));

  // Interpret result
  if (errRate < 1 && p95 < 2000) {
    console.log(`  RESULTADO: ✅ TIER ${tier} SOPORTADO`);
  } else if (errRate < 5 && p95 < 5000) {
    console.log(`  RESULTADO: ⚠️  TIER ${tier} DEGRADADO (aceptable con optimizaciones)`);
  } else {
    console.log(`  RESULTADO: ❌ TIER ${tier} EXCEDE CAPACIDAD`);
  }
  console.log("=".repeat(60) + "\n");

  return {
    stdout: JSON.stringify(data, null, 2),
    [`reports/k6_tier${tier}_${new Date().toISOString().split("T")[0]}.json`]: JSON.stringify(data),
  };
}
