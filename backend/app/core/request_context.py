"""Per-request context shared with deep call sites that don't receive the
user id as an argument — used by llm_usage.log_llm_usage so every priced
LLM call made while serving a user's request is attributed to that user
(Sep 2026: 89% of llm_usage_log rows had user_id NULL, which made per-user
usage — and therefore usage-based billing — impossible to trust).

asyncio tasks and asyncio.to_thread copy the current context, so work
spawned from inside a request keeps the attribution."""
from contextvars import ContextVar

current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)
