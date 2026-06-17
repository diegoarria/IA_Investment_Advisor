"""
Nuvos AI — Comprehensive Load & Stress Test Suite
===================================================

Simulates three distinct user behavior classes:
  - NormalUser  (weight=60): light usage, 1-3 actions/min, realistic think times
  - PowerUser   (weight=30): heavy usage, 5-10 actions/min, power-user flows
  - BotUser     (weight=10): rapid API calls simulating mobile background sync

All endpoints from the task specification are covered.

Usage:
    pip install locust

    # Web dashboard (http://localhost:8089):
    locust -f locust_nuvos.py --host=http://localhost:8000

    # Headless — 100 users:
    locust -f locust_nuvos.py --host=http://localhost:8000 \\
           --headless -u 100 -r 5 --run-time 3m \\
           --html reports/nuvos_100u.html --csv reports/nuvos_100u

    # Headless — 500 users:
    locust -f locust_nuvos.py --host=http://localhost:8000 \\
           --headless -u 500 -r 20 --run-time 5m \\
           --html reports/nuvos_500u.html

    # Headless — 1,000 users:
    locust -f locust_nuvos.py --host=http://localhost:8000 \\
           --headless -u 1000 -r 50 --run-time 10m \\
           --html reports/nuvos_1000u.html

    # Against production Railway URL:
    locust -f locust_nuvos.py --host=https://api.nuvosai.com \\
           --headless -u 50 -r 5 --run-time 5m \\
           --html reports/nuvos_prod_50u.html

Note: Replace EMAIL_DOMAIN with a real test domain pointing to your Supabase
and seed test users first, or the login flow will register new users on every run.
"""

import json
import random
import time
from locust import HttpUser, task, between, constant_throughput, events
from locust.exception import StopUser

# ── Test data ──────────────────────────────────────────────────────────────────

TICKERS = [
    "AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "GOOG", "META", "SPY", "QQQ",
    "VOO", "AMZN", "BRK-B", "JPM", "V", "NFLX", "AMD", "PLTR", "SOFI",
]

CHAT_MSGS_SHORT = [
    "¿Qué es el P/E ratio?",
    "Explícame qué es un ETF",
    "¿Qué es diversificación?",
    "¿Qué es el S&P 500?",
    "¿Cómo funciona el interés compuesto?",
    "¿Qué es el mercado de divisas?",
    "¿Qué son los bonos?",
]

CHAT_MSGS_MEDIUM = [
    "¿Qué opinas de Apple como inversión a largo plazo?",
    "¿Cuál es la diferencia entre ETF y acción individual?",
    "¿Cómo diversifico mi portafolio con $5000?",
    "¿Qué sectores son más resistentes en recesiones?",
    "¿Debo invertir en oro ahora?",
    "Analiza NVDA para mí",
    "¿Qué piensas de Tesla como inversión?",
    "¿Es buen momento para comprar SPY?",
]

EMAIL_PREFIX = "loadtest"
EMAIL_DOMAIN  = "nuvosai-test.com"
PASSWORD      = "LoadTest2024!"

SAMPLE_POSITIONS = [
    {"ticker": "AAPL", "shares": 10, "avgPrice": 150.0},
    {"ticker": "NVDA", "shares": 5,  "avgPrice": 300.0},
    {"ticker": "SPY",  "shares": 2,  "avgPrice": 450.0},
    {"ticker": "MSFT", "shares": 8,  "avgPrice": 280.0},
    {"ticker": "TSLA", "shares": 3,  "avgPrice": 200.0},
]

SAMPLE_PAPER_TRADES = [
    {"type": "buy", "ticker": "AAPL", "shares": 5, "price": 180.0, "timestamp": 1710000000000},
    {"type": "buy", "ticker": "NVDA", "shares": 2, "price": 850.0, "timestamp": 1712000000000},
]


# ── Shared auth helper ─────────────────────────────────────────────────────────

class _AuthMixin:
    """Mixin that provides login + auth header management."""

    token: str | None = None
    user_id: str | None = None

    def _login(self, email: str, password: str) -> bool:
        """Attempt login; on 401, register then re-login. Returns True on success."""
        with self.client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
            name="Auth: Login",
            catch_response=True,
        ) as res:
            if res.status_code == 200:
                body = res.json()
                self.token   = body.get("access_token")
                self.user_id = body.get("user_id")
                res.success()
                return True
            elif res.status_code in (400, 401):
                # User doesn't exist — register first
                res.success()  # don't count as failure
                return self._register_then_login(email, password)
            else:
                res.failure(f"Login error: {res.status_code}")
                return False

    def _register_then_login(self, email: str, password: str) -> bool:
        reg = self.client.post(
            "/api/auth/register",
            json={"email": email, "password": password},
            name="Auth: Register",
        )
        if reg.status_code not in (200, 201):
            return False
        body = reg.json()
        self.token   = body.get("access_token")
        self.user_id = body.get("user_id")
        return bool(self.token)

    @property
    def auth(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type":  "application/json",
        }


