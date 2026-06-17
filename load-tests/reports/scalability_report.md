# Nuvos AI Scalability Report — 2026-06-16

## Executive Summary

**Current max concurrent users:** ~100–200 (before degradation)  
**Biggest bottleneck:** Authentication validates every request against Supabase Auth (50–200ms overhead), leaderboard performs full table scans on every hit, and sync endpoints have no caching.  
**Overall risk level:** MEDIUM-HIGH. The platform can support a small user base today but will degrade sharply above 200 concurrent users without the fixes outlined below. The good news: all critical fixes are straightforward (caching, not architectural rewrites).

Note: All load figures below are **ESTIMATED** based on static code analysis. The backend server was not running locally during this analysis. Numbers are conservative estimates based on endpoint complexity, DB query patterns, thread pool sizes, and known FastAPI/Supabase characteristics.

---

## Architecture Overview

```
User (iOS / Android / Web)
      │
      ├─ Web (Next.js / Vercel)        ← CDN edge, auto-scales ✅
      └─ Mobile (React Native / Expo)  ← Stateless client ✅
            │
            ▼
   FastAPI Backend (Railway)           ← PRIMARY BOTTLENECK
   gunicorn -w 4 uvicorn.workers.UvicornWorker
            │
            ├─ Supabase (PostgreSQL / PostgREST)  ← SECONDARY BOTTLENECK
            │   supabase-py sync Client (wrapped in asyncio.to_thread)
            │   No PgBouncer configured
            │
            ├─ Redis (optional, if REDIS_URL set)  ← OK, pool=100 ✅
            │   Falls back to process-local dict (NOT shared between workers)
            │
            ├─ Anthropic API (Claude)               ← Semaphore(40) ✅
            │   AsyncAnthropic client
            │
            ├─ Yahoo Finance (yfinance + httpx)     ← TERTIARY BOTTLENECK
            │   No per-ticker price cache on /market/prices
            │
            └─ ElevenLabs / OpenAI (TTS/Whisper)  ← Low volume, OK
```

### What was found

- **22 route files**, all using the sync Supabase client offloaded to threads via `run_query()`
- **Module-level thread pools** already in place (correct pattern): `_MARKET_POOL(20)`, `_NEWS_POOL(10)`, `_ENRICH_POOL(4)`, `_PRICES_POOL(10)` in watchlist
- **Rate limiting** via `slowapi` — per-user on chat (30/min), portfolio screenshot (20/min), stream (20/min)
- **Caching layer** already built (`core/cache.py`) with Redis + in-memory fallback. Redis pool at 100 connections.
- **No caching** on: sync endpoints, leaderboard, feed/clips, market/prices (before this diff)
- **Gunicorn already configured** with 4 workers in Procfile

---

## Load Test Results

> **Note:** Server was not running locally. All metrics below are ESTIMATED from code complexity analysis. Run `locust -f load-tests/locust/locust_nuvos.py --host=<url>` for actual measurements.

### Pre-fix estimates (before this diff)

| Scenario | Users | Est. RPS | Avg Response | P95  | P99   | Est. Error Rate |
|----------|-------|----------|--------------|------|-------|-----------------|
| Normal   | 50    | ~15      | 400ms        | 1.5s | 3.0s  | <1%             |
| Stress   | 100   | ~20      | 800ms        | 4.0s | 10.0s | 3–8%            |
| Breaking | 200   | ~18      | 2.5s         | 12s  | 30s   | 20–40%          |
| Overload | 500   | ~10      | >30s         | —    | —     | >60%            |

### Post-fix estimates (after this diff + auth cache + price cache)

| Scenario   | Users | Est. RPS | Avg Response | P95   | P99   | Est. Error Rate |
|------------|-------|----------|--------------|-------|-------|-----------------|
| Normal     | 50    | ~25      | 150ms        | 400ms | 800ms | <0.1%           |
| Comfortable| 200   | ~60      | 300ms        | 800ms | 2.0s  | <0.5%           |
| Stress     | 500   | ~80      | 600ms        | 2.5s  | 5.0s  | 1–3%            |
| Breaking   | 1,000 | ~70      | 1.5s         | 8.0s  | 20s   | 5–15%           |
| Target*    | 2,000 | —        | —            | —     | —     | Requires Phase 2|

*Target requires async Supabase client + PgBouncer.

---

## Bottlenecks Found

### Critical (fix immediately)

**1. Leaderboard full table scan — `routes/leaderboard.py:99-112`**  
Every GET /api/leaderboard fetches ALL user portfolios and ALL user profiles from the DB, then calls `yf.download()` for every unique ticker. With 10,000 users this is a 10,000-row scan + a 3-10 second yfinance call on every page load.  
**Status: FIXED** — 5-minute shared board cache + 10-minute price cache added.

