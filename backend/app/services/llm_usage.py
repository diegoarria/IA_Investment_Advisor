"""Structured cost logging for every Claude API call — recommendation #18/#19
of the cost-optimization architecture (see the "Arquitectura de Costos LLM"
artifact). Every call site that already has an Anthropic `usage` object calls
`log_llm_usage()` once; this never raises and never blocks the response path.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

# $ per 1M tokens. Kept here (not in config) since these are Anthropic's
# published rates, not a deployment-specific setting — update when Anthropic
# changes pricing or Nuvos changes which model an endpoint uses.
_PRICING_PER_1M = {
    "claude-sonnet-4-6":            {"input": 3.00,  "output": 15.00, "cache_write": 3.75, "cache_read": 0.30},
    "claude-haiku-4-5-20251001":    {"input": 1.00,  "output": 5.00,  "cache_write": 1.25,  "cache_read": 0.10},
    "claude-haiku-4-5":             {"input": 1.00,  "output": 5.00,  "cache_write": 1.25,  "cache_read": 0.10},
    # gpt-5-mini was retired by OpenAI — gpt-5.4-mini is the current mini-tier
    # model. Confirmed against developers.openai.com/api/docs/pricing.
    "gpt-5.4-mini":                 {"input": 0.75,  "output": 4.50,  "cache_write": 0.75,  "cache_read": 0.075},
}
_DEFAULT_PRICING = {"input": 3.00, "output": 15.00, "cache_write": 3.75, "cache_read": 0.30}


def compute_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_input_tokens: int = 0,
    cache_read_input_tokens: int = 0,
) -> float:
    p = _PRICING_PER_1M.get(model, _DEFAULT_PRICING)
    return (
        input_tokens / 1_000_000 * p["input"]
        + output_tokens / 1_000_000 * p["output"]
        + cache_creation_input_tokens / 1_000_000 * p["cache_write"]
        + cache_read_input_tokens / 1_000_000 * p["cache_read"]
    )


async def log_llm_usage(
    user_id: str | None,
    endpoint: str,
    model: str,
    usage,  # Anthropic `Usage` object (has .input_tokens, .output_tokens, etc.) or a dict with the same keys
    already_tracked: bool = False,
) -> None:
    """Fire-and-forget: insert one row into llm_usage_log. Never raises —
    a logging failure must never break the actual chat/job response.

    `already_tracked=True` for any call whose response came from
    ai_service._claude() — it already incremented the daily-spend circuit
    breaker's counter itself; this function would otherwise double-count
    it (see the check below)."""
    try:
        def _get(field):
            return getattr(usage, field, None) if not isinstance(usage, dict) else usage.get(field)

        input_tokens = _get("input_tokens") or 0
        output_tokens = _get("output_tokens") or 0
        cache_creation = _get("cache_creation_input_tokens") or 0
        cache_read = _get("cache_read_input_tokens") or 0
        cost = compute_cost_usd(model, input_tokens, output_tokens, cache_creation, cache_read)

        # Feed the same daily-spend counter ai_service.check_daily_spend_cap()
        # reads — but ONLY for call sites that didn't already track this
        # call via _claude() (which does its own increment internally).
        # log_llm_usage() is called after MOST _claude()-routed calls too
        # (for the separate llm_usage_log DB table), so incrementing here
        # unconditionally would double-count those and trip the circuit
        # breaker at roughly half its real configured cap. Pass
        # already_tracked=True from any call site that already went
        # through _claude() (2026-08-21 audit fix — see check_daily_spend_cap
        # in ai_service.py for the call sites that don't and need this).
        if not already_tracked:
            try:
                from app.core.cache import cache_incr_float
                from app.services.ai_service import _daily_spend_cache_key
                cache_incr_float(_daily_spend_cache_key(), cost, ttl=26 * 3600)
            except Exception:
                pass  # never block usage logging on this

        from app.core.database import get_supabase, run_query
        db = get_supabase()
        await run_query(
            db.table("llm_usage_log").insert({
                "user_id": user_id,
                "endpoint": endpoint,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_creation_input_tokens": cache_creation,
                "cache_read_input_tokens": cache_read,
                "cost_usd": round(cost, 6),
            })
        )
    except Exception as e:
        logger.warning("log_llm_usage failed for endpoint=%s: %s", endpoint, e)