# ── NormalUser (weight=60) ────────────────────────────────────────────────────

class NormalUser(_AuthMixin, HttpUser):
    """
    Simulates a typical Nuvos user:
    - Light usage: 1-3 actions per minute
    - Think time: 20-60 seconds between tasks (between(20, 60))
    - Actions: portfolio viewing, chat, notifications, feed
    """
    weight    = 60
    wait_time = between(20, 60)  # 1-3 actions per minute

    def on_start(self):
        uid   = random.randint(1, 200_000)
        email = f"{EMAIL_PREFIX}+{uid}@{EMAIL_DOMAIN}"
        if not self._login(email, PASSWORD):
            raise StopUser()
        # Warm up: fetch all state (mirrors real app on login)
        self.client.get("/api/sync/all", headers=self.auth, name="Sync: Get all (login warm-up)")

    # ── Portfolio: read-heavy ───────────────────────────────────────────────

    @task(10)
    def get_portfolio(self):
        """GET /api/sync/all — most common action after login."""
        self.client.get("/api/sync/all", headers=self.auth, name="Sync: GET /all")

    @task(8)
    def get_portfolio_positions(self):
        self.client.get("/api/sync/portfolio", headers=self.auth, name="Sync: GET /portfolio")

    @task(6)
    def get_market_prices(self):
        """POST /api/market/prices — fetch prices for portfolio."""
        tickers = random.sample(TICKERS, k=random.randint(2, 5))
        self.client.post(
            "/api/market/prices",
            json={"symbols": tickers},
            headers=self.auth,
            name="Market: POST /prices",
        )

    @task(4)
    def get_watchlist(self):
        """GET /api/watchlist — check watchlist."""
        self.client.get("/api/watchlist", headers=self.auth, name="Watchlist: GET")

    @task(3)
    def get_profile(self):
        """GET /api/profile — view profile."""
        self.client.get("/api/profile", headers=self.auth, name="Profile: GET")

    # ── Chat: occasional ─────────────────────────────────────────────────

    @task(5)
    def get_chat_history(self):
        """GET /api/chat/history — open chat."""
        self.client.get("/api/chat/history", headers=self.auth, name="Chat: GET /history")

    @task(2)
    def send_chat_message(self):
        """POST /api/chat/message — send a short AI chat message."""
        msg = random.choice(CHAT_MSGS_SHORT)
        with self.client.post(
            "/api/chat/message",
            json={"message": msg, "conversation_history": [], "mentor": None},
            headers=self.auth,
            name="Chat: POST /message",
            timeout=60,
            catch_response=True,
        ) as res:
            if res.status_code == 200:
                res.success()
            elif res.status_code == 429:
                res.success()  # rate limited — expected under load
            else:
                res.failure(f"Chat error {res.status_code}")

    # ── Notifications ──────────────────────────────────────────────────

    @task(6)
    def get_notifications(self):
        """GET /api/notifications — check notifications."""
        self.client.get("/api/notifications", headers=self.auth, name="Notifications: GET")

    # ── Leaderboard ────────────────────────────────────────────────────

    @task(2)
    def get_leaderboard(self):
        """GET /api/leaderboard — view leaderboard."""
        period = random.choice(["ytd", "1m", "1w"])
        self.client.get(
            f"/api/leaderboard?period={period}",
            headers=self.auth,
            name="Leaderboard: GET",
        )

    # ── Feed ────────────────────────────────────────────────────────────

    @task(5)
    def get_feed_clips(self):
        """GET /api/feed/clips — video feed."""
        sort = random.choice(["recent", "trending"])
        with self.client.get(
            f"/api/feed/clips?cursor=0&limit=10&sort={sort}",
            headers=self.auth,
            name="Feed: GET /clips",
            catch_response=True,
        ) as res:
            if res.status_code == 200:
                res.success()
            else:
                res.failure(f"Feed error {res.status_code}")

    # ── Paper trading: occasional read ─────────────────────────────────

    @task(2)
    def get_paper(self):
        """GET /api/sync/paper — paper trading state."""
        self.client.get("/api/sync/paper", headers=self.auth, name="Paper: GET /paper")

    # ── Market indices: occasional ─────────────────────────────────────

    @task(3)
    def get_market_indices(self):
        """GET /api/market/indices — market indices."""
        self.client.get("/api/market/indices", headers=self.auth, name="Market: GET /indices")


