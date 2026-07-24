import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.core.limiter import limiter
from app.api.routes import auth, profile, chat, market, notifications, screener, billing, learn, sync, paper, referral, support, earnings, simulate, decisions, watchlist, feed, financials, brokerage, notification_settings, price_alerts, actions, upsells, wrapped, push, feedback, progress, profile_financial, library, voice_call, benchmark, admin, research, investment_graph

_is_dev = settings.environment == "development"

app = FastAPI(
    title="Nuvo API",
    description="Educational AI investment advisor — teaches you to think like a professional investor",
    version="1.0.0",
    docs_url="/docs" if _is_dev else None,
    redoc_url="/redoc" if _is_dev else None,
    openapi_url="/openapi.json" if _is_dev else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_dev_origins = [
    "http://localhost:3000", "http://localhost:8081",
    "http://localhost:19006", "http://127.0.0.1:8081",
]
_prod_origins = [
    "https://nuvosai.com",
    "https://www.nuvosai.com",
    "https://nuvosai.vercel.app",
    "https://ia-investment-advisor-adv5o8d43-diego-arria-s-projects.vercel.app",
]
# Never fall back to wildcard — always use the explicit allowlist
_origins = list({settings.frontend_url} | set(_prod_origins) | (set(_dev_origins) if _is_dev else set()))
if "*" in _origins:
    _origins = _prod_origins + (_dev_origins if _is_dev else [])
_all_origins = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=not _all_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


logger = logging.getLogger("uvicorn.error")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

app.include_router(auth.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(market.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(screener.router,     prefix="/api")
app.include_router(billing.router,      prefix="/api")
app.include_router(learn.router,        prefix="/api")
app.include_router(sync.router,         prefix="/api")
app.include_router(paper.router,        prefix="/api")
app.include_router(referral.router,     prefix="/api")
app.include_router(support.router,      prefix="/api")
app.include_router(earnings.router,     prefix="/api")
app.include_router(simulate.router,     prefix="/api")
app.include_router(decisions.router,    prefix="/api")
app.include_router(investment_graph.router, prefix="/api")
app.include_router(watchlist.router,    prefix="/api")
app.include_router(feed.router,         prefix="/api")
app.include_router(financials.router,   prefix="/api")
app.include_router(brokerage.router,             prefix="/api")
app.include_router(notification_settings.router, prefix="/api")
app.include_router(price_alerts.router,         prefix="/api")
app.include_router(actions.router,              prefix="/api")
app.include_router(upsells.router,              prefix="/api")
app.include_router(wrapped.router)
app.include_router(push.router,     prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(profile_financial.router, prefix="/api")
app.include_router(library.router,           prefix="/api")
app.include_router(voice_call.router,        prefix="/api")
app.include_router(benchmark.router,         prefix="/api")
app.include_router(admin.router,             prefix="/api")
app.include_router(research.router,          prefix="/api")

# Scheduler runs in worker.py (separate process) — not here.
# This prevents duplicate job execution when the web process scales horizontally.


@app.get("/")
async def root():
    import os
    return {
        "name": "Nuvo",
        "version": "1.0.0",
        # Railway sets these automatically on every deploy — lets us confirm
        # exactly which commit is actually live, instead of guessing whether
        # a push actually deployed.
        "git_commit": os.getenv("RAILWAY_GIT_COMMIT_SHA", "unknown")[:12],
        "deployed_at": os.getenv("RAILWAY_DEPLOYMENT_ID", "unknown"),
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    """Liveness only — always 200 if the process is up. Use /health/ready for
    a real dependency check (what orchestration/monitoring should actually
    poll before routing traffic to this instance)."""
    return {"status": "healthy"}


@app.get("/health/ready")
async def health_ready():
    """Readiness check: verifies the dependencies real requests actually need
    are reachable, not just that the Python process is alive. A previous
    audit flagged /health as liveness-only — meaning orchestration could keep
    routing traffic to an instance that's up but can't actually serve
    anything (e.g. Supabase unreachable). This is what should be polled
    instead for routing/alerting decisions.
    """
    import asyncio
    from app.core.database import get_supabase
    from app.core.config import settings

    checks: dict[str, dict] = {}
    overall_ok = True

    # Supabase — a trivial, cheap query (RLS-exempt via service_role, limited
    # to 1 row) just to confirm the connection + credentials are alive.
    try:
        db = get_supabase()
        await asyncio.wait_for(
            asyncio.to_thread(lambda: db.table("user_profiles").select("user_id").limit(1).execute()),
            timeout=5,
        )
        checks["supabase"] = {"ok": True}
    except Exception as e:
        checks["supabase"] = {"ok": False, "error": str(e)[:200]}
        overall_ok = False

    # Redis — only meaningful if configured; if REDIS_URL is unset we report
    # that explicitly rather than silently passing, since running without it
    # in production means caching/rate-limiting are per-process only (see
    # app/core/cache.py, app/core/limiter.py).
    if settings.redis_url:
        try:
            from app.core.cache import cache_set, cache_get
            probe_key = "health:redis:probe"
            await asyncio.to_thread(cache_set, probe_key, True, 10)
            ok = await asyncio.to_thread(cache_get, probe_key)
            checks["redis"] = {"ok": bool(ok), "configured": True}
            if not ok:
                overall_ok = False
        except Exception as e:
            checks["redis"] = {"ok": False, "configured": True, "error": str(e)[:200]}
            overall_ok = False
    else:
        checks["redis"] = {"ok": False, "configured": False, "note": "REDIS_URL not set — caching/rate-limiting are per-process only"}

    # Anthropic — presence-only check (a real API call here would cost money
    # on every health poll); a missing key is fail-fast at boot anyway since
    # it has no default in config.py, but confirmed here for completeness.
    checks["anthropic_key_present"] = {"ok": bool(settings.anthropic_api_key)}

    status_code = 200 if overall_ok else 503
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=status_code, content={"status": "healthy" if overall_ok else "degraded", "checks": checks})
