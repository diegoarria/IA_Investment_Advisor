"""Read-only metrics endpoints for the standalone Nuvos Sentinel monitor
(separate infra from Railway) — authenticated via a shared secret header
(app/core/sentinel_auth.py), not a Supabase session, since the monitor has
no logged-in user. Every route here must stay cheap and read-only: it's
polled every ~2 minutes."""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.core.database import get_supabase, run_query
from app.core.sentinel_auth import require_sentinel_secret
from app.services.ip_intel_service import get_ip_intel_batch
from app.core.config import settings
from app.core.feature_flags import get_ai_status, set_ai_enabled

router = APIRouter(prefix="/sentinel", tags=["sentinel"], dependencies=[Depends(require_sentinel_secret)])


def _parse_iso(ts: str) -> datetime:
    """Supabase/Postgres timestamps sometimes come back with a trailing 'Z'
    instead of '+00:00' — datetime.fromisoformat() rejects 'Z' on Python
    versions before 3.11, which is exactly what caused this endpoint's
    first real 500 in production (Railway's Python is older than the local
    dev machine's). Normalize before parsing instead of assuming the format."""
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


@router.get("/security-metrics")
async def security_metrics(minutes: int = 15):
    """Counts from security_events (migration 033) in the last N minutes,
    grouped by event_type, plus distinct-IP counts for the two event types
    that matter most for attack heuristics — a login-failure storm or a
    rate-limit-trip storm from many distinct IPs looks different from the
    same volume hitting from one IP (the latter is more likely one confused
    client than an actual attack). Also returns per-IP counts (top_ips) and
    a raw event sample (recent_events, with device/browser info) so a
    flagged incident can be attributed to specific IPs/devices — the
    standalone Nuvos Sentinel monitor feeds top_ips into /sentinel/ip-intel
    for geolocation/VPN enrichment, but only once a threshold has tripped."""
    since = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    db = get_supabase()
    result = await run_query(
        db.table("security_events")
        .select("event_type, ip_address, user_agent, accept_language, email, created_at")
        .gte("created_at", since)
        .order("created_at", desc=True)
        .limit(5000)
    )
    rows = result.data or []

    by_type: dict[str, int] = {}
    ips_by_type: dict[str, set[str]] = {}
    ip_counts: dict[str, int] = {}
    for row in rows:
        et = row.get("event_type") or "unknown"
        by_type[et] = by_type.get(et, 0) + 1
        if row.get("ip_address"):
            ips_by_type.setdefault(et, set()).add(row["ip_address"])
            ip_counts[row["ip_address"]] = ip_counts.get(row["ip_address"], 0) + 1

    top_ips = sorted(ip_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]

    return {
        "window_minutes": minutes,
        "counts_by_type": by_type,
        "distinct_ips_by_type": {k: len(v) for k, v in ips_by_type.items()},
        "top_ips": [{"ip": ip, "count": count} for ip, count in top_ips],
        "recent_events": rows[:50],
    }


@router.get("/ip-intel")
async def ip_intel(ips: str):
    """Lazy IP geolocation/ISP/VPN/TOR/fraud-score enrichment (IPQualityScore,
    cached — see app/services/ip_intel_service.py). `ips` is a comma-separated
    list, capped at 20 per call — meant to be called only for IPs already
    flagged by /sentinel/security-metrics' attack heuristics, never on every
    poll cycle."""
    ip_list = [ip.strip() for ip in ips.split(",") if ip.strip()]
    return await get_ip_intel_batch(ip_list)


@router.get("/ip-intel-quota")
async def ip_intel_quota():
    """Approximate IPQualityScore usage this calendar month, derived from
    ip_intel_cache (migration 088) rather than a separate counter table —
    each row's fetched_at is bumped only on a real cache-miss API call (see
    ip_intel_service.get_ip_intel). This UNDERCOUNTS an IP looked up more
    than once in the same month (the row is upserted, not appended), but
    since enrichment only happens for already-flagged attacks, that's rare
    and this stays a useful early-warning number, not an exact billing
    figure. Free tier is 5,000/month as of this writing — flag well before
    hitting it."""
    start_of_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    db = get_supabase()
    result = await run_query(
        db.table("ip_intel_cache").select("ip_address", count="exact").gte("fetched_at", start_of_month)
    )
    return {"month_start": start_of_month, "approx_lookups_this_month": result.count or 0}


