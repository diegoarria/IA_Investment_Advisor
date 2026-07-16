"""
Nuvos Deep Research — multi-stage AI research pipeline.

Unlike every other feature in ai_service.py (one Claude call -> one JSON
response), this is a genuine multi-stage pipeline: understand & plan -> collect
real data -> reason per company -> compare/value -> personalize -> synthesize
the final modular report. Each stage is a separate function so any one of them
can be replaced/improved independently, per the product spec.

v1 data sources are real but honestly scoped: structured financials (SEC EDGAR
XBRL + fiscal.ai/FMP/yfinance fallback chain, via market_data_service /
financial_data_service — both already in production) and live Perplexity web
search for recent qualitative context. There is no literal 10-K/10-Q/earnings-
call full-text access anywhere in this codebase yet, so prompts are explicitly
instructed never to claim they read filing text verbatim.
"""

import asyncio
import json
import logging
import re
import traceback
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_supabase, run_query
from app.services.ai_service import _claude
from app.services import market_data_service, perplexity_service
from app.api.routes.sync import _parse_portfolio

_log = logging.getLogger("uvicorn.error")

_STAGE_LABELS = {
    "plan":          "Entendiendo tu solicitud...",
    "collect":       "Recopilando métricas financieras y noticias recientes...",
    "analyze":       "Analizando cada empresa...",
    "compare":       "Comparando y construyendo el modelo de valuación...",
    "personalize":   "Comparando con tu portafolio...",
    "synthesize":    "Generando conclusiones y escribiendo el reporte...",
}


def _parse_json(raw: str) -> dict:
    """Same tolerant-parse pattern used throughout ai_service.py."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            return json.loads(m.group())
        raise


# ── Stage 1: Understand & Plan ───────────────────────────────────────────────

async def create_plan(request_text: str) -> dict:
    """Single Claude call: free-text research request -> structured plan.
    Fast, synchronous — this is what powers POST /api/research/plan."""
    system_prompt = (
        "Eres el planificador de un motor de investigación de inversiones. "
        "Tu único trabajo es interpretar la solicitud del usuario y devolver JSON puro "
        "describiendo qué investigación se necesita. No investigues nada tú mismo todavía."
    )
    prompt = f"""Solicitud del usuario: "{request_text}"

Devuelve JSON puro (sin markdown, sin texto extra):
{{
  "companies": ["<tickers reales en mayúscula involucrados, ej. AMZN, MELI>"],
  "comparison_type": "<single|comparison|screening|portfolio_fit>",
  "needs_portfolio_personalization": <true|false — true si el usuario pide comparar con "mi portafolio" o similar>,
  "metrics_needed": ["<ej. ROIC, revenue_growth, fcf, valuation>"],
  "relevant_blocks": ["<subset relevante de: executive_summary, business_overview, recent_changes, business_model, competitive_advantages, industry_analysis, competitor_comparison, financial_analysis, management_evaluation, risk_analysis, catalysts, valuation, historical_performance, portfolio_compatibility, alternative_ideas, investment_thesis, key_takeaways, sources>"],
  "summary": "<1-2 oraciones confirmando al usuario qué se va a investigar>"
}}

Reglas: "companies" debe tener tickers reales y válidos (si el usuario no menciona una empresa específica sino un criterio de screening, deja companies vacío y describe el criterio en "summary"). Solo JSON puro."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=1200,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    return _parse_json(response.content[0].text)


# ── Stage 2: Collect data (deterministic, no AI) ─────────────────────────────

async def _collect_data(plan: dict, user_id: str) -> dict:
    companies = plan.get("companies") or []

    async def _company_data(ticker: str) -> dict:
        context = await asyncio.to_thread(market_data_service.get_company_context, ticker)
        return {"ticker": ticker, "context": context}

    company_data = await asyncio.gather(*(_company_data(t) for t in companies))

    news = ""
    if plan.get("comparison_type") == "screening" or not companies:
        query = plan.get("summary") or "investment research"
        news = await asyncio.to_thread(perplexity_service.search_web, query)

    portfolio_positions: list[dict] = []
    if plan.get("needs_portfolio_personalization"):
        db = get_supabase()
        res = await run_query(
            db.table("user_portfolio").select("positions")
            .eq("user_id", user_id).eq("portfolio_id", "default")
        )
        if res.data:
            portfolio_positions = _parse_portfolio(res.data[0]["positions"]).get("positions", [])

    return {
        "companies": company_data,
        "news": news,
        "portfolio_positions": portfolio_positions,
    }


