import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.core.limiter import limiter
from app.api.routes import auth, profile, chat, market, notifications, screener, billing, learn, sync, paper, referral, support, earnings, simulate, report, decisions, watchlist, feed, leaderboard, investors, financials, brokerage

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
app.include_router(report.router,       prefix="/api")
app.include_router(decisions.router,    prefix="/api")
app.include_router(watchlist.router,    prefix="/api")
app.include_router(feed.router,         prefix="/api")
app.include_router(leaderboard.router,  prefix="/api")
app.include_router(investors.router,    prefix="/api")
app.include_router(financials.router,   prefix="/api")
app.include_router(brokerage.router,    prefix="/api")

# Scheduler runs in worker.py (separate process) — not here.
# This prevents duplicate job execution when the web process scales horizontally.


@app.get("/")
async def root():
    return {
        "name": "Nuvo",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}