**2. Password reset codes in process memory — `routes/auth.py:14-16`**  
`_reset_codes` dict is process-local. With 4 gunicorn workers, the code generated in worker-1 is invisible to workers 2/3/4. ~75% of password resets fail silently in production.  
**Status: NOT FIXED** — move to Redis using `cache_get/cache_set`.

**3. Auth token validation on every request — `api/deps.py:11`**  
`db.auth.get_user(token)` is a 50–200ms network call to Supabase Auth on every authenticated request. Zero caching.  
**Status: NOT FIXED** — add 60-second token cache.

### High (fix before 10k users)

**4. POST /api/market/prices — no per-ticker cache**  
Same ticker fetched from Yahoo Finance independently by every requesting user. At 500 users, AAPL is fetched 500 times/minute. Yahoo Finance rate limits will trigger.  
**Status: NOT FIXED** — add 30-second per-ticker cache in `market.py:258`.

**5. GET /api/sync/all — 4 sequential DB queries**  
Called on every app startup. Four sequential DB queries that could be parallelized with `asyncio.gather()`. Caching added (20s TTL), but cache misses are still 4× slower than necessary.  
**Status: CACHING FIXED** — parallel fetch with `asyncio.gather` is the next optimization.

**6. AI chat — no timeout on semaphore wait**  
`asyncio.Semaphore(40)` limits concurrent Claude calls but doesn't timeout waiting requests. A slow Claude response holds 40 worker slots indefinitely.  
**Status: PARTIALLY MITIGATED** — add `asyncio.timeout(55)` wrapper.

### Medium (fix before 50k users)

**7. Supabase sync client blocks thread pool**  
All DB calls go through `asyncio.to_thread()` which offloads to a finite thread pool. True async Supabase client would eliminate this entirely.  
**Status: ARCHITECTURE LIMITATION** — needs supabase-py async API upgrade.

**8. In-memory cache not shared between workers**  
Without Redis, each worker has its own `_mem` cache. Cache hit rate drops from expected 80% to 25%. All caching benefits require `REDIS_URL` to be set.  
**Status: OPERATIONAL** — set `REDIS_URL` in Railway.

**9. Feed clips missing DB indexes**  
`clips(status, created_at)` and `clip_likes(user_id, clip_id)` indexes are missing. Feed queries will be full table scans at scale.  
**Status: NOT FIXED** — add 4 indexes in Supabase SQL editor.

---

## Cross-Device Consistency Analysis

| Concern | Status | Details |
|---------|--------|---------|
| Portfolio write race condition | LOW RISK | Last-write-wins upsert. Simultaneous iOS+Android writes are rare; full-state writes mean winner is deterministic. |
| Chat history ordering | SAFE | session_id added (migration 010), created_at indexed, server timestamp used for ordering |
| Risk score drift between devices | MEDIUM RISK | `behavioral_risk_score` computed client-side, synced to server. Different app versions = different scores. |
| Maturity score atomicity | SAFE | Single UPDATE sets both `maturity_score` + `maturity_history` — atomic at PostgreSQL level |
| UPSERT race conditions | SAFE | All use `INSERT ... ON CONFLICT DO UPDATE` — PostgreSQL atomic operation |
| Message rate limit race | LOW RISK | Read-then-increment on `msg_count` is not atomic. Two concurrent requests can both slip under the limit. |
| Password reset cross-worker | CRITICAL | Reset codes in process memory — fails ~75% of time in 4-worker setup |

---

## Scalability Roadmap

| Users | Infrastructure | Est. Monthly Cost | Key Changes Needed |
|-------|---------------|-------------------|--------------------|
| **1,000** | Railway Starter (1 instance, 4 workers) + Supabase Pro + Redis Upstash | $70–120/mo | Move password reset to Redis; add auth token cache; add price cache for /market/prices |
| **10,000** | Railway Standard (2 instances) + Supabase Pro + Upstash Redis | $300–500/mo | Async Supabase client; PgBouncer transaction mode; clips/leaderboard indexes; Redis required for cache sharing |
| **50,000** | Railway Pro (4 instances) + Supabase Team + Redis Cluster | $1,500–2,500/mo | Separate AI chat service; CDN for feed videos; read replicas; horizontal auto-scaling |
| **100,000** | AWS/ECS (8-16 containers) + RDS Multi-AZ + ElastiCache | $8,000–15,000/mo | Microservices (chat, market, sync); message queue for AI; Elasticsearch for screener; full observability stack |
| **500,000** | Multi-region AWS + Global Load Balancer | $40,000–80,000/mo | CQRS for read/write separation; Kafka for events; CDN-first architecture; Claude API batch pricing negotiation |
| **1,000,000** | Multi-cloud (AWS primary + Cloudflare Workers edge) | $80,000–150,000/mo | Edge computing for auth + price lookup; dedicated AI inference cluster; zero-downtime deploys; Anthropic enterprise tier |

