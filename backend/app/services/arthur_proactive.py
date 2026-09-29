"""Arthur proactivo (Diego, 2026-09-29): "que no espere como un chat de IA
normal a que le digan qué hacer, sino que esté por delante siempre, que
inicie conversaciones, mande notificaciones y que si alguien da clic o
entra a la plataforma y abre el chat de Arthur se abra esa conversación".

How it works:
  * Every high-signal push Nuvos already sends about the user's own money
    (thesis/fundamental changes, earnings of a holding, a big move in a
    holding, the Sunday portfolio review, risk alerts, imported trades…)
    is turned into a conversation Arthur STARTS: notification_engine.
    send_push calls maybe_start_for_push() first, which writes Arthur's
    opening message into chat_history under a brand-new session and adds
    `arthur_session_id` to the push payload.
  * Tapping the push — or simply opening Arthur's chat later — opens that
    conversation (GET /api/chat/proactive/pending), with suggested
    follow-up questions as chips. Web and mobile.
  * Arthur never prescribes: the opening message explains what happened
    and why it matters, then asks — the decision is always the user's.

Cost: one short Haiku call per started conversation, bounded by
MAX_THREADS_PER_DAY and by the push fatigue caps that gate the push itself.
Everything fails open — a problem here never blocks the push.
"""
import asyncio
import json
import logging
import random
import re
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

MAX_THREADS_PER_DAY = 4
_MODEL = "claude-haiku-4-5-20251001"

# Push categories about the user's OWN money/holdings that deserve a real
# conversation (matched by prefix). Market-wide broadcasts (open/close,
# morning brief), marketing and account pushes stay plain pushes.
PROACTIVE_PREFIXES = (
    "smart_alert_",
    "earnings_",
    "quarterly_earnings_digest",
    "sunday_portfolio_review",
    "risk_management",
    "ai_insight_",
    "price_mover_",
    "major_news_alert",
    "market_crash_alert",
    "investment_discipline_reminder",
    "milestone_reached",
    "import_",
    "corporate_action_",
)


def is_proactive_category(category: str) -> bool:
    return bool(category) and category.startswith(PROACTIVE_PREFIXES)


def new_session_id() -> str:
    return f"arthur-{int(datetime.now(timezone.utc).timestamp() * 1000)}-{random.randint(10000, 99999)}"


async def _threads_today(user_id: str) -> int:
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    try:
        res = await run_query(
            get_supabase().table("arthur_proactive_threads").select("id")
            .eq("user_id", user_id).gte("created_at", since)
        )
        return len(res.data or [])
    except Exception:
        return 0


async def _lang(user_id: str) -> str:
    try:
        res = await run_query(
            get_supabase().table("user_profiles").select("preferred_language,name").eq("user_id", user_id).limit(1)
        )
        row = (res.data or [{}])[0] or {}
        return "en" if row.get("preferred_language") == "en" else "es"
    except Exception:
        return "es"


_SYSTEM_ES = (
    "Eres Arthur, el mentor de inversiones de Nuvos. Estás INICIANDO una conversación con el usuario "
    "porque pasó algo relevante para su dinero. Nunca le dices qué comprar, vender o hacer: explicas qué "
    "pasó, por qué importa para él y qué escenarios o preguntas debería considerar. La decisión siempre es suya. "
    "Tono cercano, claro, sin tecnicismos, en español neutro de LatAm."
)
_SYSTEM_EN = (
    "You are Arthur, Nuvos's investing mentor. You are STARTING a conversation with the user because "
    "something relevant to their money happened. You never tell them what to buy, sell or do: you explain what "
    "happened, why it matters to them and which scenarios or questions they should consider. The decision is "
    "always theirs. Warm, clear, jargon-free."
)


def _compose_prompt(title: str, body: str, data: dict, lang: str) -> str:
    ctx = {k: v for k, v in (data or {}).items() if isinstance(v, (str, int, float)) and k not in ("screen", "category")}
    if lang == "en":
        return (
            f"Alert that was just sent to the user:\nTitle: {title}\nText: {body}\nData: {json.dumps(ctx, ensure_ascii=False)}\n\n"
            "Write Arthur's OPENING message for this conversation: 2-3 short paragraphs (max ~110 words). "
            "Start directly with what happened (no greeting like 'Hi!'), say why it matters for the user's money, "
            "and end with ONE inviting question. Use **bold** for the key figure. Then propose 2 short follow-up "
            "questions the user might tap (max 8 words each), written in the user's voice.\n"
            'Answer ONLY with JSON: {"message": "...", "followups": ["...", "..."]}'
        )
    return (
        f"Alerta que se le acaba de enviar al usuario:\nTítulo: {title}\nTexto: {body}\nDatos: {json.dumps(ctx, ensure_ascii=False)}\n\n"
        "Escribe el mensaje con el que Arthur ABRE esta conversación: 2-3 párrafos cortos (máximo ~110 palabras). "
        "Empieza directo con lo que pasó (sin saludo tipo '¡Hola!'), di por qué importa para el dinero del usuario "
        "y termina con UNA pregunta que invite a platicar. Usa **negritas** para la cifra clave. Luego propone 2 "
        "preguntas cortas de seguimiento que el usuario podría tocar (máx. 8 palabras cada una), escritas como si "
        "las dijera el usuario.\n"
        'Responde SOLO con JSON: {"message": "...", "followups": ["...", "..."]}'
    )


