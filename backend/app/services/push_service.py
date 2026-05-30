"""
Push notification service using Expo's Push API.
No extra SDK needed — plain HTTP to https://exp.host/--/api/v2/push/send
"""
import httpx
import logging
from typing import Sequence

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_push(tokens: str | Sequence[str], title: str, body: str, data: dict | None = None) -> None:
    """Fire-and-forget push to one or many Expo push tokens."""
    if isinstance(tokens, str):
        tokens = [tokens]
    tokens = [t for t in tokens if t and t.startswith("ExponentPushToken")]
    if not tokens:
        return

    messages = [
        {"to": token, "title": title, "body": body, "data": data or {}, "sound": "default"}
        for token in tokens
    ]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(EXPO_PUSH_URL, json=messages,
                              headers={"Accept": "application/json", "Content-Type": "application/json"})
    except Exception as e:
        logger.warning("Push send failed: %s", e)


async def send_streak_danger(token: str, streak: int) -> None:
    await send_push(token,
        title="🔥 Tu racha está en peligro",
        body=f"Llevas {streak} días seguidos. Aprende algo hoy para no perderla.",
        data={"screen": "arena"})


async def send_market_alert(token: str, ticker: str, change_pct: float) -> None:
    direction = "subió" if change_pct > 0 else "cayó"
    emoji = "🚀" if change_pct > 0 else "📉"
    await send_push(token,
        title=f"{emoji} {ticker} {direction} {abs(change_pct):.1f}%",
        body="¿Qué harías? Prueba el Simulador.",
        data={"screen": "arena", "ticker": ticker})


async def send_mentor_letter_ready(token: str, mentor_name: str) -> None:
    first = mentor_name.split()[0]
    await send_push(token,
        title=f"✉️ Tienes carta de {first}",
        body=f"{first} tiene algo importante que decirte este mes.",
        data={"screen": "profile"})
