from datetime import datetime
from app.core.database import get_supabase
from app.services.market_service import get_market_summary, detect_significant_moves, get_upcoming_earnings
from app.services import ai_service
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

    users_result = db.table("user_profiles").select("user_id, risk_tolerance, investment_experience, weak_areas, interaction_count").execute()

    for user_data in users_result.data:
        user_id = user_data["user_id"]

        profile_result = db.table("user_profiles").select("*").eq("user_id", user_id).single().execute()
        profile = None
        if profile_result.data:
            try:
                profile = UserProfile(**profile_result.data)
            except Exception:
                pass

        for move in moves[:2]:
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
