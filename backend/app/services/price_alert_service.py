"""
Shared helpers for price-move alert notifications.
Used by both the background worker and the admin trigger endpoint.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


def fetch_ticker_news(ticker: str) -> list[str]:
    """Return up to 3 recent news headlines for a ticker."""
    try:
        from app.core.finnhub import fh_news
        items = fh_news(ticker, days=3) or []
        headlines = []
        for item in items[:6]:
            title = (item.get("headline") or "").strip()
            if title and len(title) > 10:
                headlines.append(title)
            if len(headlines) >= 3:
                break
        return headlines
    except Exception:
        return []


async def generate_price_alert_why(
    ticker: str,
    change_pct: float,
    price: float,
    news_headlines: list[str],
) -> str:
    """Generate a WHY explanation for a price move via Claude.
    Called once per ticker and reused across all users."""
    import anthropic
    from app.core.config import settings

    direction = "está cayendo" if change_pct < 0 else "está subiendo"
    news_str  = "\n".join(f"- {h}" for h in news_headlines) if news_headlines else ""

    prompt = f"""Eres el asistente de Nuvos AI. Escribe el body de una notificación push en español.

DATOS:
- Ticker: {ticker}
- Movimiento: {change_pct:+.2f}% hoy, precio actual ${price:.2f}
- Noticias recientes:
{news_str or "Sin noticias recientes disponibles."}

INSTRUCCIONES:
- Si conoces el nombre completo de la empresa para "{ticker}", úsalo. Si no, usa solo "{ticker}".
- Empieza con: "Hoy [nombre] ({ticker}) {direction} {abs(change_pct):.1f}%"
- Explica el PORQUÉ en 1 oración simple usando las noticias. Si no hay noticias, deduce el contexto del sector o la empresa.
- Tono: como un amigo explicándote qué pasó, sin jerga financiera
- Máximo 180 caracteres
- Sin emojis, sin mencionar Nuvos AI
- Solo el texto, nada más"""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp   = await asyncio.wait_for(
            client.messages.create(
                model=settings.claude_model,
                max_tokens=160,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=8.0,
        )
        why = resp.content[0].text.strip().strip('"').strip("'")
        if len(why) > 200:
            why = why[:197] + "..."
        return why
    except Exception as e:
        logger.warning("Claude price alert why failed for %s: %s", ticker, e)
        verb = "cayó" if change_pct < 0 else "subió"
        return f"{ticker} {verb} {abs(change_pct):.1f}% a ${price:.2f} hoy."
