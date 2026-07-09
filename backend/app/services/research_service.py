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
from app.services import market_data_service, perplexity_service, fmg_service
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
    fmg_context: str | None = None
    if plan.get("needs_portfolio_personalization"):
        db = get_supabase()
        res = await run_query(
            db.table("user_portfolio").select("positions")
            .eq("user_id", user_id).eq("portfolio_id", "default")
        )
        if res.data:
            portfolio_positions = _parse_portfolio(res.data[0]["positions"]).get("positions", [])
        fmg_context = await fmg_service.get_fmg_context(user_id)

    return {
        "companies": company_data,
        "news": news,
        "portfolio_positions": portfolio_positions,
        "fmg_context": fmg_context,
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
    sector_by_ticker = {t: await asyncio.to_thread(_sector, t) for t in candidate_tickers}
    for p in positions:
        t = p.get("ticker", "").upper()
        if t not in sector_by_ticker:
            sector_by_ticker[t] = await asyncio.to_thread(_sector, t)

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
Contexto de comportamiento del usuario: {data.get("fmg_context") or "sin datos previos"}

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

async def _set_stage(db, job_id: str, stage_key: str) -> None:
    await run_query(
        db.table("research_jobs")
        .update({"status": "researching", "current_stage": _STAGE_LABELS[stage_key]})
        .eq("id", job_id)
    )


async def run_pipeline(job_id: str, user_id: str) -> None:
    """Runs stages 2-6 in the background. Called via asyncio.create_task from
    POST /api/research/start — must never raise, always leaves the job row in
    a terminal state (completed/failed)."""
    db = get_supabase()
    try:
        job_res = await run_query(db.table("research_jobs").select("plan").eq("id", job_id).single())
        plan = job_res.data["plan"]

        await _set_stage(db, job_id, "collect")
        data = await _collect_data(plan, user_id)

        await _set_stage(db, job_id, "analyze")
        findings = await asyncio.gather(*(
            _analyze_company(c["ticker"], c["context"]) for c in data["companies"]
        ))
        findings = list(findings)

        await _set_stage(db, job_id, "compare")
        comparison = await _compare_and_value(findings, plan) if findings else {}

        await _set_stage(db, job_id, "personalize")
        personalization = await _personalize(plan, data, findings)

        await _set_stage(db, job_id, "synthesize")
        report = await _synthesize_report(plan, findings, comparison, personalization)

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
            await send_web_push_to_user(
                user_id, "Tu Deep Research está listo",
                report.get("title") or "Tu reporte de investigación ya está disponible.",
                {"type": "deep_research", "report_id": report_id},
            )
        except Exception:
            pass

    except Exception as exc:
        _log.error("research pipeline failed for job %s: %s\n%s", job_id, exc, traceback.format_exc())
        await run_query(
            db.table("research_jobs").update({
                "status": "failed",
                "error": str(exc),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id)
        )