# ── PowerUser (weight=30) ─────────────────────────────────────────────────────

class PowerUser(_AuthMixin, HttpUser):
    """
    Simulates a power Nuvos user:
    - Heavy usage: 5-10 actions per minute
    - Think time: 6-12 seconds between tasks
    - Actions: chat, portfolio analysis, screener, paper trading, sync writes
    """
    weight    = 30
    wait_time = between(6, 12)  # 5-10 actions per minute

    def on_start(self):
        uid   = random.randint(200_001, 400_000)
        email = f"{EMAIL_PREFIX}+{uid}@{EMAIL_DOMAIN}"
        if not self._login(email, PASSWORD):
            raise StopUser()
        self.client.get("/api/sync/all", headers=self.auth, name="Sync: GET /all (power-user login)")
        self._clip_ids: list[str] = []

    # ── Portfolio — write + read ────────────────────────────────────────

    @task(8)
    def sync_portfolio(self):
        """POST /api/sync/portfolio — push updated portfolio."""
        positions = random.sample(SAMPLE_POSITIONS, k=random.randint(2, 4))
        self.client.post(
            "/api/sync/portfolio",
            json={"positions": positions, "currency": "USD"},
            headers=self.auth,
            name="Sync: POST /portfolio",
        )

    @task(6)
    def get_portfolio(self):
        self.client.get("/api/sync/all", headers=self.auth, name="Sync: GET /all")

    # ── Market — prices + chart ────────────────────────────────────────

    @task(8)
    def get_market_prices(self):
        tickers = random.sample(TICKERS, k=random.randint(3, 8))
        self.client.post(
            "/api/market/prices",
            json={"symbols": tickers},
            headers=self.auth,
            name="Market: POST /prices",
        )

    @task(4)
    def get_chart(self):
        """GET /api/market/chart/:ticker — view stock chart."""
        ticker = random.choice(TICKERS[:8])
        period = random.choice(["1d", "1m", "1y"])
        self.client.get(
            f"/api/market/chart/{ticker}?period={period}",
            headers=self.auth,
            name="Market: GET /chart",
            timeout=15,
        )

    # ── Chat — frequent, medium-length messages ─────────────────────────

    @task(8)
    def get_chat_history(self):
        self.client.get("/api/chat/history", headers=self.auth, name="Chat: GET /history")

    @task(5)
    def send_chat_message(self):
        msg = random.choice(CHAT_MSGS_MEDIUM)
        with self.client.post(
            "/api/chat/message",
            json={"message": msg, "conversation_history": [], "mentor": None},
            headers=self.auth,
            name="Chat: POST /message (power)",
            timeout=60,
            catch_response=True,
        ) as res:
            if res.status_code in (200, 429):
                res.success()
            else:
                res.failure(f"Chat error {res.status_code}")

    @task(3)
    def save_chat_message(self):
        """POST /api/chat/save-message — save a chat message."""
        import uuid
        self.client.post(
            "/api/chat/save-message",
            json={
                "role": "user",
                "content": random.choice(CHAT_MSGS_SHORT),
                "session_id": str(uuid.uuid4()),
            },
            headers=self.auth,
            name="Chat: POST /save-message",
        )

    # ── Watchlist — read + write ────────────────────────────────────────

    @task(5)
    def get_watchlist(self):
        self.client.get("/api/watchlist", headers=self.auth, name="Watchlist: GET")

    @task(2)
    def add_to_watchlist(self):
        """POST /api/watchlist — add ticker to watchlist."""
        ticker = random.choice(TICKERS[:6])
        with self.client.post(
            "/api/watchlist",
            json={"ticker": ticker, "name": ticker},
            headers=self.auth,
            name="Watchlist: POST (add)",
            catch_response=True,
        ) as res:
            if res.status_code in (200, 201, 409):  # 409 = already in list
                res.success()
            else:
                res.failure(f"Watchlist add error {res.status_code}")

    # ── Notifications ──────────────────────────────────────────────────

    @task(4)
    def get_notifications(self):
        self.client.get("/api/notifications", headers=self.auth, name="Notifications: GET")

    # ── Leaderboard ────────────────────────────────────────────────────

    @task(3)
    def get_leaderboard(self):
        period = random.choice(["ytd", "1m", "1w"])
        self.client.get(
            f"/api/leaderboard?period={period}",
            headers=self.auth,
            name="Leaderboard: GET",
        )

    # ── Feed — interactions ────────────────────────────────────────────

    @task(4)
    def get_feed_clips(self):
        sort = random.choice(["recent", "trending", "random"])
        with self.client.get(
            f"/api/feed/clips?cursor=0&limit=10&sort={sort}",
            headers=self.auth,
            name="Feed: GET /clips",
            catch_response=True,
        ) as res:
            if res.status_code == 200:
                try:
                    body = res.json()
                    self._clip_ids = [c["id"] for c in (body.get("clips") or [])[:5]]
                except Exception:
                    pass
                res.success()
            else:
                res.failure(f"Feed error {res.status_code}")

    # ── Paper trading — write ───────────────────────────────────────────

    @task(4)
    def sync_paper(self):
        """POST /api/sync/paper — push paper trading state."""
        self.client.post(
            "/api/sync/paper",
            json={
                "cash":      random.uniform(5000, 15000),
                "positions": random.sample(SAMPLE_POSITIONS, k=2),
                "trades":    SAMPLE_PAPER_TRADES,
            },
            headers=self.auth,
            name="Paper: POST /paper",
        )

    @task(3)
    def get_paper(self):
        self.client.get("/api/sync/paper", headers=self.auth, name="Paper: GET /paper")

    # ── Maturity sync ──────────────────────────────────────────────────

    @task(2)
    def sync_maturity(self):
        """POST /api/sync/maturity — sync maturity score."""
        self.client.post(
            "/api/sync/maturity",
            json={"score": random.randint(10, 80), "history": []},
            headers=self.auth,
            name="Sync: POST /maturity",
        )

    # ── Profile ────────────────────────────────────────────────────────

    @task(3)
    def get_profile(self):
        self.client.get("/api/profile", headers=self.auth, name="Profile: GET")

    # ── Market portfolio returns ────────────────────────────────────────

    @task(2)
    def portfolio_returns(self):
        """POST /api/market/portfolio-returns — compute period returns."""
        tickers = random.sample(TICKERS[:8], k=3)
        self.client.post(
            "/api/market/portfolio-returns",
            json={
                "positions": [
                    {
                        "ticker": t,
                        "shares": random.uniform(1, 20),
                        "avg_price": random.uniform(50, 800),
                    }
                    for t in tickers
                ]
            },
            headers=self.auth,
            name="Market: POST /portfolio-returns",
            timeout=30,
        )

    # ── Behavioral risk sync ────────────────────────────────────────────

    @task(1)
    def sync_behavioral_risk(self):
        self.client.post(
            "/api/sync/behavioral-risk",
            json={"score": random.randint(20, 80)},
            headers=self.auth,
            name="Sync: POST /behavioral-risk",
        )