# ── Stage 3: Per-company reasoning ───────────────────────────────────────────

async def _analyze_company(ticker: str, context: str) -> dict:
    system_prompt = (
        "Eres un analista de inversiones senior. Respondes solo con JSON puro. "
        "Básate ÚNICAMENTE en los datos reales provistos (precio, métricas financieras, noticias). "
        "NUNCA afirmes haber leído el texto completo de un 10-K, 10-Q o earnings call — "
        "solo tienes métricas numéricas estructuradas y noticias recientes, no el texto de los filings."
    )
    prompt = f"""Datos reales de {ticker}:
{context}

Devuelve JSON puro:
{{
  "ticker": "{ticker}",
  "business_overview": "<2-3 oraciones>",
  "recent_changes": "<qué cambió recientemente, basado en las noticias/datos provistos>",
  "financial_analysis": {{"revenue_trend": "<1 oración>", "margins": "<1 oración>", "fcf": "<1 oración>", "balance_sheet": "<1 oración>"}},
  "competitive_position": "<2 oraciones>",
  "risks": ["<riesgo 1>", "<riesgo 2>"],
  "catalysts": ["<catalizador 1>", "<catalizador 2>"]
}}
Solo JSON puro."""
    response = await _claude(
        model=settings.claude_model,
        max_tokens=1500,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    return _parse_json(response.content[0].text)


# ── Stage 4: Comparative & valuation reasoning ───────────────────────────────

async def _compare_and_value(findings: list[dict], plan: dict) -> dict:
    if len(findings) < 2 and plan.get("comparison_type") != "single":
        pass  # still run — valuation alone is useful even for one company
    system_prompt = (
        "Eres un analista de valuación senior. Respondes solo con JSON puro, basado "
        "estrictamente en los datos ya analizados que se te proveen — no inventes cifras nuevas."
    )
    prompt = f"""Hallazgos por empresa: {json.dumps(findings, ensure_ascii=False)}

Devuelve JSON puro:
{{
  "competitor_comparison": "<si hay 2+ empresas, tabla textual comparativa; si es 1 sola, ''>",
  "valuation": {{"summary": "<2-3 oraciones sobre si está cara/barata y por qué>", "scenarios": [{{"case": "bull|base|bear", "detail": "<1 oración>"}}]}},
  "investment_thesis": "<3-4 oraciones: la tesis de inversión ganadora entre las opciones analizadas>"
}}
Solo JSON puro."""
    response = await _claude(
        model=settings.claude_model,
        max_tokens=1500,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    return _parse_json(response.content[0].text)


# ── Stage 5: Personalization — math in Python, narrative in Claude ──────────

def _sector_weights(positions: list[dict], sector_by_ticker: dict[str, str]) -> dict[str, float]:
    total = sum((p.get("shares") or 0) * (p.get("avgPrice") or 0) for p in positions)
    if total <= 0:
        return {}
    weights: dict[str, float] = {}
    for p in positions:
        sector = sector_by_ticker.get(p.get("ticker", "").upper(), "Otro")
        value = (p.get("shares") or 0) * (p.get("avgPrice") or 0)
        weights[sector] = weights.get(sector, 0) + value / total * 100
    return weights


async def _personalize(plan: dict, data: dict, findings: list[dict]) -> dict | None:
    positions = data.get("portfolio_positions") or []
    if not positions or not plan.get("needs_portfolio_personalization"):
        return None

    import yfinance as yf

    def _sector(ticker: str) -> str:
        try:
            return yf.Ticker(ticker).info.get("sector") or "Otro"
        except Exception:
            return "Otro"

    candidate_tickers = [c["ticker"] for c in data.get("companies", [])]
    held_extra_tickers = [
        p.get("ticker", "").upper() for p in positions
        if p.get("ticker", "").upper() not in candidate_tickers
    ]
    # Previously these were two sequential `for` loops each `await`-ing one
    # ticker at a time — for a 10-position portfolio + 3 candidate tickers,
    # that's ~13 blocking yfinance calls run one after another (each
    # potentially 1-2s), adding up to 15-20s of pure serial latency on every
    # personalized report. Running them concurrently via asyncio.gather cuts
    # that down to roughly the slowest single lookup instead of the sum of
    # all of them.
    all_tickers = list(dict.fromkeys(candidate_tickers + held_extra_tickers))
    sectors = await asyncio.gather(*(asyncio.to_thread(_sector, t) for t in all_tickers))
    sector_by_ticker = dict(zip(all_tickers, sectors))

    before = _sector_weights(positions, sector_by_ticker)

    # Simulate adding an equal-weighted position in each candidate ticker
    sim_positions = list(positions) + [
        {"ticker": t, "shares": 1, "avgPrice": sum(p.get("shares", 0) * p.get("avgPrice", 0) for p in positions) / max(len(positions), 1) / max(len(candidate_tickers), 1) or 100}
        for t in candidate_tickers
    ]
    after = _sector_weights(sim_positions, sector_by_ticker)

    held_tickers = {p.get("ticker", "").upper() for p in positions}
    overlap = [t for t in candidate_tickers if t in held_tickers]

    computed = {
        "sector_exposure_before": before,
        "sector_exposure_after": after,
        "overlap_with_holdings": overlap,
    }

    system_prompt = (
        "Escribes insights de personalización de portafolio. Se te dan NÚMEROS YA CALCULADOS "
        "— tu único trabajo es redactar 2-4 oraciones naturales explicándolos, sin inventar cifras nuevas."
    )
    prompt = f"""Datos calculados: {json.dumps(computed, ensure_ascii=False)}

Devuelve JSON puro:
{{"portfolio_compatibility": "<2-4 oraciones citando los números reales, ej. 'esto sube tu exposición a tecnología de X% a Y%'>"}}
Solo JSON puro."""
    response = await _claude(
        model=settings.claude_model,
        max_tokens=600,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    narrative = _parse_json(response.content[0].text)
    return {**computed, **narrative}


# ── Stage 6: Final synthesis ─────────────────────────────────────────────────

async def _synthesize_report(plan: dict, findings: list[dict], comparison: dict, personalization: dict | None) -> dict:
    system_prompt = (
        "Ensamblas el reporte final de investigación de inversiones. Respondes solo con JSON puro. "
        "Solo incluye bloques relevantes a la solicitud original — nunca fuerces una estructura fija."
    )
    payload = {
        "plan": plan, "findings": findings, "comparison": comparison,
        "personalization": personalization,
    }
    prompt = f"""Insumos: {json.dumps(payload, ensure_ascii=False, default=str)}

Devuelve JSON puro con la forma:
{{
  "title": "<título del reporte>",
  "blocks": [
    {{"type": "<uno de: {', '.join(plan.get('relevant_blocks') or [])}>", "data": {{...}}}}
  ]
}}
Incluye un bloque "key_takeaways" (lista de 3-5 puntos) y "sources" (lista de fuentes usadas: métricas financieras estructuradas, SEC EDGAR, búsqueda web reciente — nunca afirmes haber leído filings completos). Solo JSON puro."""
    response = await _claude(
        model=settings.claude_model,
        max_tokens=4000,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
        thinking={"type": "enabled", "budget_tokens": 3000},
    )
    # With extended thinking, content[0] is the thinking block and the JSON is the last block.
    text_block = next((b for b in response.content if getattr(b, "type", "") == "text"), response.content[-1])
    return _parse_json(text_block.text)


# ── Orchestration ─────────────────────────────────────────────────────────────
#
# Jobs are claimed atomically from Postgres (claim_research_job(), see
# migrations/034_research_job_queue.sql — FOR UPDATE SKIP LOCKED, safe for any
# number of concurrent claimers) by worker.py's job_deep_research_worker(),
# NOT fired off via asyncio.create_task from the web request that happened to
# call /start. This is what makes a backend restart mid-job survivable: the
# job row itself is the durable queue entry, not an in-memory asyncio.Task
# that dies with the process. A stale heartbeat means the worker that claimed
# it is gone; reap_stale_jobs() requeues it (or fails+refunds it once
# max_attempts is exhausted) rather than leaving it stuck forever.

_HEARTBEAT_STALE_SECONDS = 600  # 10 min — generous vs. a typical 2-5 min run
_WORKER_ID = None


def _worker_id() -> str:
    global _WORKER_ID
    if _WORKER_ID is None:
        import os, socket
        _WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
    return _WORKER_ID


async def _set_stage(db, job_id: str, stage_key: str) -> None:
    await run_query(
        db.table("research_jobs")
        .update({"status": "researching", "current_stage": _STAGE_LABELS[stage_key], "heartbeat_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", job_id)
    )


class _JobCancelled(Exception):
    pass


async def _check_cancelled(db, job_id: str) -> None:
    """Raised between stages so a user-requested cancellation stops the
    pipeline promptly instead of finishing (and charging Anthropic for) work
    nobody wants anymore."""
    res = await run_query(db.table("research_jobs").select("cancel_requested").eq("id", job_id).single())
    if res.data and res.data.get("cancel_requested"):
        raise _JobCancelled()


async def claim_one_job() -> dict | None:
    """Atomically claim a single pending job (does not run it — see
    run_claimed_job). Used by worker.py's job_deep_research_worker() to fill
    open concurrency slots; splitting claim from run lets the worker spawn
    each job as its own concurrent asyncio.Task instead of processing the
    queue one job at a time."""
    db = get_supabase()
    claim_res = await run_query(db.rpc("claim_research_job", {"p_worker_id": _worker_id()}))
    rows = claim_res.data or []
    return rows[0] if rows else None


async def run_claimed_job(job: dict) -> None:
    """Public entry point for running a job this process already claimed —
    intended to be wrapped in asyncio.create_task by the caller so N of these
    can run concurrently, bounded by worker.py's own concurrency limit."""
    db = get_supabase()
    await _run_claimed_job(db, job)


async def _run_claimed_job(db, job: dict) -> None:
    job_id = job["id"]
    user_id = job["user_id"]
    try:
        # Idempotent-resume: if a previous attempt crashed AFTER inserting the
        # report but BEFORE marking the job completed (a narrow but real
        # window), don't re-run the whole pipeline (re-billing Anthropic and
        # producing a duplicate report) — just finalize using what's already
        # there.
        existing = await run_query(
            db.table("research_reports").select("id").eq("job_id", job_id).limit(1)
        )
        if existing.data:
            await run_query(
                db.table("research_jobs").update({
                    "status": "completed", "current_stage": "Listo",
                    "report_id": existing.data[0]["id"],
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", job_id)
            )
            return

        plan = job["plan"]

        await _set_stage(db, job_id, "collect")
        data = await _collect_data(plan, user_id)
        await _check_cancelled(db, job_id)

        await _set_stage(db, job_id, "analyze")
        findings = await asyncio.gather(*(
            _analyze_company(c["ticker"], c["context"]) for c in data["companies"]
        ))
        findings = list(findings)
        await _check_cancelled(db, job_id)

        await _set_stage(db, job_id, "compare")
        comparison = await _compare_and_value(findings, plan) if findings else {}
        await _check_cancelled(db, job_id)

        await _set_stage(db, job_id, "personalize")
        personalization = await _personalize(plan, data, findings)
        await _check_cancelled(db, job_id)

        await _set_stage(db, job_id, "synthesize")
        report = await _synthesize_report(plan, findings, comparison, personalization)
        await _check_cancelled(db, job_id)

        report_res = await run_query(
            db.table("research_reports").insert({
                "user_id": user_id,
                "job_id": job_id,
                "title": report.get("title") or plan.get("summary") or "Reporte de investigación",
                "companies": plan.get("companies") or [],
                "blocks": report.get("blocks") or [],
            })
        )
        report_id = report_res.data[0]["id"]

        await run_query(
            db.table("research_jobs").update({
                "status": "completed",
                "current_stage": "Listo",
                "report_id": report_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id)
        )

        try:
            from app.services.web_push_service import send_web_push_to_user
            lang_res = await run_query(
                db.table("user_profiles").select("preferred_language").eq("user_id", user_id).limit(1)
            )
            is_en = ((lang_res.data or [{}])[0].get("preferred_language") or "es") == "en"
            if is_en:
                push_title = "Your Deep Research is ready"
                push_body = report.get("title") or "Your research report is now available."
            else:
                push_title = "Tu Deep Research está listo"
                push_body = report.get("title") or "Tu reporte de investigación ya está disponible."
            await send_web_push_to_user(
                user_id, push_title, push_body,
                {"type": "deep_research", "report_id": report_id},
            )
        except Exception:
            pass

    except _JobCancelled:
        _log.info("research job %s cancelled by user", job_id)
        await run_query(
            db.table("research_jobs").update({
                "status": "cancelled",
                "current_stage": "Cancelado",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id)
        )
        await _maybe_refund(job)

    except Exception as exc:
        _log.error("research pipeline failed for job %s: %s\n%s", job_id, exc, traceback.format_exc())
        attempts = job.get("attempts", 1)
        max_attempts = job.get("max_attempts", 3)
        if attempts < max_attempts:
            # Requeue for another attempt rather than failing outright on the
            # first transient error (a Claude 529, a flaky market-data fetch).
            await run_query(
                db.table("research_jobs").update({
                    "status": "pending", "claimed_by": None, "claimed_at": None,
                    "error": str(exc)[:500],
                }).eq("id", job_id)
            )
        else:
            await run_query(
                db.table("research_jobs").update({
                    "status": "failed",
                    "error": str(exc)[:500],
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", job_id)
            )
            await _maybe_refund(job)


async def _maybe_refund(job: dict) -> None:
    """A paid job that ends in permanent failure or user cancellation must
    not silently keep the user's money — issue a Stripe refund automatically.
    Best-effort: never raises (a refund failure shouldn't crash the reaper/
    pipeline), but does log loudly since this is a real money issue that
    needs a human to notice if the automatic path fails."""
    if job.get("refunded") or not job.get("stripe_session_id"):
        return
    db = get_supabase()
    try:
        import stripe
        if not settings.stripe_secret_key:
            return
        stripe.api_key = settings.stripe_secret_key
        session = await asyncio.to_thread(stripe.checkout.Session.retrieve, job["stripe_session_id"])
        payment_intent = session.get("payment_intent")
        if not payment_intent:
            return
        await asyncio.to_thread(stripe.Refund.create, payment_intent=payment_intent)
        await run_query(db.table("research_jobs").update({"refunded": True}).eq("id", job["id"]))
        _log.info("Refunded Stripe payment for failed/cancelled research job %s", job["id"])
    except Exception as e:
        _log.error("REFUND FAILED for research job %s — needs manual handling: %s", job["id"], e)


async def reap_stale_jobs() -> int:
    """Requeue (or permanently fail + refund) jobs whose claimed worker went
    silent — called periodically by worker.py. Returns the number reaped."""
    db = get_supabase()
    res = await run_query(db.rpc("reap_stale_research_jobs", {"p_stale_after_seconds": _HEARTBEAT_STALE_SECONDS}))
    reaped = res.data or []
    for job in reaped:
        if job["status"] == "failed":
            await _maybe_refund(job)
    if reaped:
        _log.warning("Reaped %d stale research job(s) (stuck past %ds with no heartbeat)", len(reaped), _HEARTBEAT_STALE_SECONDS)
    return len(reaped)
