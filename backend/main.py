import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.core.config import settings
from app.api.routes import auth, profile, chat, market, notifications, screener, billing, learn
from app.services.notification_service import scan_and_notify_all_users
from app.services.email_service import generate_and_send_weekly_summary

app = FastAPI(
    title="Nuvo API",
    description="Educational AI investment advisor — teaches you to think like a professional investor",
    version="1.0.0"
)

_all_origins = settings.frontend_url in ("*", "")
_origins = ["*"] if _all_origins else [
    settings.frontend_url,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
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


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal error: {str(exc)}", "trace": tb[-500:]},
    )

app.include_router(auth.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(market.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(screener.router,     prefix="/api")
app.include_router(billing.router,      prefix="/api")
app.include_router(learn.router,        prefix="/api")

scheduler = AsyncIOScheduler()


async def send_weekly_emails():
    """Send personalized weekly summary to all users every Friday after market close."""
    from app.core.database import get_supabase
    from app.core.config import settings
    if not settings.resend_api_key:
        return
    db = get_supabase()
    try:
        users = db.table("user_profiles").select("user_id,name,risk_tolerance").execute().data
        auth_users = {u["id"]: u["email"] for u in db.auth.admin.list_users()}
        for u in users:
            email = auth_users.get(u["user_id"])
            if not email:
                continue
            is_premium = u.get("subscription_tier") == "premium"
            # Free users get a short general summary; premium get personalized with chat history
            if is_premium:
                chats = db.table("chat_history").select("content").eq("user_id", u["user_id"]).eq("role","user").order("created_at", desc=True).limit(10).execute().data
                snippets = [c["content"][:150] for c in chats]
            else:
                snippets = []  # general summary, no personalization
            await generate_and_send_weekly_summary(
                user_id=u["user_id"],
                email=email,
                name=u["name"].split()[0],
                risk=u["risk_tolerance"],
                chat_snippets=snippets,
            )
    except Exception:
        pass


@app.on_event("startup")
async def startup():
    scheduler.add_job(scan_and_notify_all_users, "cron", hour="9,16", minute="0", timezone="America/New_York")
    # Weekly email: Friday at 6:30 PM EST (2h after NYSE closes)
    scheduler.add_job(send_weekly_emails, "cron", day_of_week="fri", hour=18, minute=30, timezone="America/New_York")
    scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()


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
