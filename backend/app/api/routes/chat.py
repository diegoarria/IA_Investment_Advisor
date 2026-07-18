import asyncio
import base64
import logging
import os
import concurrent.futures

_ENRICH_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="chat-enrich")
import re
import json

logger = logging.getLogger("uvicorn.error")
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from app.api.deps import get_current_user_id
from app.core.database import get_supabase, run_query
from app.models.user import ChatRequest, UserProfile
from app.services import ai_service, investor_progress_service
from app.services.market_data_service import (
    get_market_context_for_message,
    get_global_market_context,
    detect_tickers,
)
from app.core.finnhub import fh_quote, fh_search
from app.core.limiter import limiter

FREE_MSG_LIMIT    = 15
PREMIUM_MSG_LIMIT = 80
MSG_WINDOW_HOURS  = 24

# Hard $ cap per day, FREE USERS ONLY — independent of the message-count
# limiter above (a free user well under 15 messages can still blow past a
# cost budget if their messages trigger long tool-calling loops). Premium
# users are gated by PREMIUM_MSG_LIMIT alone, not by $ spent — they're paying
# customers and the message-count cap is the intended lever for them.
# Enforced from llm_usage_log (added for cost-optimization rec #18), the only
# source of truth for actual $ spent, not just message count.
DAILY_COST_CAP_USD = 0.20


async def _check_daily_cost_cap(user_id: str) -> None:
    from datetime import datetime, timezone
    db = get_supabase()
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    try:
        res = await run_query(
            db.table("llm_usage_log").select("cost_usd").eq("user_id", user_id).gte("created_at", today_start)
        )
        spent = sum(float(r.get("cost_usd") or 0) for r in (res.data or []))
    except Exception as e:
        # If llm_usage_log isn't queryable (e.g. migration not run yet), fail
        # OPEN — never block the mentor over a monitoring-table outage. This
        # cap is a safety net on top of the message-count limiter, not the
        # only line of defense.
        logger.warning("_check_daily_cost_cap: usage lookup failed, allowing through: %s", e)
        return
    if spent >= DAILY_COST_CAP_USD:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "cost_cap",
                "message": f"Alcanzaste el límite de gasto diario del mentor (${DAILY_COST_CAP_USD:.2f}). Vuelve mañana.",
            },
        )


def _is_premium(profile) -> bool:
    """True for premium/pro subscribers and users within their 30-day trial."""
    if profile is None:
        return False
    from datetime import datetime as _dt, timezone as _tz
    tier = getattr(profile, "subscription_tier", "") or ""
    if tier in ("premium", "pro"):
        return True
    trial = getattr(profile, "trial_started_at", None)
    if trial:
        try:
            started = _dt.fromisoformat(trial.replace("Z", "+00:00"))
            return (_dt.now(_tz.utc) - started).days < 30
        except Exception:
            pass
    return False


_LIVE_DATA_RE = re.compile(r"\bmi (portafolio|cuenta|posici[oó]n|inversi[oó]n)\b|\b(hoy|ahora|today|now)\b", re.IGNORECASE)

# Same trigger family as ai_service.py's "FORMATO OBLIGATORIO" scorecard block
# (kept in sync manually — both describe the same user intent). Gates the
# real computed fundamental-analysis fetch (fundamental_analysis_service),
# which is Premium-only (see _enrich_message) since it costs real data-fetch
# + compute time on top of the regular chat enrichment.
#
# Deliberately broad: "analiza X" / "analízame X" alone (no "a fondo" or any
# other qualifier needed) must trigger this — a plain "Analiza Micron" was
# previously missed (required "analiza.*a fondo" literally), which meant no
# real FMP data was ever fetched for the single most common way users ask
# for a company analysis, and Claude would hedge with "no tengo datos
# actualizados" instead of just fetching them. That must never happen now
# that FMP covers the full US market.
_DEEP_ANALYSIS_RE = re.compile(
    r"anal[ií]z\w*|an[aá]lisis (de|fundamental)|es buena (compra|inversi[oó]n)|"
    r"vale la pena|me conviene|\b(compro|entro a)\b|veredicto sobre|"
    r"qu[eé] opinas de|c[oó]mo ves|recomiendas (comprar|invertir)|"
    r"\banalyz\w*|what do you think of|good buy|worth investing|deep dive|full analysis",
    re.IGNORECASE,
)