# ── BotUser (weight=10) ───────────────────────────────────────────────────────

class BotUser(_AuthMixin, HttpUser):
    """
    Simulates mobile background sync:
    - Rapid API calls: ~0.5 requests/second (constant throughput)
    - No think time between tasks
    - Focus on sync endpoints (portfolio, paper, maturity, behavioral-risk)
    - Mimics iOS/Android background app refresh
    """
    weight    = 10
    wait_time = between(1, 3)  # rapid: ~1-3 seconds between tasks

    def on_start(self):
        uid   = random.randint(400_001, 600_000)
        email = f"{EMAIL_PREFIX}+{uid}@{EMAIL_DOMAIN}"
        if not self._login(email, PASSWORD):
            raise StopUser()
        # Bots always start with a full sync
        self.client.get("/api/sync/all", headers=self.auth, name="Bot: Sync GET /all (init)")

    # ── High-frequency sync writes ─────────────────────────────────────

    @task(15)
    def sync_portfolio_bot(self):
        """Frequent portfolio push — simulates real-time mobile sync."""
        positions = [random.choice(SAMPLE_POSITIONS)]
        self.client.post(
            "/api/sync/portfolio",
            json={"positions": positions, "currency": "USD"},
            headers=self.auth,
            name="Bot: POST /sync/portfolio",
        )

    @task(12)
    def sync_paper_bot(self):
        """Push paper trading state — simulates background save."""
        self.client.post(
            "/api/sync/paper",
            json={
                "cash":      random.uniform(8000, 12000),
                "positions": [random.choice(SAMPLE_POSITIONS)],
                "trades":    [],
            },
            headers=self.auth,
            name="Bot: POST /sync/paper",
        )

    @task(10)
    def sync_all_read(self):
        """Full state restore — frequent on background app refresh."""
        self.client.get("/api/sync/all", headers=self.auth, name="Bot: GET /sync/all")

    @task(8)
    def get_market_prices(self):
        """POST /api/market/prices — price polling."""
        tickers = random.sample(TICKERS, k=random.randint(1, 4))
        self.client.post(
            "/api/market/prices",
            json={"symbols": tickers},
            headers=self.auth,
            name="Bot: POST /market/prices",
        )

    @task(6)
    def sync_push_token(self):
        """POST /api/sync/push-token — periodic push token refresh."""
        self.client.post(
            "/api/sync/push-token",
            json={"token": f"ExponentPushToken[bot-{random.randint(1000, 9999)}]"},
            headers=self.auth,
            name="Bot: POST /sync/push-token",
        )

    @task(5)
    def sync_maturity_bot(self):
        self.client.post(
            "/api/sync/maturity",
            json={"score": random.randint(0, 100), "history": []},
            headers=self.auth,
            name="Bot: POST /sync/maturity",
        )

    @task(5)
    def get_chat_history_bot(self):
        """GET /api/chat/history — polling for new messages."""
        self.client.get("/api/chat/history?limit=20", headers=self.auth, name="Bot: GET /chat/history")

    @task(4)
    def get_notifications_bot(self):
        self.client.get("/api/notifications", headers=self.auth, name="Bot: GET /notifications")

    @task(3)
    def sync_behavioral_risk_bot(self):
        self.client.post(
            "/api/sync/behavioral-risk",
            json={"score": random.randint(10, 90)},
            headers=self.auth,
            name="Bot: POST /sync/behavioral-risk",
        )

    @task(2)
    def health_check(self):
        """Periodic health check — simulates Expo health polling."""
        self.client.get("/health", name="Bot: GET /health")


