"""
Nuvos AI — Locust Load Test Suite
==================================

Cubre los 11 flujos de usuario con pesos realistas.

Instalación:
    pip install locust

Uso:
    # Modo web (dashboard en http://localhost:8089):
    locust -f locustfile.py --host=http://localhost:8000

    # Modo headless — 100 usuarios, 10 spawn/seg, 3 minutos:
    locust -f locustfile.py --host=http://localhost:8000 \
           --headless -u 100 -r 10 --run-time 3m \
           --html reports/locust_100u.html

    # Contra producción:
    locust -f locustfile.py --host=https://api.nuvosai.com \
           --headless -u 500 -r 20 --run-time 5m \
           --html reports/locust_500u.html

    # CSV output:
    locust -f locustfile.py --host=http://localhost:8000 \
           --headless -u 200 -r 10 --run-time 3m \
           --csv reports/locust_200u

Tiers disponibles de prueba (arg -u):
    50, 100, 200, 500, 1000, 5000, 10000
"""

import json
import random
import time
from locust import HttpUser, task, between, events
from locust.exception import StopUser

# ── Test data ─────────────────────────────────────────────────────────────────

TICKERS = ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "GOOG", "META", "SPY", "QQQ", "VOO"]
CHAT_MSGS = [
    "¿Qué opinas de Apple como inversión a largo plazo?",
    "Explícame qué es el P/E ratio",
    "¿Cuál es la diferencia entre ETF y acción individual?",
    "¿Cómo diversifico mi portafolio con $5000?",
    "¿Qué sectores son más resistentes en recesiones?",
    "¿Debo invertir en oro ahora?",
    "Analiza NVDA para mí",
]
SCREENER_Q = [
    "mejor tecnología para largo plazo",
    "acciones defensivas con dividendos",
    "alta rentabilidad por dividendo",
    "small caps con potencial",
]

# Credentials — use real test accounts seeded in Supabase
EMAIL_PREFIX = "loadtest"
EMAIL_DOMAIN = "nuvosai-test.com"
PASSWORD     = "LoadTest2024!"

# ── Base user ─────────────────────────────────────────────────────────────────

