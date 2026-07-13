import asyncio
import logging
import httpx
from supabase import create_client, Client
from app.core.config import settings

log = logging.getLogger(__name__)

_client: Client | None = None

# Errors that mean "the connection died mid-flight", not "the query is bad" —
# safe to retry, since the underlying httpx pool opens a fresh connection on
# the next attempt (this is the standard fix for the long-lived HTTP/2 pool
# occasionally hitting a server/idle-timeout disconnect).
_TRANSIENT_ERRORS = (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError, httpx.WriteError)


def get_supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _client


async def run_query(query_builder, _max_attempts: int = 3):
    """Execute a synchronous Supabase query builder without blocking the event loop.
    Retries transient connection drops (server disconnected mid-request) — almost
    always the network dying while reading the response, not before the request was
    sent, so a retry recovers the vast majority of these. Known tradeoff: for a plain
    .insert() (not .upsert()), the rare case where the write actually committed on the
    server but the response was lost before we saw it would duplicate the row on
    retry. Left as-is because most inserts on this path are append-only logs (chat
    history, decisions, events) where an occasional duplicate is harmless, versus every
    read AND write on the platform currently hard-failing on any transient blip."""
    for attempt in range(_max_attempts):
        try:
            return await asyncio.to_thread(lambda: query_builder.execute())
        except _TRANSIENT_ERRORS as exc:
            if attempt + 1 == _max_attempts:
                raise
            log.warning("Supabase query transient error (attempt %d/%d): %s", attempt + 1, _max_attempts, exc)
            await asyncio.sleep(0.25 * (attempt + 1))


async def run_auth(fn, *args, **kwargs):
    """Execute a synchronous Supabase auth call without blocking the event loop."""
    return await asyncio.to_thread(lambda: fn(*args, **kwargs))
