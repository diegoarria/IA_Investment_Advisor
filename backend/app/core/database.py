import asyncio
from supabase import create_client, Client
from app.core.config import settings

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _client


async def run_query(query_builder):
    """Execute a synchronous Supabase query builder without blocking the event loop."""
    return await asyncio.to_thread(lambda: query_builder.execute())


async def run_auth(fn, *args, **kwargs):
    """Execute a synchronous Supabase auth call without blocking the event loop."""
    return await asyncio.to_thread(lambda: fn(*args, **kwargs))
