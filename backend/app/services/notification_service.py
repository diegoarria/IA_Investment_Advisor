from datetime import datetime
from app.core.database import get_supabase, run_query
from app.services.market_service import get_market_summary, get_upcoming_earnings
from app.services import ai_service
from app.services.push_service import send_streak_danger
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
    await run_query(db.table("notifications").insert(record))


async def get_user_notifications(user_id: str, limit: int = 20) -> list[dict]:
    db = get_supabase()
    result = await run_query(
        db.table("notifications")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    return result.data


async def mark_notification_read(notification_id: str):
    db = get_supabase()
    await run_query(
        db.table("notifications").update({"read": True}).eq("id", notification_id)
    )


async def scan_and_notify_all_users():
    db = get_supabase()

    earnings = get_upcoming_earnings()

    users_result = await run_query(
        db.table("user_profiles").select("user_id, risk_tolerance, investment_experience, weak_areas, interaction_count, push_token")
    )

    for user_data in users_result.data:
        user_id = user_data["user_id"]

        profile_result = await run_query(
            db.table("user_profiles").select("*").eq("user_id", user_id).single()
        )
        profile = None
        if profile_result.data:
            try:
                profile = UserProfile(**profile_result.data)
            except Exception:
                pass

        # Get user's portfolio positions to filter alerts
        portfolio_tickers: list[str] = []
        try:
            port_result = await run_query(
                db.table("user_portfolio").select("positions").eq("user_id", user_id).maybe_single()
            )
            if port_result.data:
                raw = port_result.data.get("positions") or {}
                if isinstance(raw, dict):
                    portfolio_tickers = [p["ticker"] for p in raw.get("positions", []) if p.get("ticker")]
                elif isinstance(raw, list):
                    portfolio_tickers = [p["ticker"] for p in raw if p.get("ticker")]
        except Exception:
            pass

        # Custom price alerts (user-defined targets)
        await check_custom_price_alerts(user_id)

        # Market move alerts: only for stocks the user actually holds
        if portfolio_tickers:
            await check_portfolio_alerts(user_id, portfolio_tickers, profile)

        # Earnings alerts: only for stocks in user's portfolio
        user_earnings = [e for e in earnings if e.get("symbol") in portfolio_tickers]
        for event in user_earnings[:1]:
            days = event["days_until"]
            timing = "hoy" if days == 0 else f"en {days} días"
            event_desc = f"{event['symbol']} reporta resultados {timing}"
            insight = await ai_service.generate_notification_insight(
                "earnings_event", event_desc, profile
            )
            suggested_message = (
                f"¿Qué debo saber antes de que {event['symbol']} reporte resultados {timing}? "
                f"Tengo posición en esta empresa."
            )
            await create_notification(
                user_id=user_id,
                notification_type="earnings_event",
                title=f"📊 {event['symbol']} reporta {timing}",
                message=insight,
                data={
                    **event,
                    "screen": "chat",
                    "chat_context": f"{event['symbol']} reporta resultados {timing}. {insight}",
                    "suggested_message": suggested_message,
                },
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
            insight = await ai_service.generate_notification_insight(
                "market_move",
                f"{move['symbol']} {direction} {abs(move['change_pct'])}% hoy — acción en tu portafolio",
                profile,
            )
            chat_context = (
                f"{move['symbol']} {direction} {abs(move['change_pct'])}% hoy. "
                f"Precio actual: ${move['price']:.2f}. "
                f"Análisis: {insight}"
            )
            suggested_message = (
                f"¿Qué debería hacer con mi posición en {move['symbol']} "
                f"después de que {direction} {abs(move['change_pct'])}%?"
            )
            await create_notification(
                user_id=user_id,
                notification_type="market_move",
                title=f"{emoji} {move['symbol']} {direction} {abs(move['change_pct'])}%",
                message=insight,
                data={
                    **move,
                    "screen": "chat",
                    "chat_context": chat_context,
                    "suggested_message": suggested_message,
                },
            )
    except Exception:
        pass


async def check_custom_price_alerts(user_id: str):
    """Check user-defined price alerts and fire notifications when targets are hit."""
    try:
        import yfinance as yf
        import asyncio, concurrent.futures
        from datetime import timezone

        db = get_supabase()
        alerts_res = await run_query(
            db.table("price_alerts")
            .select("*")
            .eq("user_id", user_id)
            .is_("triggered_at", "null")
        )
        alerts = alerts_res.data or []
        if not alerts:
            return

        tickers = list({a["ticker"] for a in alerts})

        def fetch_prices():
            prices = {}
            for t in tickers[:20]:
                try:
                    hist = yf.Ticker(t).history(period="1d")
                    if len(hist):
                        prices[t] = float(hist["Close"].iloc[-1])
                except Exception:
                    pass
            return prices

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            loop = asyncio.get_event_loop()
            prices = await loop.run_in_executor(ex, fetch_prices)

        now = datetime.now(timezone.utc).isoformat()
        for alert in alerts:
            ticker = alert["ticker"]
            price = prices.get(ticker)
            if price is None:
                continue
            target = float(alert["target_price"])
            condition = alert["condition"]
            triggered = (condition == "above" and price >= target) or (condition == "below" and price <= target)
            if not triggered:
                continue

            direction = "superó" if condition == "above" else "cayó por debajo de"
            emoji = "🚀" if condition == "above" else "📉"
            msg = f"{ticker} cotiza ahora en ${price:.2f}. Tu alerta de precio {'por encima' if condition == 'above' else 'por debajo'} de ${target} se ha activado."
            await create_notification(
                user_id=user_id,
                notification_type="price_alert",
                title=f"{emoji} Alerta: {ticker} {direction} ${target}",
                message=msg,
                data={
                    "ticker": ticker,
                    "price": price,
                    "target": target,
                    "condition": condition,
                    "screen": "chat",
                    "chat_context": f"{ticker} acaba de {direction} tu alerta de ${target}. Precio actual: ${price:.2f}.",
                    "suggested_message": f"¿Qué debería hacer ahora que {ticker} {direction} mi alerta de ${target}?",
                },
            )
            await run_query(
                db.table("price_alerts")
                .update({"triggered_at": now})
                .eq("id", alert["id"])
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
