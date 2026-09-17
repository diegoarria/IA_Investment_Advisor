import asyncio
import logging
import time
import httpx
from supabase import create_client, Client, ClientOptions
from app.core.config import settings

log = logging.getLogger(__name__)

_client: Client | None = None
_client_created_at: float = 0.0
# A process that runs for hours/days on one long-lived Supabase client can
# end up with its underlying HTTP connection pinned to a stale backend node
# (e.g. a lagging PostgREST instance) — confirmed live 2026-09-16: a brand
# new signup's profile row, verified to exist via a fresh, independently-
# created client, was invisible to every query this running process made
# for that same user for several minutes straight (SELECT silently
# returning empty, not an error — the retry logic below can't catch a
# query that "succeeds" with wrong data). Recycling the singleton
# periodically bounds how long any one connection can stay stale, without
# needing every single call site to detect and recover from this itself.
_CLIENT_MAX_AGE_SECONDS = 5 * 60

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
    global _client, _client_created_at
    now = time.monotonic()
    if _client is None or (now - _client_created_at) > _CLIENT_MAX_AGE_SECONDS:
        _client = create_client(settings.supabase_url, settings.supabase_service_key, options=_AUTH_OPTIONS)
        _client_created_at = now
    return _client


async def run_query_verified_nonempty(query_builder_factory, _max_attempts: int = 3):
    """Run a query; if it comes back empty, re-run once against an independent,
    freshly created client before trusting it (see get_fresh_supabase's docstring —
    an empty result through the singleton can be a real empty result OR a stale-
    pinned connection silently returning wrong data, and the two are indistinguishable
    without a second, independent read). Callers whose "genuinely empty" and "false
    empty" cases both fall back to a default (e.g. a fresh paper-trading account vs.
    a stale read of an existing one) should use this instead of run_query directly.

    query_builder_factory takes a Client and returns a query builder, so it can be
    invoked again against a different client instance on the fallback path."""
    res = await run_query(query_builder_factory(get_supabase()), _max_attempts)
    if res.data:
        return res
    return await run_query(query_builder_factory(get_fresh_supabase()), _max_attempts)


def get_fresh_supabase() -> Client:
    """Create a brand-new Supabase client, bypassing the process-wide singleton
    entirely. A read through the singleton that comes back suspiciously empty
    (e.g. a user who should have rows) is indistinguishable, from the caller's
    side, from the stale-pinned-connection issue described in get_supabase's
    docstring — recycling only bounds how long that can persist, it doesn't
    prevent it recurring. Call sites that need to double-check an empty result
    before treating it as real should re-query with this instead of _client."""
    return create_client(settings.supabase_url, settings.supabase_service_key, options=_AUTH_OPTIONS)


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


async def find_auth_user(db, *, email: str | None = None, user_id: str | None = None):
    """Look up a Supabase Auth user by email or id, scanning every page.

    `db.auth.admin.list_users()` called with no arguments does NOT return
    every user — GoTrue's admin API defaults to page=1/per_page=50, so a
    bare `list_users()` silently returns only the first 50 accounts ever
    created. Eight call sites across this codebase (password reset by
    email/SMS, notification dispatch, Duo/admin email lookups, the Google
    OAuth account-migration path) used to call it that way and then filter
    the result in Python — meaning every one of them silently failed to
    find any user created after the app's first ~50 signups, while still
    returning the generic "if that email exists..." success response.
    Confirmed live (2026-09-15): this is why "olvidé mi contraseña" email/
    SMS worked for early accounts but not others. Use this helper instead
    of calling list_users() directly anywhere a specific user needs to be
    found by email or id.

    A lookup by user_id alone doesn't need to page through anyone —
    GoTrue's admin API has a direct, indexed get_user_by_id. Without this
    fast path, send_email_notification() (called once per recipient in
    worker.py's weekly/monthly/annual bulk email jobs, potentially
    thousands of times per run) turned into a paginated full-user-list
    scan on every single email — a real perf/reliability regression caught
    in a 2026-09-16 follow-up review of the original pagination fix."""
    if user_id is not None and email is None:
        try:
            res = await asyncio.to_thread(lambda: db.auth.admin.get_user_by_id(user_id))
            return getattr(res, "user", None)
        except Exception:
            return None
    email_norm = email.lower() if email else None
    page, per_page = 1, 200
    while True:
        batch = await asyncio.to_thread(lambda p=page: db.auth.admin.list_users(page=p, per_page=per_page))
        if not batch:
            return None
        for u in batch:
            if user_id is not None and u.id == user_id:
                return u
            if email_norm is not None and (u.email or "").lower() == email_norm:
                return u
        if len(batch) < per_page:
            return None
        page += 1


async def fetch_all_auth_users(db) -> list:
    """Return every Supabase Auth user, paginated. worker.py has several
    bulk email jobs that build a `{user.id: user.email}` lookup dict via a
    bare `db.auth.admin.list_users()` — same default page=1/per_page=50
    limit as find_auth_user's docstring explains, meaning every one of
    these jobs (weekly summary, monthly report, annual scoreboard, and
    others) silently only ever emailed users among the first 50 ever
    created. Confirmed 2026-09-16, the same day as (but a separate gap
    from) the find_auth_user fix — these call sites build a bulk dict
    upfront rather than looking up one user, so they need every page
    fetched once, not find_auth_user's per-user short-circuit search."""
    page, per_page = 1, 200
    users: list = []
    while True:
        batch = await asyncio.to_thread(lambda p=page: db.auth.admin.list_users(page=p, per_page=per_page))
        if not batch:
            break
        users.extend(batch)
        if len(batch) < per_page:
            break
        page += 1
    return users
