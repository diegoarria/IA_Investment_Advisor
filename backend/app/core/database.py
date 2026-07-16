import asyncio
import logging
import httpx
from supabase import create_client, Client, ClientOptions
from app.core.config import settings

log = logging.getLogger(__name__)

_client: Client | None = None

# auto_refresh_token/persist_session default to True, which assumes ONE
# client per logged-in user — gotrue then caches whatever session was most
# recently saved in a single shared in-memory slot and arms a background
# timer that silently re-refreshes THAT cached session. Since this client is
# a process-wide singleton shared across every concurrent request from every
# user, that produced real cross-user session corruption: one user's
# login/refresh would overwrite the shared slot, and the background timer
# (or another user's /logout call, see logout() in auth.py) would then act
# on the wrong user's session — surfacing as random, rapid, unexplained
# logouts. This backend never relies on the client's own session state
# anyway (tokens are always passed explicitly per request via cookies/
# headers), so both flags are safe — and correct — to disable here.
_AUTH_OPTIONS = ClientOptions(auto_refresh_token=False, persist_session=False)

# Errors that mean "the connection died mid-flight", not "the query is bad" —
# safe to retry, since the underlying httpx pool opens a fresh connection on
# the next attempt (this is the standard fix for the long-lived HTTP/2 pool
# occasionally hitting a server/idle-timeout disconnect).
_TRANSIENT_ERRORS = (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError, httpx.WriteError)


def get_supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_key, options=_AUTH_OPTIONS)
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
