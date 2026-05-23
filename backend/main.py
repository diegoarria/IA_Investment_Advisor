from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.core.config import settings
from app.api.routes import auth, profile, chat, market, notifications, screener
from app.services.notification_service import scan_and_notify_all_users

app = FastAPI(
    title="IA Investment Advisor API",
    description="Educational AI investment advisor — teaches you to think like a professional investor",
    version="1.0.0"
)

_all_origins = settings.frontend_url in ("*", "")
_origins = ["*"] if _all_origins else [
    settings.frontend_url,
    "http://localhost:3000",
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:8083",
    "http://localhost:19006",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:19006",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=not _all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(market.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(screener.router,     prefix="/api")

scheduler = AsyncIOScheduler()


@app.on_event("startup")
async def startup():
    scheduler.add_job(scan_and_notify_all_users, "cron", hour="9,16", minute="0", timezone="America/New_York")
    scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()


@app.get("/")
async def root():
    return {
        "name": "IA Investment Advisor",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}
