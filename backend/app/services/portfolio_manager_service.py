"""AI Portfolio Manager — the invisible agent that watches every user's
portfolio and watchlist and pushes proactive alerts (concentration risk,
diversification, thesis drift). Premium gets an AI-personalized message
built from their actual holdings + declared investing style; free gets a
plain, still-useful template. Same free/premium split already established
for price-move alerts in price_alert_service.py.

Kept as small, cheap Haiku calls — no full mentor system prompt — matching
the cost-conscious pattern used for every other high-volume worker push.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def _haiku_insight(prompt: str, max_tokens: int = 120) -> str | None:
    import anthropic
    from app.core.config import settings

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=10.0,
        )
        text = resp.content[0].text.strip().strip('"').strip("'")
        return text or None
    except Exception as e:
        logger.warning("Portfolio Manager insight generation failed: %s", e)
        return None


async def generate_concentration_insight(
    first_name: str,
    top_sector: str,
    weight_pct: float,
    total_value: float,
    investing_style: str | None,
) -> str | None:
    """Premium-only: personalized concentration-risk message referencing the
    user's actual portfolio weight and declared investing style."""
    style_note = f" El usuario se declara inversionista de estilo {investing_style}." if investing_style and investing_style != "not_set" else ""
    prompt = f"""Eres el Portfolio Manager IA de Nuvos, un asistente que vigila el portafolio del usuario en segundo plano.

DATOS:
- {first_name} tiene el {weight_pct:.0f}% de su portafolio (${total_value:,.0f} USD) concentrado en el sector {top_sector}.{style_note}

TAREA: escribe UNA notificación push (máximo 200 caracteres) que:
1. Nombre el sector y el % concreto (no seas vago).
2. Explique en una frase por qué la concentración es un riesgo real (no genérico).
3. Sugiera una acción concreta, sin sonar alarmista.
Tono: un gestor de portafolio que conoce bien a esta persona, no una alerta genérica de app.
Sin emojis al inicio, sin mencionar "Nuvos AI", solo el texto de la notificación."""
    return await _haiku_insight(prompt)


async def generate_diversification_insight(
    first_name: str,
    missing_sectors: int,
    current_sectors: list[str],
    investing_style: str | None,
) -> str | None:
    """Premium-only: personalized nudge naming the sectors the user already
    holds and how close they are to a well-diversified portfolio."""
    style_note = f" Su estilo declarado es {investing_style}." if investing_style and investing_style != "not_set" else ""
    held = ", ".join(current_sectors) if current_sectors else "muy pocos sectores"
    prompt = f"""Eres el Portfolio Manager IA de Nuvos.

DATOS:
- {first_name} ya tiene exposición a: {held}.
- Le faltan {missing_sectors} sector(es) para una diversificación sólida.{style_note}

TAREA: escribe UNA notificación push (máximo 200 caracteres) que reconozca lo que ya tiene
y lo motive a explorar el/los sector(es) que le faltan, con tono de aliado, no de regaño.
Sin emojis al inicio, sin mencionar "Nuvos AI", solo el texto de la notificación."""
    return await _haiku_insight(prompt)


async def generate_thesis_drift_insight(
    first_name: str,
    ticker: str,
    company_name: str,
    investing_style: str,
    drift_reason: str,
) -> str | None:
    """Premium-only: personalized message when a holding no longer matches
    the user's declared investing philosophy."""
    prompt = f"""Eres el Portfolio Manager IA de Nuvos.

DATOS:
- {first_name} tiene {company_name} ({ticker}) en su portafolio.
- Se declara inversionista de estilo {investing_style}.
- Por qué ya no encaja: {drift_reason}

TAREA: escribe UNA notificación push (máximo 200 caracteres) que le diga a {first_name}
que {ticker} ya no encaja con su estilo declarado, mencionando la razón concreta,
invitándolo a revisar su tesis (no a vender automáticamente).
Sin emojis al inicio, sin mencionar "Nuvos AI", solo el texto de la notificación."""
    return await _haiku_insight(prompt)
