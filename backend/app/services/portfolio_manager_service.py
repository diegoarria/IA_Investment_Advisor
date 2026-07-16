"""Shared cheap-Haiku-insight helper for worker push jobs. Kept as a small,
standalone call — no full mentor system prompt — matching the cost-conscious
pattern used for every other high-volume worker push.

Used today by job_sunday_portfolio_review (worker.py). The concentration-risk,
diversification, and thesis-drift insight generators that used to live here
were removed along with their notification jobs.
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