class NuvosUser(HttpUser):
    """
    Simulates a logged-in Nuvos user performing the 11 key flows.
    Task weights reflect observed real usage patterns:
      - Market data & portfolio:  most frequent (35%)
      - Navigation / sync:        frequent (20%)
      - Videos + interactions:    moderate (20%)
      - Chat:                     moderate (15%)
      - Screener:                 occasional (10%)
    """

    # Think time between tasks: 2–8 seconds (realistic user pace)
    wait_time = between(2, 8)

    token: str | None = None
    user_id: str | None = None
    clip_ids: list[str] = []

    # ── Setup ─────────────────────────────────────────────────────────────────

    def on_start(self):
        """Flow 1: Login — every VU starts here."""
        uid   = random.randint(1, 99_999)
        email = f"{EMAIL_PREFIX}+{uid}@{EMAIL_DOMAIN}"

        with self.client.post(
            "/api/auth/login",
            json={"email": email, "password": PASSWORD},
            name="[1] Auth: Login",
            catch_response=True,
        ) as res:
            if res.status_code == 200:
                body = res.json()
                self.token   = body.get("access_token")
                self.user_id = body.get("user_id") or body.get("id")
                res.success()
            elif res.status_code == 401:
                # Register first if not existing
                self._register_and_login(email)
            else:
                res.failure(f"Login failed: {res.status_code}")
                raise StopUser()

        if not self.token:
            raise StopUser()

        # Warm up: fetch initial sync state (mirrors real app behavior)
        self._sync_all()

    def _register_and_login(self, email: str):
        reg = self.client.post(
            "/api/auth/register",
            json={"email": email, "password": PASSWORD},
            name="[1] Auth: Register",
        )
        if reg.status_code in (200, 201):
            res = self.client.post(
                "/api/auth/login",
                json={"email": email, "password": PASSWORD},
                name="[1] Auth: Login (after register)",
            )
            if res.status_code == 200:
                body = res.json()
                self.token   = body.get("access_token")
                self.user_id = body.get("user_id") or body.get("id")

    @property
    def auth(self) -> dict:
        return {
            "Authorization":  f"Bearer {self.token}",
            "Content-Type":   "application/json",
        }

    # ── Flow 11: Sync ─────────────────────────────────────────────────────────

    def _sync_all(self):
        self.client.get(
            "/api/sync/all",
            headers=self.auth,
            name="[11] Sync: Get all state",
        )

    # ── Flow 2: Portfolio ─────────────────────────────────────────────────────

    @task(8)
    def portfolio_get(self):
        self.client.get(
            "/api/sync/portfolio",
            headers=self.auth,
            name="[2] Portfolio: Get positions",
        )

    @task(5)
    def portfolio_prices(self):
        tickers = random.sample(TICKERS, k=random.randint(2, 5))
        self.client.post(
            "/api/market/prices",
            json={"symbols": tickers},
            headers=self.auth,
            name="[2] Portfolio: Market prices",
        )

    @task(2)
    def portfolio_returns(self):
        tickers = random.sample(TICKERS, k=2)
        self.client.post(
            "/api/market/portfolio-returns",
            json={
                "positions": [
                    {"ticker": t, "shares": random.randint(1, 20),
                     "avg_price": random.uniform(50, 500)}
                    for t in tickers
                ]
            },
            headers=self.auth,
            name="[2] Portfolio: Returns calculation",
            timeout=20,
        )

    # ── Flow 3 & 4: Chat ──────────────────────────────────────────────────────

    @task(4)
    def chat_history(self):
        """Flow 3: Open chat — fetch history."""
        self.client.get(
            "/api/chat/history",
            headers=self.auth,
            name="[3] Chat: Load history",
        )

    @task(3)
    def chat_send_message(self):
        """Flow 4: Send message to AI."""
        msg = random.choice(CHAT_MSGS)
        with self.client.post(
            "/api/chat/message",
            json={"message": msg, "conversation_history": [], "mentor": None},
            headers=self.auth,
            name="[4] Chat: Send message (AI)",
            timeout=60,
            catch_response=True,
        ) as res:
            if res.status_code == 200:
                body = res.json()
                if body.get("reply"):
                    res.success()
                else:
                    res.failure("No reply in response")
            elif res.status_code == 429:
                res.success()  # Rate-limited: expected under load
            else:
                res.failure(f"Chat error: {res.status_code}")

    # ── Flow 5: Navigation ────────────────────────────────────────────────────

    @task(5)
    def navigation(self):
        """Flow 5: Navigate between screens (profile + notif)."""
        self.client.get(
            "/api/profile",
            headers=self.auth,
            name="[5] Nav: Profile page",
        )

    @task(3)
    def sync_nav_order(self):
        """Flow 5: Save navigation order."""
        self.client.post(
            "/api/sync/nav-order",
            json={"order": ["/chat", "/portfolio", "/watchlist", "/learn"]},
            headers=self.auth,
            name="[5] Nav: Sync nav order",
        )

    # ── Flow 6: Screener ──────────────────────────────────────────────────────

    @task(2)
    def screener(self):
        """Flow 6: Run AI screener query."""
        with self.client.post(
            "/api/market/screener",
            json={"sector": None, "query": random.choice(SCREENER_Q)},
            headers=self.auth,
            name="[6] Screener: AI search",
            timeout=30,
            catch_response=True,
        ) as res:
            if res.status_code in (200, 429):
                res.success()
            else:
                res.failure(f"Screener {res.status_code}")

    # ── Flow 7: Videos ────────────────────────────────────────────────────────

    @task(5)
    def feed_clips(self):
        """Flow 7: Load video feed."""
        with self.client.get(
            "/api/feed/clips?page=1&limit=10",
            headers=self.auth,
            name="[7] Feed: Load clips",
            catch_response=True,
        ) as res:
            if res.status_code == 200:
                try:
                    body = res.json()
                    clips = body.get("clips") or body.get("data") or []
                    if clips:
                        self.clip_ids = [c.get("id", f"clip-{i}") for i, c in enumerate(clips[:5])]
                except Exception:
                    pass
                res.success()
            else:
                res.failure(f"Feed {res.status_code}")

    # ── Flow 8: Like ─────────────────────────────────────────────────────────

    @task(3)
    def like_clip(self):
        """Flow 8: Like a video."""
        clip_id = random.choice(self.clip_ids) if self.clip_ids else f"clip-{random.randint(1, 50)}"
        res = self.client.post(
            f"/api/feed/clips/{clip_id}/like",
            headers=self.auth,
            name="[8] Feed: Like clip",
        )
        # 409 = already liked — expected
        if res.status_code not in (200, 201, 409, 404):
            pass  # non-fatal

    # ── Flow 9: Save ─────────────────────────────────────────────────────────

    @task(2)
    def save_clip(self):
        """Flow 9: Save a video."""
        clip_id = random.choice(self.clip_ids) if self.clip_ids else f"clip-{random.randint(1, 50)}"
        res = self.client.post(
            f"/api/feed/clips/{clip_id}/save",
            headers=self.auth,
            name="[9] Feed: Save clip",
        )
        if res.status_code not in (200, 201, 409, 404):
            pass

    # ── Flow 10: Notifications ────────────────────────────────────────────────

    @task(3)
    def notifications(self):
        """Flow 10: Check notifications."""
        self.client.get(
            "/api/notifications",
            headers=self.auth,
            name="[10] Notifications: Get all",
        )

    # ── Flow 11: Real-time sync ───────────────────────────────────────────────

    @task(2)
    def sync_portfolio_push(self):
        """Flow 11: Push portfolio state (real-time sync)."""
        tickers = random.sample(TICKERS, k=2)
        self.client.post(
            "/api/sync/portfolio",
            json={
                "positions": [
                    {"ticker": t, "shares": random.randint(1, 10),
                     "avgPrice": random.uniform(100, 400)}
                    for t in tickers
                ],
                "currency": "USD",
            },
            headers=self.auth,
            name="[11] Sync: Push portfolio",
        )

    @task(1)
    def sync_behavioral_risk(self):
        """Flow 11: Sync behavioral risk score."""
        self.client.post(
            "/api/sync/behavioral-risk",
            json={"score": random.randint(20, 80)},
            headers=self.auth,
            name="[11] Sync: Behavioral risk",
        )

    # ── Market data extras ────────────────────────────────────────────────────

    @task(3)
    def market_indices(self):
        self.client.get(
            "/api/market/indices",
            headers=self.auth,
            name="Market: Indices (cached)",
        )

    @task(2)
    def market_movers(self):
        self.client.get(
            "/api/market/movers",
            headers=self.auth,
            name="Market: Movers",
        )

    @task(2)
    def watchlist(self):
        self.client.get(
            "/api/watchlist",
            headers=self.auth,
            name="Watchlist: Get",
        )

    @task(1)
    def paper_state(self):
        self.client.get(
            "/api/sync/paper",
            headers=self.auth,
            name="Paper: Get state",
        )