**Dominant cost at scale:** Anthropic API. At 100k MAU assuming 10 messages/day × 1,000 tokens/msg output: ~1B tokens/day at claude-sonnet pricing ≈ $30,000/day. Consider caching common responses and using haiku for simple queries.

---

## Fixes Implemented

### In this analysis session

1. **`backend/app/api/routes/sync.py`** — added caching to all GET endpoints:
   - GET /sync/portfolio (30s), GET /sync/paper (30s), GET /sync/maturity (120s)
   - GET /sync/all (20s), GET /sync/nav-order (60s), GET /sync/theme (60s)
   - POST handlers invalidate relevant cache keys on write
   - Added module docstring explaining last-write-wins consistency model

2. **`backend/app/api/routes/leaderboard.py`** — fixed full-table-scan bottleneck:
   - 10-minute price cache in `_get_prices_for_period()` (sorted ticker key)
   - 5-minute shared board cache (per period) — personalization (is_me/my_rank) without DB
   - Subsequent requests for same period skip all DB + yfinance entirely

3. **`backend/app/api/routes/feed.py`** — added 60-second clip list cache:
   - Base clip list cached per (cursor, limit, speaker, tag, sort)
   - Per-user liked/saved state still fetched live for correctness
   - random sort intentionally bypasses cache

4. **`load-tests/locust/locust_nuvos.py`** — comprehensive load test file:
   - `NormalUser` (weight=60): 20–60s wait, 1-3 actions/min
   - `PowerUser` (weight=30): 6–12s wait, 5-10 actions/min
   - `BotUser` (weight=10): 1–3s wait, rapid mobile background sync
   - All 14 endpoint types from spec covered
   - Detailed per-run summary with slowest endpoints + high-error endpoints

5. **`load-tests/reports/bottleneck_analysis.txt`** — comprehensive findings (CRITICAL×3, HIGH×5, MEDIUM×9, LOW×3)

### Previously implemented (prior commits)

- Gunicorn 4-worker setup (`Procfile`)
- Redis connection pool at 100 connections (`core/cache.py`)
- Module-level ThreadPoolExecutors in market.py, chat.py, watchlist.py
- Claude API semaphore (Semaphore(40)) in `ai_service.py`
- Notifications cache (30s TTL) in `notifications.py`
- Profile cache (120s TTL) in `profile.py`
- Market indices cache (10/60s TTL) in `market.py`
- Chart data cache (60–900s TTL) in `market.py`
- Rate limiting via slowapi on chat and screenshot endpoints

---

## Recommendations

### Immediate (this week)

1. **Set `REDIS_URL` in Railway environment** — all cache fixes in this diff require Redis to work across workers. Without it, every worker has its own in-memory cache with ~25% hit rate instead of ~80%.

2. **Fix password reset codes (CRITICAL)** — move `_reset_codes` dict to Redis in `routes/auth.py:14-16`. Simple 30-minute fix that affects every user who forgets their password.

3. **Cache auth token validation** — add 60-second cache in `api/deps.py:11`. Saves 50–200ms on every single authenticated request. Highest ROI change possible.

4. **Add missing DB indexes** in Supabase SQL editor:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_clips_status_created ON clips(status, created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_clips_status_likes ON clips(status, like_count DESC);
   CREATE INDEX IF NOT EXISTS idx_clip_likes_user_clip ON clip_likes(user_id, clip_id);
   CREATE INDEX IF NOT EXISTS idx_clip_saves_user_clip ON clip_saves(user_id, clip_id);
   ```

### Short-term (next 2 weeks)

5. **Per-ticker price cache in `/market/prices`** — prevent Yahoo Finance rate limiting as user base grows. 2-hour implementation in `market.py:210-259`.

6. **Parallel DB queries in `/sync/all`** — replace 4 sequential `await run_query()` calls with `asyncio.gather()`. Reduces cache-miss latency by ~75%.

7. **Enable PgBouncer** in Supabase dashboard (Settings → Database → Connection Pooling → Transaction mode). Free, 10-minute configuration, prevents connection exhaustion at scale.

8. **Add Claude API timeout guard** — wrap `chat_stream` with `asyncio.timeout(55)` to prevent slow Claude responses from holding semaphore slots indefinitely.

### Medium-term (next month)

9. **Migrate Supabase to AsyncClient** when supabase-py async API is stable. This is the single biggest architectural change — eliminates thread pool bottleneck entirely.

10. **Move behavioral risk score computation server-side** — eliminate client-side drift across device versions.

11. **Trim paper trading trades array on write** — cap at 500 entries to prevent large JSONB payloads for active users.

12. **Run actual Locust load test** against staging/production with 50, 200, 500 users to validate estimated numbers and find actual breaking points.

---

*Report based on static code analysis of backend/ as of commit e3470ae. All performance figures are estimates — run actual load tests to validate.*
