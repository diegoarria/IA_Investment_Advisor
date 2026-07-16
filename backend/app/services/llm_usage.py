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
) -> None:
    """Fire-and-forget: insert one row into llm_usage_log. Never raises —
    a logging failure must never break the actual chat/job response."""
    try:
        def _get(field):
            return getattr(usage, field, None) if not isinstance(usage, dict) else usage.get(field)

        input_tokens = _get("input_tokens") or 0
        output_tokens = _get("output_tokens") or 0
        cache_creation = _get("cache_creation_input_tokens") or 0
        cache_read = _get("cache_read_input_tokens") or 0
        cost = compute_cost_usd(model, input_tokens, output_tokens, cache_creation, cache_read)

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