class AiToggleBody(BaseModel):
    enabled: bool
    reason: str | None = None


@router.get("/ai-status")
async def ai_status():
    """Current state of the AI kill switch (app/core/feature_flags.py) — is
    Arthur/every AI feature enabled or paused, since when, and why."""
    return await get_ai_status()


@router.post("/ai-toggle")
async def ai_toggle(body: AiToggleBody):
    """Flips the AI kill switch — called from the standalone Nuvos Sentinel
    panel's switch. Takes effect within ~10s across every backend process
    (see feature_flags.py's cache TTL), pausing Arthur/support/paper-trading
    analysis/learn debates/deep research/screen explanations/profile
    insights with a friendly maintenance message instead of reaching the
    model. Logged to security_events as 'ai_toggled' for an audit trail."""
    await set_ai_enabled(body.enabled, reason=body.reason, actor="nuvos-sentinel")
    return await get_ai_status()


@router.get("/llm-spend")
async def llm_spend():
    """Today's real, tracked Claude/GPT spend against the hard daily cap —
    same counter check_daily_spend_cap() reads (app/services/ai_service.py,
    added after the Aug 15 real-money incident: $10.51 in a day before the
    cap existed). That cap already stops new calls once crossed, but
    nothing previously told a human the spend was CLIMBING toward it — this
    lets the Sentinel warn well before the circuit breaker has to trip."""
    from app.core.cache import cache_get
    from app.services.ai_service import _daily_spend_cache_key

    spend_today = cache_get(_daily_spend_cache_key()) or 0.0
    cap = settings.daily_llm_spend_cap_usd
    return {
        "spend_today_usd": spend_today,
        "cap_usd": cap,
        "pct": round(100 * spend_today / cap, 1) if cap else None,
    }


@router.get("/backup-heartbeat")
async def backup_heartbeat():
    """Last time the nightly Supabase backup (.github/workflows/db-backup.yml,
    migration 089) reported a SUCCESSFUL pg_dump — written directly by that
    workflow via psql after the backup completes, not by this backend. A
    stale/missing row means either the workflow didn't run or it failed —
    previously the only signal was a GitHub Actions red X that nothing
    actively surfaced to a human."""
    db = get_supabase()
    result = await run_query(
        db.table("backup_heartbeats").select("last_success_at, detail").eq("id", "nightly_backup").limit(1)
    )
    rows = result.data or []
    if not rows:
        return {"last_success_at": None, "age_seconds": None, "detail": "no successful backup recorded yet"}

    last_success_at = rows[0]["last_success_at"]
    age_seconds = (datetime.now(timezone.utc) - _parse_iso(last_success_at)).total_seconds()
    return {"last_success_at": last_success_at, "age_seconds": age_seconds, "detail": rows[0].get("detail")}


@router.get("/worker-heartbeat")
async def worker_heartbeat():
    """Last time worker.py's APScheduler process reported itself alive
    (job_heartbeat, migration 086). A stale/missing heartbeat means the
    Railway `worker` process is stuck or crashed — distinct from the `web`
    process, which /health covers."""
    db = get_supabase()
    result = await run_query(
        db.table("worker_heartbeats").select("last_beat_at, detail").eq("id", "apscheduler").limit(1)
    )
    rows = result.data or []
    if not rows:
        return {"last_beat_at": None, "age_seconds": None, "detail": "no heartbeat row yet"}

    last_beat_at = rows[0]["last_beat_at"]
    age_seconds = (datetime.now(timezone.utc) - _parse_iso(last_beat_at)).total_seconds()
    return {"last_beat_at": last_beat_at, "age_seconds": age_seconds, "detail": rows[0].get("detail")}


@router.get("/client-errors")
async def client_errors(minutes: int = 15):
    """Recent frontend crash reports (migration 087) — a spike here is a
    full-screen ("pantalla en blanco") crash affecting real users, even if
    every backend health check is green."""
    since = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    db = get_supabase()
    result = await run_query(
        db.table("client_errors")
        .select("message, url, created_at")
        .gte("created_at", since)
        .order("created_at", desc=True)
        .limit(200)
    )
    rows = result.data or []
    return {"window_minutes": minutes, "count": len(rows), "recent": rows[:20]}
