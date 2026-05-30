from datetime import datetime
from app.core.database import get_supabase
from app.services.market_service import get_market_summary, detect_significant_moves, get_upcoming_earnings
from app.services import ai_service
from app.services.push_service import send_market_alert, send_streak_danger
from app.models.user import UserProfile


NOTIFICATION_TYPES = {
    "market_move": "Movimiento de Mercado",
    "earnings_event": "Reporte de Resultados",
    "learning_progress": "Progreso de Aprendizaje",
    "personalized_insight": "Análisis Personalizado",
    "market_summary": "Resumen del Mercado",
}


async def create_notification(user_id: str, notification_type: str, title: str, message: str, data: dict = None):
    db = get_supabase()
    record = {
        "user_id": user_id,
        "type": notification_type,
        "title": title,
        "message": message,
        "data": data or {},
        "read": False,
        "created_at": datetime.utcnow().isoformat(),
    }
    db.table("notifications").insert(record).execute()


async def get_user_notifications(user_id: str, limit: int = 20) -> list[dict]:
    db = get_supabase()
    result = (
        db.table("notifications")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data


async def mark_notification_read(notification_id: str):
    db = get_supabase()
    db.table("notifications").update({"read": True}).eq("id", notification_id).execute()


async def scan_and_notify_all_users():
    db = get_supabase()

    market = get_market_summary()
    moves = detect_significant_moves(threshold_pct=3.0)
    earnings = get_upcoming_earnings()

    users_result = db.table("user_profiles").select("user_id, risk_tolerance, investment_experience, weak_areas, interaction_count, push_token").execute()

    for user_data in users_result.data:
        user_id = user_data["user_id"]

        profile_result = db.table("user_profiles").select("*").eq("user_id", user_id).single().execute()
        profile = None
        is_premium = False
        if profile_result.data:
            try:
                profile = UserProfile(**profile_result.data)
                is_premium = profile.subscription_tier == "premium"
            except Exception:
                pass

        # Premium: specific holdings alerts via check_portfolio_alerts (called separately)
        # Free: general market moves only, threshold higher (5% vs 3%)
        alert_threshold = 3 if is_premium else 5
        moves_filtered = [m for m in moves if abs(m.get("change_pct", 0)) >= alert_threshold]

        push_token = user_data.get("push_token")
        for move in moves_filtered[:2]:
            direction = "subió" if move["direction"] == "up" else "cayó"
            event_desc = f"{move['symbol']} {direction} {abs(move['change_pct'])}% hoy"
            message = await ai_service.generate_notification_insight(
                "market_move", event_desc, profile
            )
            await create_notification(
                user_id=user_id,
                notification_type="market_move",
                title=f"📉 {move['symbol']} {direction} {abs(move['change_pct'])}%",
                message=message,
                data=move
            )
            if push_token:
                await send_market_alert(push_token, move["symbol"], move["change_pct"])

        for event in earnings[:1]:
            days = event["days_until"]
            timing = "hoy" if days == 0 else f"en {days} días"
            event_desc = f"{event['symbol']} reporta resultados {timing}"
            message = await ai_service.generate_notification_insight(
                "earnings_event", event_desc, profile
            )
            await create_notification(
                user_id=user_id,
                notification_type="earnings_event",
                title=f"📊 {event['symbol']} reporta {timing}",
                message=message,
                data=event
            )

        if user_data.get("interaction_count", 0) > 0:
            milestones = [7, 14, 30, 60, 100]
            count = user_data["interaction_count"]
            if count in milestones:
                message = f"Llevas {count} interacciones aprendiendo sobre inversiones. Tu comprensión de los mercados está creciendo. ¿Quieres explorar un concepto más avanzado?"
                await create_notification(
                    user_id=user_id,
                    notification_type="learning_progress",
                    title=f"🚀 {count} días aprendiendo inversión",
                    message=message,
                    data={"milestone": count}
                )


async def check_portfolio_alerts(user_id: str, tickers: list[str], profile: UserProfile | None = None):
    """Send alerts when user's holdings have significant moves (>4%)."""
    if not tickers:
        return
    try:
        import yfinance as yf
        import concurrent.futures

        def fetch_move(ticker: str):
            try:
                t = yf.Ticker(ticker)
                hist = t.history(period="2d")
                if len(hist) < 2:
                    return None
                prev, curr = float(hist["Close"].iloc[-2]), float(hist["Close"].iloc[-1])
                pct = round((curr - prev) / prev * 100, 2)
                if abs(pct) >= 4.0:
                    return {"symbol": ticker, "change_pct": pct, "price": curr}
            except Exception:
                pass
            return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            results = list(ex.map(fetch_move, tickers[:8]))

        for move in [r for r in results if r]:
            direction = "subió" if move["change_pct"] > 0 else "cayó"
            emoji = "🚀" if move["change_pct"] > 0 else "📉"
            msg = await ai_service.generate_notification_insight(
                "market_move",
                f"{move['symbol']} {direction} {abs(move['change_pct'])}% hoy — acción en tu portafolio",
                profile,
            )
            await create_notification(
                user_id=user_id,
                notification_type="market_move",
                title=f"{emoji} {move['symbol']} {direction} {abs(move['change_pct'])}%",
                message=msg,
                data=move,
            )
    except Exception:
        pass


async def generate_weekly_market_insight(user_id: str, profile: UserProfile | None = None):
    market = get_market_summary()
    sp500 = market.get("S&P 500", {})
    direction = "subió" if sp500.get("direction") == "up" else "cayó"
    event = f"El S&P 500 {direction} {abs(sp500.get('change_pct', 0))}% esta semana"

    message = await ai_service.generate_notification_insight("market_summary", event, profile)
    await create_notification(
        user_id=user_id,
        notification_type="market_summary",
        title="📈 Resumen semanal del mercado",
        message=message,
        data=market
    )