# "Suggest me some stocks" intent — no named ticker yet (Claude proposes the
# candidates), so this can't trigger a real-data fetch the way _DEEP_ANALYSIS_RE
# does; it only needs to make sure the request reaches Claude (with the
# Nuvos Investment Score framework in the prompt) instead of the no-tools
# GPT-mini path, which would otherwise just free-associate company names.
_STOCK_SUGGESTION_RE = re.compile(
    r"sugi[eé]re(me)?|recomi[eé]nda(me)?|dame ideas|qu[eé] (empresas|acciones) (me recomiendas|deber[ií]a)|"
    r"empresas? para invertir|acciones? para invertir|ideas de inversi[oó]n|ideas de acciones|"
    r"suggest (me )?(some )?stocks|recommend (me )?stocks|stock ideas",
    re.IGNORECASE,
)

# "Show me undervalued stocks" intent — UNLIKE _STOCK_SUGGESTION_RE above,
# this one DOES trigger a real-data fetch: it reads the precomputed,
# DCF-backed undervalued_screener_service cache (real margin-of-safety
# numbers, refreshed weekly — see worker.py's job_refresh_undervalued_
# screener) and injects it so Claude narrates around REAL candidates,
# never invents tickers. Premium-only, same gate as _DEEP_ANALYSIS_RE.
_UNDERVALUED_SCREENER_RE = re.compile(
    r"acciones? subvaluada|empresas? subvaluada|acciones? (est[aá]n )?baratas?|"
    r"acciones? infravalorada|empresas? infravalorada|margen de seguridad|"
    r"undervalued stocks?|cheap stocks?",
    re.IGNORECASE,
)


def _needs_claude_analysis(message: str, has_images: bool) -> bool:
    """True when a question needs real market data, a specific ticker/company,
    the user's own portfolio, tool calls, or images — anything GPT-5.4-mini
    can't answer without hallucinating (it gets no tools, no live enrichment).

    Everything else (general financial chat, education, metric explanations,
    "am I diversified" style questions) is considered "basic" and routed to
    the cheaper mini model first, for both free and premium users — this is
    the gate for that routing decision in chat_message() below.
    """
    if has_images:
        return True
    if detect_tickers(message):
        return True
    if _DEEP_ANALYSIS_RE.search(message):
        return True
    if _STOCK_SUGGESTION_RE.search(message):
        return True
    if _UNDERVALUED_SCREENER_RE.search(message):
        return True
    return bool(_LIVE_DATA_RE.search(message))


async def _check_and_increment_msg_limit(user_id: str, profile: UserProfile) -> None:
    is_premium = _is_premium(profile)
    limit = PREMIUM_MSG_LIMIT if is_premium else FREE_MSG_LIMIT

    db = get_supabase()
    now = datetime.now(timezone.utc)
    window_start = None
    if profile.msg_window_start:
        try:
            window_start = datetime.fromisoformat(profile.msg_window_start.replace("Z", "+00:00"))
        except Exception:
            pass

    if window_start is None or (now - window_start) >= timedelta(hours=MSG_WINDOW_HOURS):
        await run_query(
            db.table("user_profiles").update({
                "msg_count": 1,
                "msg_window_start": now.isoformat(),
            }).eq("user_id", user_id)
        )
        return

    if profile.msg_count >= limit:
        reset_at = window_start + timedelta(hours=MSG_WINDOW_HOURS)
        mins = max(1, int((reset_at - now).total_seconds() / 60))
        if is_premium:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "msg_limit",
                    "message": "Has alcanzado tu límite diario con el mentor. Tu acceso se renueva mañana.",
                    "reset_in_minutes": mins,
                },
            )
        else:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "msg_limit",
                    "message": f"Alcanzaste el límite de {FREE_MSG_LIMIT} mensajes. Vuelve en {mins} min o activa Premium.",
                    "reset_in_minutes": mins,
                },
            )

    await run_query(
        db.table("user_profiles").update({"msg_count": profile.msg_count + 1}).eq("user_id", user_id)
    )

router = APIRouter(prefix="/chat", tags=["chat"])


async def _get_user_profile(user_id: str) -> UserProfile | None:
    try:
        db = get_supabase()
        result = await run_query(db.table("user_profiles").select("*").eq("user_id", user_id))
        if result.data:
            return UserProfile(**result.data[0])
    except Exception:
        pass
    return None