def _fallback(title: str, body: str, lang: str) -> tuple[str, list[str]]:
    if lang == "en":
        return (f"**{title}**\n\n{body}\n\nWant me to walk you through what this means for your portfolio?",
                ["What does this mean for me?", "Show me the scenarios"])
    return (f"**{title}**\n\n{body}\n\n¿Quieres que te explique qué significa esto para tu portafolio?",
            ["¿Qué significa esto para mí?", "Muéstrame los escenarios"])


async def _compose(user_id: str, title: str, body: str, data: dict, lang: str) -> tuple[str, list[str]]:
    if not settings.anthropic_api_key:
        return _fallback(title, body, lang)
    try:
        import anthropic
        from app.services.ai_service import check_daily_spend_cap
        check_daily_spend_cap()

        def _call():
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            return client.messages.create(
                model=_MODEL, max_tokens=450,
                system=_SYSTEM_EN if lang == "en" else _SYSTEM_ES,
                messages=[{"role": "user", "content": _compose_prompt(title, body, data, lang)}],
            )

        msg = await asyncio.wait_for(asyncio.to_thread(_call), timeout=20)
        try:
            from app.services.llm_usage import log_llm_usage
            asyncio.create_task(log_llm_usage(user_id, "arthur_proactive", _MODEL, msg.usage))
        except Exception:
            pass
        raw = next((b.text for b in msg.content if getattr(b, "type", "") == "text"), "")
        m = re.search(r"\{.*\}", raw, re.S)
        parsed = json.loads(m.group(0)) if m else {}
        text = str(parsed.get("message") or "").strip()
        followups = [str(f).strip() for f in (parsed.get("followups") or []) if str(f).strip()][:2]
        if not text:
            return _fallback(title, body, lang)
        return text, followups
    except Exception as e:
        logger.warning("arthur_proactive._compose failed for %s: %s", user_id, e)
        return _fallback(title, body, lang)


async def create_thread(
    user_id: str,
    category: str,
    title: str,
    message: str,
    actions: list[dict] | None = None,
    session_id: str | None = None,
) -> str | None:
    """Writes Arthur's opening message into chat_history under a new session
    and records the thread. Returns the session id (None on failure)."""
    sid = session_id or new_session_id()
    db = get_supabase()
    try:
        await run_query(db.table("chat_history").insert({
            "user_id": user_id, "role": "assistant", "content": message,
            "created_at": datetime.utcnow().isoformat(), "session_id": sid,
        }))
        await run_query(db.table("arthur_proactive_threads").insert({
            "user_id": user_id, "session_id": sid, "category": category[:80],
            "title": (title or "")[:200], "message": message, "actions": actions or [],
        }))
        return sid
    except Exception as e:
        logger.warning("arthur_proactive.create_thread failed for %s: %s", user_id, e)
        return None


async def maybe_start_for_push(user_id: str, category: str, title: str, body: str, data: dict) -> str | None:
    """Called by notification_engine.send_push for every push that passed its
    fatigue gates. Returns the new conversation's session id when one was
    started (the push then deep-links into it), else None."""
    try:
        if not user_id or not is_proactive_category(category):
            return None
        if data and data.get("arthur_session_id"):
            return None
        if await _threads_today(user_id) >= MAX_THREADS_PER_DAY:
            return None
        lang = await _lang(user_id)
        message, followups = await _compose(user_id, title, body, data or {}, lang)
        actions = [{"type": "chat", "label": f, "data": {"message": f}} for f in followups]
        return await create_thread(user_id, category, title, message, actions)
    except Exception as e:
        logger.warning("arthur_proactive.maybe_start_for_push failed for %s: %s", user_id, e)
        return None


async def pending_thread(user_id: str) -> dict | None:
    """The newest conversation Arthur started that the user hasn't opened
    yet (last 7 days) — what the chat opens on entry."""
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        res = await run_query(
            get_supabase().table("arthur_proactive_threads")
            .select("id,session_id,category,title,message,actions,created_at")
            .eq("user_id", user_id).is_("opened_at", "null").gte("created_at", since)
            .order("created_at", desc=True).limit(1)
        )
        return (res.data or [None])[0]
    except Exception as e:
        logger.warning("arthur_proactive.pending_thread failed for %s: %s", user_id, e)
        return None


async def mark_opened(user_id: str, thread_id: str | None = None, session_id: str | None = None) -> None:
    try:
        q = get_supabase().table("arthur_proactive_threads").update(
            {"opened_at": datetime.now(timezone.utc).isoformat()}
        ).eq("user_id", user_id).is_("opened_at", "null")
        if thread_id:
            q = q.eq("id", thread_id)
        elif session_id:
            q = q.eq("session_id", session_id)
        await run_query(q)
    except Exception as e:
        logger.warning("arthur_proactive.mark_opened failed for %s: %s", user_id, e)


async def thread_actions(user_id: str, session_id: str) -> list[dict]:
    try:
        res = await run_query(
            get_supabase().table("arthur_proactive_threads").select("actions")
            .eq("user_id", user_id).eq("session_id", session_id).limit(1)
        )
        return ((res.data or [{}])[0] or {}).get("actions") or []
    except Exception:
        return []
