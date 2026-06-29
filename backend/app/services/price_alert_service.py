"""
Shared helpers for price-move alert notifications.
Used by both the background worker and the admin trigger endpoint.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

# Sentinel returned when no specific catalyst is found — callers should skip the notification.
NO_CATALYST = "__NO_CATALYST__"


def fetch_ticker_news(ticker: str) -> list[dict]:
    """
    Return up to 5 recent news items for a ticker.
    Combines Finnhub (fresher, has summaries) + Yahoo Finance (fallback).
    Each item: {headline, summary}
    """
    items: list[dict] = []

    # 1. Finnhub — fresher, includes summaries
    try:
        from app.core.finnhub import fh_news
        fh_items = fh_news(ticker, days=3) or []
        for n in fh_items[:5]:
            h = (n.get("headline") or "").strip()
            s = (n.get("summary") or "").strip()
            if h and len(h) > 10:
                items.append({"headline": h, "summary": s[:300] if s else ""})
        if len(items) >= 3:
            return items[:5]
    except Exception:
        pass

    # 2. Yahoo Finance fallback
    try:
        import yfinance as yf
        news = yf.Ticker(ticker).news or []
        for item in news[:8]:
            title = (item.get("title") or item.get("headline") or "").strip()
            body  = (item.get("summary") or "").strip()
            if title and len(title) > 10:
                existing = {i["headline"] for i in items}
                if title not in existing:
                    items.append({"headline": title, "summary": body[:300] if body else ""})
            if len(items) >= 5:
                break
    except Exception:
        pass

    return items[:5]


async def generate_price_alert_why(
    ticker: str,
    change_pct: float,
    price: float,
    news_items: list[dict],
) -> str:
    """
    Generate a WHY explanation for a price move via Claude.

    Returns the notification body string when a specific named catalyst is found,
    or NO_CATALYST when the news is too generic — callers must skip the push in that case.

    Called once per ticker and reused across all users.
    """
    import anthropic
    from app.core.config import settings

    direction = "está cayendo" if change_pct < 0 else "está subiendo"

    # Support both old list[str] callers and new list[dict] callers
    if news_items and isinstance(news_items[0], str):
        news_items = [{"headline": h, "summary": ""} for h in news_items]  # type: ignore[assignment]

    if news_items:
        news_str = "\n".join(
            f"- {n['headline']}" + (f"\n  Detalle: {n['summary']}" if n.get("summary") else "")
            for n in news_items
        )
    else:
        news_str = ""

    prompt = f"""Eres el sistema de notificaciones push de Nuvos AI.

DATOS DEL MOVIMIENTO:
- Ticker: {ticker}
- Movimiento: {change_pct:+.2f}% hoy, precio actual ${price:.2f}

NOTICIAS RECIENTES (últimas 72h):
{news_str or "(sin noticias disponibles)"}

TU TAREA:
Escribe el body de una notificación push en español que explique POR QUÉ {ticker} {direction} {abs(change_pct):.1f}%.

REGLAS ESTRICTAS:
1. SOLO escribe la notificación si puedes nombrar un catalizador ESPECÍFICO con al menos UNO de:
   - Un nombre de persona real (CEO, directivo, analista)
   - Una empresa o institución concreta
   - Un anuncio, producto, acuerdo, dato económico o evento específico
   - Un resultado financiero concreto (earnings, revenue, guidance)

2. Si las noticias son demasiado genéricas, antiguas, o no hay noticias → responde exactamente: NO_CATALYST

3. Si hay catalizador claro:
   - Usa el nombre completo de la empresa si lo conoces, si no usa "{ticker}"
   - Menciona el catalizador específico en 1 oración directa
   - Tono: como un amigo explicándote qué pasó, sin jerga financiera
   - Máximo 200 caracteres
   - Sin emojis, sin mencionar "Nuvos AI"
   - Solo el texto, nada más

EJEMPLOS BUENOS:
"Apple subió 4.2% tras reportar ingresos de $124B en Q2, superando las estimaciones de Wall Street."
"NVIDIA sube 6% después de que Jensen Huang anunciara la arquitectura Blackwell Ultra para centros de datos IA."
"Amazon cayó 3.8% luego de que la FTC presentó una demanda antimonopolio por sus prácticas en AWS."

EJEMPLO MALO → responde NO_CATALYST en este caso:
"Tesla subió por noticias positivas del sector automotriz y expectativas del mercado."

Responde solo con el texto de la notificación o con NO_CATALYST."""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp = await asyncio.wait_for(
            client.messages.create(
                model=settings.claude_model,
                max_tokens=180,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=10.0,
        )
        result = resp.content[0].text.strip().strip('"').strip("'")

        if result.startswith("NO_CATALYST"):
            logger.info("No specific catalyst for %s — notification suppressed", ticker)
            return NO_CATALYST

        if len(result) > 230:
            result = result[:227] + "..."
        return result

    except Exception as e:
        logger.warning("Claude price alert why failed for %s: %s", ticker, e)
        return NO_CATALYST