def _extract_bscore(reply: str) -> tuple[str, dict | None]:
    """Strip the hidden BSCORE tag from Claude's reply and parse it."""
    match = re.search(r'<!--\s*BSCORE:\s*(\{.*?\})\s*-->', reply, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            clean = reply[:match.start()].rstrip()
            return clean, data
        except Exception:
            pass
    return reply, None


def _extract_action(reply: str) -> tuple[str, list | None]:
    """Strip the hidden ACTION tag and parse suggested actions."""
    match = re.search(r'<!--\s*ACTION:\s*(\{.*?\})\s*-->', reply, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            actions = data.get("actions", [])
            clean = reply[:match.start()].rstrip()
            return clean, actions if actions else None
        except Exception:
            pass
    return reply, None


async def _get_memory_context(user_id: str) -> str | None:
    """Fetch last 10 messages from chat_history to inject as memory."""
    try:
        db = get_supabase()
        result = await run_query(
            db.table("chat_history")
            .select("role, content, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(10)
        )
        msgs = list(reversed(result.data or []))
        if not msgs:
            return None
        lines = []
        for m in msgs:
            role = "Usuario" if m["role"] == "user" else "Nuvos"
            content = m["content"][:300] + ("..." if len(m["content"]) > 300 else "")
            lines.append(f"{role}: {content}")
        return "\n".join(lines)
    except Exception:
        return None


async def _get_mentor_deep_context(user_id: str) -> str | None:
    """Fetch portfolio, decisions, watchlist and extended profile in parallel for the mentor."""
    try:
        db = get_supabase()
        portfolio_res, decisions_res, watchlist_res, extended_res = await asyncio.gather(
            run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id)),
            run_query(
                db.table("investment_decisions")
                .select("action, ticker, trigger, notes, created_at")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(20)
            ),
            run_query(db.table("watchlist").select("ticker, name").eq("user_id", user_id).order("added_at")),
            run_query(
                db.table("user_profiles")
                .select("behavioral_risk_score, maturity_score, streak_count, last_learn_date, investment_goal, investment_goal_amount, investment_horizon, knowledge_level")
                .eq("user_id", user_id)
            ),
            return_exceptions=True,
        )

        # Parse positions
        positions: list[dict] = []
        if not isinstance(portfolio_res, Exception) and portfolio_res.data:
            raw = portfolio_res.data[0].get("positions", [])
            if isinstance(raw, list):
                positions = raw
            elif isinstance(raw, dict) and "_v" in raw:
                positions = raw.get("positions", [])

        decisions: list[dict] = [] if isinstance(decisions_res, Exception) else (decisions_res.data or [])
        watchlist: list[dict] = [] if isinstance(watchlist_res, Exception) else (watchlist_res.data or [])
        extended: dict = {}
        if not isinstance(extended_res, Exception) and extended_res.data:
            extended = extended_res.data[0]

        # Fetch a live quote for every position + watchlist ticker in parallel so the
        # mentor always reasons over current market value/P&L, not just cost basis.
        # fh_quote() is cached 60s, so this is cheap even on every chat message.
        tickers = {
            (p.get("ticker") or "").upper() for p in positions if p.get("ticker")
        } | {
            (w.get("ticker") or "").upper() for w in watchlist if w.get("ticker")
        }
        quotes: dict[str, dict] = {}
        if tickers:
            results = await asyncio.gather(
                *(asyncio.to_thread(fh_quote, t) for t in tickers),
                return_exceptions=True,
            )
            for t, q in zip(tickers, results):
                if not isinstance(q, Exception) and q:
                    quotes[t] = q

        return ai_service.build_deep_user_context(extended, positions, decisions, watchlist, quotes)
    except Exception:
        return None


_FUNDAMENTALS_TIMEOUT = 12.0  # generous — only reached for Premium + explicit deep-analysis intent
_MAX_FUNDAMENTALS_TICKERS = 2  # cap so a message naming several companies doesn't fan out N expensive fetches

# Words/phrases stripped out to isolate the likely company name when the
# curated COMPANY_TICKERS dict + bare-ticker regex in detect_tickers() find
# nothing — e.g. "Analiza Micron" has no hardcoded entry for Micron/MU, so
# this is what lets a live Finnhub symbol search resolve it instead of the
# request silently going through with zero real data.
_ANALYSIS_FILLER_RE = re.compile(
    r"anal[ií]z\w*|an[aá]lisis (de|fundamental)|es buena (compra|inversi[oó]n)|"
    r"vale la pena|me conviene|\b(compro|entro a)\b|veredicto sobre|dame tu|"
    r"qu[eé] opinas de|c[oó]mo ves|recomiendas (comprar|invertir)|"
    r"\banalyz\w*|what do you think of|good buy|worth investing|deep dive|full analysis|"
    r"a fondo|por favor|acci[oó]n|empresa|compañ[ií]a|company|stock",
    re.IGNORECASE,
)


def _resolve_ticker_via_search(message: str) -> list[str]:
    """Live fallback for company names outside the curated COMPANY_TICKERS
    dict (a ~70-name whitelist — Micron/MU, PG, etc. aren't in it). Strips
    the trigger phrasing out of the message and searches whatever's left via
    Finnhub's symbol search (cheap, cached 1h). Only called when the cheap
    dict/regex lookup in detect_tickers() already came up empty and the
    message clearly wants a company analysis — never on every message."""
    candidate = _ANALYSIS_FILLER_RE.sub(" ", message).strip(" ?¿!¡.,:;")
    candidate = re.sub(r"\s+", " ", candidate)
    if not candidate or len(candidate) > 60:
        return []
    try:
        results = fh_search(candidate)
    except Exception as e:
        logger.warning("_resolve_ticker_via_search(%r) failed: %s", candidate, e)
        return []
    # Finnhub's search ranks best-match first; only common-stock results are
    # useful here (skip warrants/options/OTC noise it sometimes returns).
    for r in results:
        if r.get("symbol") and r.get("type", "").lower() in ("common stock", "equity", ""):
            return [r["symbol"]]
    return []


def _fundamentals_context_block(tickers: list[str]) -> str:
    from app.services.fundamental_analysis_service import (
        get_fundamental_analysis,
        format_fundamental_analysis_for_prompt,
    )
    blocks = []
    for t in tickers[:_MAX_FUNDAMENTALS_TICKERS]:
        try:
            data = get_fundamental_analysis(t)
            if data:
                blocks.append(format_fundamental_analysis_for_prompt(data))
        except Exception as e:
            logger.warning("_fundamentals_context_block(%s) failed: %s", t, e)
    return "\n\n".join(blocks)


def _undervalued_screener_context_block() -> str:
    """Real, DCF-backed undervalued candidates (see undervalued_screener_
    service — precomputed weekly, cache-only read here, never live
    computation inside a chat request). Empty string if the cache hasn't
    been populated yet (job hasn't run, or nothing currently qualifies)."""
    from app.services.undervalued_screener_service import get_undervalued, bootstrap_fill_if_empty_sync
    from datetime import datetime, timezone

    data = get_undervalued(limit=8)
    results = data.get("results") or []
    if not results:
        # Cache is completely empty — never surface "no data" to the user
        # if we can help it. This runs inside a worker thread (this function
        # is dispatched via _ENRICH_POOL.submit), so the blocking scan is
        # safe here; slower this one time, fast for every request after.
        bootstrap_fill_if_empty_sync()
        data = get_undervalued(limit=8)
        results = data.get("results") or []
    if not results:
        return (
            "[SCREENER DE ACCIONES SUBVALUADAS — SIN DATOS] El cache del screener semanal está vacío "
            "(el job de actualización no ha corrido todavía, o ninguna empresa del universo calificó esta "
            "semana) — dilo explícitamente, no inventes candidatos."
        )
    ts = data.get("generated_at") or 0
    generated_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d") if ts else "fecha desconocida"
    lines = [
        f"[SCREENER DE ACCIONES SUBVALUADAS — DATOS REALES, calculados con el mismo motor de DCF que el resto "
        f"de Nuvos, actualizado semanalmente. Snapshot de: {generated_str}. Estos son TODOS los candidatos reales "
        f"disponibles ahora mismo — nunca menciones un ticker que no esté en esta lista, nunca inventes uno adicional]:",
    ]
    for r in results:
        ts_scores = r.get("thesis_scores") or {}
        lines.append(
            f"  - {r['ticker']} ({r.get('company_name') or 'N/D'}, sector {r.get('sector') or 'N/D'}): "
            f"precio ${r.get('price')}, valor intrínseco base ${r.get('intrinsic_value_base')}, "
            f"margen de seguridad +{r.get('margin_of_safety_pct')}%, "
            f"Business Quality {ts_scores.get('business_quality', 'N/D')}/100, "
            f"Financial Strength {ts_scores.get('financial_strength', 'N/D')}/100"
        )
    return "\n".join(lines)


def _enrich_message(message: str, timeout: float = 3.0, premium: bool = False) -> str:
    """Prepend global market context + per-company context, and — Premium
    users asking for a full company verdict only — a real computed
    fundamental analysis (10-year trends, ROIC, deterministic DCF; see
    fundamental_analysis_service). Perplexity is deliberately not used here
    — it's reserved for notifications (price-alert WHY, major news) and Deep
    Research only."""
    f_global  = _ENRICH_POOL.submit(get_global_market_context)
    f_company = _ENRICH_POOL.submit(get_market_context_for_message, message)

    f_fundamentals = None
    if premium and _DEEP_ANALYSIS_RE.search(message):
        deep_tickers = detect_tickers(message)
        if not deep_tickers:
            # Company not in the curated COMPANY_TICKERS dict (e.g. "Analiza
            # Micron") — never skip the fetch just because it's not one of
            # the ~70 hardcoded names; resolve it live instead.
            deep_tickers = _resolve_ticker_via_search(message)
        if deep_tickers:
            f_fundamentals = _ENRICH_POOL.submit(_fundamentals_context_block, deep_tickers)

    f_screener = None
    if premium and _UNDERVALUED_SCREENER_RE.search(message):
        f_screener = _ENRICH_POOL.submit(_undervalued_screener_context_block)

    global_ctx  = ""
    company_ctx = ""
    fundamentals_ctx = ""
    screener_ctx = ""
    try:
        global_ctx = f_global.result(timeout=timeout)
    except Exception:
        pass
    try:
        company_ctx = f_company.result(timeout=timeout)
    except Exception:
        pass
    if f_fundamentals:
        try:
            fundamentals_ctx = f_fundamentals.result(timeout=_FUNDAMENTALS_TIMEOUT)
        except Exception:
            pass
    if f_screener:
        try:
            screener_ctx = f_screener.result(timeout=timeout)
        except Exception:
            pass

    parts = [message]
    if fundamentals_ctx:
        parts.append("\n\n" + fundamentals_ctx)
    if screener_ctx:
        parts.append("\n\n" + screener_ctx)
    if global_ctx:
        parts.append("\n\n" + global_ctx)
    if company_ctx:
        parts.append(company_ctx)
    return "\n".join(parts) if len(parts) > 1 else message


@router.post("/stream")
@limiter.limit("20/minute")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(get_current_user_id)
):
    has_images = bool(body.images or body.image_data)

    # NOTE: this route has no active caller — web and mobile both use
    # /message (see chat_message below), which is where the generic-question
    # cache (#8/#9) and the daily cost cap actually live. Kept minimal here
    # rather than duplicating that logic into a route nothing calls.

    # Normalize: merge legacy single-image into the images list
    images = [{"data": img.data, "type": img.type} for img in body.images] if body.images else None
    if not images and body.image_data:
        images = [{"data": body.image_data, "type": body.image_type or "image/jpeg"}]

    # Fetch profile first (needed for premium check + enrichment timeout)
    profile = await _get_user_profile(user_id)
    premium = _is_premium(profile)
    enrich_timeout = 4.0 if premium else 2.5

    async def _safe_enrich():
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_enrich_message, body.message, enrich_timeout, premium),
                timeout=enrich_timeout + 1.0,
            )
        except Exception:
            return body.message

    async def _progress_ctx():
        # Premium-only, mirroring the dashboard's own gating — free users'
        # mentor doesn't get the deeper progress narrative either.
        if not premium:
            return None
        return await investor_progress_service.build_progress_context_for_mentor(user_id)

    async def _memory_ctx():
        # See the same-named helper in chat_message() below for why this is
        # skipped once the client already sent conversation_history.
        if body.conversation_history:
            return None
        return await _get_memory_context(user_id)

    if has_images:
        memory, deep_ctx, progress_ctx = await asyncio.gather(
            _memory_ctx(),
            _get_mentor_deep_context(user_id),
            _progress_ctx(),
        )
        enriched = body.message
    else:
        memory, deep_ctx, progress_ctx, enriched = await asyncio.gather(
            _memory_ctx(),
            _get_mentor_deep_context(user_id),
            _progress_ctx(),
            _safe_enrich(),
        )

    async def generate():
        # This used to have no exception handling at all: if Claude erred
        # mid-stream (rate limit, 529 overloaded, network blip), the HTTP 200
        # + streaming headers were already sent, so the client just received
        # a silently truncated response with no error and no retry hint —
        # the core product's most exposed dependency degrading invisibly.
        # Yielding a clear terminal marker instead lets the frontend show
        # "the assistant had trouble responding, try again" rather than a
        # response that just stops mid-sentence with no explanation.
        try:
            async for chunk in ai_service.chat_stream(
                message=enriched,
                conversation_history=body.conversation_history,
                profile=profile,
                mentor=body.mentor,
                images=images,
                memory_context=memory,
                notification_context=body.notification_context,
                deep_context=deep_ctx,
                progress_context=progress_ctx,
                is_premium=premium,
            ):
                yield chunk
        except Exception as e:
            logger.error("chat_stream failed mid-response for user %s: %s", user_id, e)
            yield "\n\n[[NUVOS_STREAM_ERROR]] Tuvimos un problema generando la respuesta. Intenta de nuevo."

    return StreamingResponse(generate(), media_type="text/plain")