# ── Event hooks: per-run summary ──────────────────────────────────────────────

@events.quitting.add_listener
def on_quitting(environment, **kwargs):
    stats = environment.stats
    total = stats.total

    print("\n" + "=" * 70)
    print("  NUVOS AI — LOAD TEST SUMMARY")
    print("=" * 70)
    print(f"  Total requests :  {total.num_requests:,}")
    print(f"  Failures       :  {total.num_failures:,}  ({total.fail_ratio * 100:.2f}%)")
    print(f"  Avg response   :  {total.avg_response_time:.0f} ms")
    print(f"  P50            :  {total.get_response_time_percentile(0.50):.0f} ms")
    print(f"  P90            :  {total.get_response_time_percentile(0.90):.0f} ms")
    print(f"  P95            :  {total.get_response_time_percentile(0.95):.0f} ms")
    print(f"  P99            :  {total.get_response_time_percentile(0.99):.0f} ms")
    print(f"  Peak RPS       :  {total.current_rps:.1f}")
    print(f"  Max response   :  {total.max_response_time:.0f} ms")

    fail_ratio = total.fail_ratio * 100
    if fail_ratio < 1:
        status = "PASS ✅"
    elif fail_ratio < 5:
        status = "WARN ⚠️"
    else:
        status = "FAIL ❌"
    print(f"\n  Overall Status:  {status}  (failure threshold: <1%)")
    print("=" * 70)

    print("\n  SLOWEST ENDPOINTS (P95 > 2,000 ms):")
    for name, entry in sorted(stats.entries.items(), key=lambda x: -x[1].avg_response_time):
        p95 = entry.get_response_time_percentile(0.95) or 0
        if p95 > 2000:
            print(
                f"    {str(name[1])[:60]:<60}  p95={p95:>6.0f}ms"
                f"  fails={entry.num_failures:>4}"
            )

    print("\n  HIGH ERROR ENDPOINTS (fail rate > 5%):")
    for name, entry in stats.entries.items():
        if entry.num_requests > 0:
            fr = entry.num_failures / entry.num_requests * 100
            if fr > 5:
                print(
                    f"    {str(name[1])[:60]:<60}  fails={fr:.1f}%"
                    f"  ({entry.num_failures}/{entry.num_requests})"
                )

    print("=" * 70 + "\n")