# ── Events: per-run summary ───────────────────────────────────────────────────

@events.quitting.add_listener
def on_quitting(environment, **kwargs):
    stats = environment.stats
    total = stats.total

    print("\n" + "=" * 60)
    print("  NUVOS AI — LOCUST PERFORMANCE SUMMARY")
    print("=" * 60)
    print(f"  Total requests:   {total.num_requests:,}")
    print(f"  Failures:         {total.num_failures:,} ({total.fail_ratio*100:.2f}%)")
    print(f"  Avg response:     {total.avg_response_time:.0f} ms")
    print(f"  P50:              {total.get_response_time_percentile(0.50):.0f} ms")
    print(f"  P95:              {total.get_response_time_percentile(0.95):.0f} ms")
    print(f"  P99:              {total.get_response_time_percentile(0.99):.0f} ms")
    print(f"  Req/seg (peak):   {total.current_rps:.1f}")
    print(f"  Max response:     {total.max_response_time:.0f} ms")
    print("=" * 60)

    # Per-endpoint breakdown of slow requests
    print("\n  ENDPOINTS MÁS LENTOS (P95 > 3000 ms):")
    for name, entry in sorted(stats.entries.items(), key=lambda x: -x[1].avg_response_time):
        p95 = entry.get_response_time_percentile(0.95)
        if p95 and p95 > 3000:
            print(f"    {name[1][:55]:<55} p95={p95:.0f}ms  fails={entry.num_failures}")
    print("=" * 60 + "\n")


# ── Separate stress class: read-only, no auth ─────────────────────────────────

class NuvosPublicUser(HttpUser):
    """
    Simulates unauthenticated traffic hitting public endpoints.
    Use this to test CDN/static asset performance.
    Weight = 0 by default — activate from the Locust web UI.
    """
    weight    = 0
    wait_time = between(1, 3)
    host      = "http://localhost:8000"

    @task
    def health(self):
        self.client.get("/health", name="Health check")

    @task
    def root(self):
        self.client.get("/", name="Root")