@router.post("/message")
@limiter.limit("30/minute")
async def chat_message(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(get_current_user_id)
):
    profile = await _get_user_profile(user_id)
    if profile:
        await _check_and_increment_msg_limit(user_id, profile)
    premium = _is_premium(profile)
    if not premium:
        await _check_daily_cost_cap(user_id)
    has_images = bool(body.images or body.image_data)

    # Cost-optimization #8/#9: an exact repeat of a standalone textbook-style
    # question ("qué es un ETF") can be served from cache regardless of
    # provider — this is the narrow, conservative classifier (see
    # generic_qa_cache.py), kept separate from the broader GPT-mini routing
    # gate below because caching needs to be safe to share across ALL users
    # verbatim, which is a stricter bar than "doesn't need live data".
    from app.services.generic_qa_cache import classify_and_cache_key, get_cached_answer, store_answer
    cache_key = classify_and_cache_key(body.message, has_images, len(body.conversation_history))
    if cache_key:
        cached = get_cached_answer(cache_key)
        if cached:
            return {"reply": cached, "risk_assessment": None, "tickers": [], "actions": None}

    # Dual routing (default model for BOTH free and premium): anything that
    # doesn't need a specific ticker/company, the user's own portfolio, live
    # market data, or images goes to GPT-5.4-mini first — general financial
    # chat, education, metric explanations, "am I diversified" questions, etc.
    # Falls back to the Claude tier below untouched if OpenAI isn't
    # configured, the call fails, or the question needs real analysis
    # ("analízame esta acción" → _needs_claude_analysis is True).
    if not _needs_claude_analysis(body.message, has_images):
        generic_answer = await ai_service.generate_generic_answer(
            body.message, conversation_history=body.conversation_history,
        )
        if generic_answer:
            if cache_key:
                store_answer(cache_key, generic_answer)
            return {"reply": generic_answer, "risk_assessment": None, "tickers": [], "actions": None}

    # Claude tier — reached when the question needs real analysis, or as a
    # safety-net fallback when GPT-mini was skipped/unavailable/failed above.
    # Free users always get Haiku. Premium users get Haiku only for the
    # narrow cacheable-generic case; anything else (including "basic"
    # questions that just happened to fail the mini call) gets Sonnet.
    is_generic_question = cache_key is not None
    chat_model = "claude-haiku-4-5-20251001" if (not premium or is_generic_question) else None

    enrich_timeout = 4.0 if premium else 2.5
    tickers  = await asyncio.to_thread(detect_tickers, body.message)
    enriched = await asyncio.to_thread(_enrich_message, body.message, enrich_timeout, premium) if not has_images else body.message
    images = [{"data": img.data, "type": img.type} for img in body.images] if body.images else None
    if not images and body.image_data:
        images = [{"data": body.image_data, "type": body.image_type or "image/jpeg"}]
    async def _progress_ctx():
        if not premium:
            return None
        return await investor_progress_service.build_progress_context_for_mentor(user_id)

    async def _memory_ctx():
        # The frontend already sends the last ~18-20 turns of the CURRENT
        # session as conversation_history (native multi-turn messages) — when
        # that's non-empty, chat_history's last-10 flattened into a text block
        # here would just repeat the same turns a second time in the prompt.
        # Only worth the DB read + extra tokens for a brand-new session (no
        # client-side history yet), where it gives cross-session continuity.
        if body.conversation_history:
            return None
        return await _get_memory_context(user_id)

    memory, deep_ctx, progress_ctx = await asyncio.gather(
        _memory_ctx(),
        _get_mentor_deep_context(user_id),
        _progress_ctx(),
    )
    full = ""
    async for chunk in ai_service.chat_stream(
        message=enriched,
        conversation_history=body.conversation_history,
        profile=profile,
        mentor=body.mentor,
        images=images,
        memory_context=memory,
        notification_context=body.notification_context,
        deep_context=deep_ctx,
        progress_context=progress_ctx,
        is_premium=premium,
        model=chat_model,
    ):
        full += chunk
    clean_reply, bscore = _extract_bscore(full)
    clean_reply, actions = _extract_action(clean_reply)
    if cache_key:
        store_answer(cache_key, clean_reply)

    return {"reply": clean_reply, "risk_assessment": bscore, "tickers": tickers, "actions": actions}


@router.post("/save-message")
async def save_message(
    request: dict,
    user_id: str = Depends(get_current_user_id)
):
    try:
        from datetime import datetime
        db = get_supabase()
        record = {
            "user_id": user_id,
            "role": request.get("role"),
            "content": request.get("content"),
            "created_at": datetime.utcnow().isoformat(),
            "session_id": request.get("session_id"),
        }
        await run_query(db.table("chat_history").insert(record))
    except Exception:
        pass
    return {"saved": True}


@router.post("/transcribe")
@limiter.limit("30/minute")
async def transcribe_audio(
    request: Request,
    audio: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Convert voice recording to text using OpenAI Whisper."""
    from app.services.voice_service import transcribe_audio_bytes
    try:
        audio_bytes = await audio.read()
        text = await transcribe_audio_bytes(
            audio_bytes,
            filename=audio.filename or "audio.m4a",
            content_type=audio.content_type or "audio/m4a",
        )
        return {"text": text}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al transcribir: {str(e)}")


@router.post("/speak")
@limiter.limit("30/minute")
async def speak_text(
    request: Request,
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Convert text to speech. Uses ElevenLabs if configured, else OpenAI TTS."""
    from app.services.voice_service import synthesize_speech_b64
    text = (body.get("text") or "").strip()[:2000]
    if not text:
        raise HTTPException(status_code=400, detail="text requerido")
    try:
        return {"audio": await synthesize_speech_b64(text)}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar voz: {str(e)}")


@router.delete("/history/{session_id}")
async def delete_history_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """Deletes every chat_history row for one conversation (session_id),
    scoped to the caller. Without this, the frontend's "delete" only removed
    the session from local state — the messages stayed in the DB, so the
    next history sync (on mount / periodic retries) silently rebuilt and
    re-inserted the "deleted" conversation."""
    db = get_supabase()
    q = db.table("chat_history").delete().eq("user_id", user_id)
    # Messages saved before session_id existed are grouped client-side under
    # the synthetic id "legacy" (store.ts: `msg.session_id ?? "legacy"") —
    # those rows have session_id IS NULL in the DB, not the string "legacy".
    q = q.is_("session_id", "null") if session_id == "legacy" else q.eq("session_id", session_id)
    await run_query(q)
    return {"deleted": True}


@router.get("/history")
async def get_history(
    limit: int = 500,
    since: str | None = None,
    user_id: str = Depends(get_current_user_id)
):
    try:
        db = get_supabase()
        q = (
            db.table("chat_history")
            .select("id, role, content, created_at, session_id")
            .eq("user_id", user_id)
        )
        if since:
            q = q.gt("created_at", since).order("created_at", desc=False)
        else:
            q = q.order("created_at", desc=True).limit(limit)
        result = await run_query(q)
        msgs = result.data if since else list(reversed(result.data))
        return {"messages": msgs}
    except Exception:
        return {"messages": []}
