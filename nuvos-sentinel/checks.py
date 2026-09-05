"""Each check returns (ok: bool, detail: str, extra: dict | None). `extra` is
only populated by check_security_metrics (top offending IPs + which device/
browser hit from each) — used by engine.py to enrich and attribute an attack
the moment it's flagged, never on every routine poll. Never raises — a check
that errors out is itself just a failing check, handled by the caller."""
import httpx
import config

_HEADERS = {"X-Sentinel-Key": config.SENTINEL_SHARED_SECRET}
_TIMEOUT = 10.0


async def check_health() -> tuple[bool, str, dict | None]:
    """Uses the backend's existing /health/ready (main.py) — already checks
    Supabase (and Redis, if configured) reachability and returns 503 when
    degraded, so no separate endpoint was needed here."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{config.NUVOS_BACKEND_URL}/health/ready")
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code != 200:
            checks = data.get("checks", {})
            failed = [k for k, v in checks.items() if isinstance(v, dict) and v.get("ok") is False]
            return False, f"backend degraded (status {resp.status_code}): {', '.join(failed) or 'unknown'}", None
        return True, "ok", None
    except Exception as e:
        return False, f"backend unreachable: {e}", None


async def check_frontend() -> tuple[bool, str, dict | None]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(config.NUVOS_WEB_URL)
        if resp.status_code != 200:
            return False, f"frontend returned {resp.status_code}", None
        if config.FRONTEND_EXPECTED_MARKER not in resp.text:
            return False, "frontend responded 200 but expected content marker missing (possible white screen)", None
        return True, "ok", None
    except Exception as e:
        return False, f"frontend unreachable: {e}", None


async def check_worker_heartbeat() -> tuple[bool, str, dict | None]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(f"{config.NUVOS_BACKEND_URL}/api/sentinel/worker-heartbeat")
        if resp.status_code != 200:
            return False, f"worker-heartbeat endpoint returned {resp.status_code}", None
        data = resp.json()
        age = data.get("age_seconds")
        if age is None:
            return False, "no worker heartbeat recorded yet", None
        if age > 300:  # 5x the worker's own 60s beat interval
            return False, f"worker heartbeat stale ({age:.0f}s old)", None
        return True, "ok", None
    except Exception as e:
        return False, f"could not reach worker-heartbeat endpoint: {e}", None


async def check_security_metrics() -> tuple[bool, str, dict | None]:
    """Not an up/down check — flags a likely attack in progress. Returns
    ok=False (i.e. "alert-worthy") when a threshold trips, plus `extra`:
    the top offending IPs and, per IP, the most recent user-agent seen — the
    raw material engine.py enriches (geolocation/VPN/fraud score, lazily,
    only once this actually trips) and shows in the panel/alert."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            sec_resp = await client.get(
                f"{config.NUVOS_BACKEND_URL}/api/sentinel/security-metrics",
                params={"minutes": config.SECURITY_METRICS_WINDOW_MINUTES},
            )
            err_resp = await client.get(
                f"{config.NUVOS_BACKEND_URL}/api/sentinel/client-errors",
                params={"minutes": config.SECURITY_METRICS_WINDOW_MINUTES},
            )
        if sec_resp.status_code != 200:
            return True, "security-metrics endpoint unreachable (not treated as an attack signal)", None

        sec = sec_resp.json()
        counts = sec.get("counts_by_type", {})
        distinct_ips = sec.get("distinct_ips_by_type", {})
        top_ips = sec.get("top_ips", [])
        recent_events = sec.get("recent_events", [])
        reasons = []

        if counts.get("login_failed", 0) > config.LOGIN_FAILED_THRESHOLD:
            reasons.append(f"{counts['login_failed']} failed logins in {config.SECURITY_METRICS_WINDOW_MINUTES}min")
        if distinct_ips.get("rate_limit_exceeded", 0) > config.RATE_LIMIT_DISTINCT_IP_THRESHOLD:
            reasons.append(f"{distinct_ips['rate_limit_exceeded']} distinct IPs rate-limited")

        if err_resp.status_code == 200:
            err = err_resp.json()
            if err.get("count", 0) > config.CLIENT_ERROR_SPIKE_THRESHOLD:
                reasons.append(f"{err['count']} frontend crash reports")

        if not reasons:
            return True, "ok", None

        # Most recent user-agent seen per offending IP — cheap, already in
        # the response, no extra HTTP call.
        device_by_ip: dict[str, str] = {}
        for ev in recent_events:
            ip = ev.get("ip_address")
            if ip and ip not in device_by_ip and ev.get("user_agent"):
                device_by_ip[ip] = ev["user_agent"]

        extra = {"top_ips": top_ips, "device_by_ip": device_by_ip}
        return False, "; ".join(reasons), extra
    except Exception as e:
        return True, f"could not evaluate security metrics: {e} (not treated as an attack signal)", None


async def check_llm_spend() -> tuple[bool, str, dict | None]:
    """Not an up/down check — warns once today's real, tracked LLM spend
    (Anthropic + OpenAI) crosses LLM_SPEND_WARN_PCT of the hard daily cap
    (app/core/config.py's daily_llm_spend_cap_usd). The cap itself already
    stops new calls once crossed (see LLMDailySpendCapExceeded) — this is
    the earlier warning nothing gave you before the Aug 15 incident."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(f"{config.NUVOS_BACKEND_URL}/api/sentinel/llm-spend")
        if resp.status_code != 200:
            return True, "llm-spend endpoint unreachable (not treated as a spend signal)", None
        data = resp.json()
        pct = data.get("pct")
        if pct is not None and pct >= config.LLM_SPEND_WARN_PCT:
            return False, f"LLM spend today: ${data['spend_today_usd']:.2f} / ${data['cap_usd']:.2f} cap ({pct}%)", None
        return True, "ok", None
    except Exception as e:
        return True, f"could not evaluate LLM spend: {e} (not treated as a spend signal)", None


async def check_backup_heartbeat() -> tuple[bool, str, dict | None]:
    """Last successful nightly Supabase backup (.github/workflows/db-backup.yml,
    migration 089) — a missing/stale heartbeat means the backup either
    didn't run or failed, previously visible only as a GitHub Actions red X
    nothing actively watched."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(f"{config.NUVOS_BACKEND_URL}/api/sentinel/backup-heartbeat")
        if resp.status_code != 200:
            return False, f"backup-heartbeat endpoint returned {resp.status_code}", None
        data = resp.json()
        age = data.get("age_seconds")
        if age is None:
            return False, "no successful backup recorded yet", None
        if age > config.BACKUP_STALE_SECONDS:
            hours = age / 3600
            return False, f"last successful backup was {hours:.1f}h ago (expected nightly)", None
        return True, "ok", None
    except Exception as e:
        return False, f"could not reach backup-heartbeat endpoint: {e}", None


async def fetch_ai_status() -> dict:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(f"{config.NUVOS_BACKEND_URL}/api/sentinel/ai-status")
        if resp.status_code != 200:
            return {"enabled": None, "error": f"status {resp.status_code}"}
        return resp.json()
    except Exception as e:
        return {"enabled": None, "error": str(e)}


async def set_ai_toggle(enabled: bool, reason: str | None) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
        resp = await client.post(
            f"{config.NUVOS_BACKEND_URL}/api/sentinel/ai-toggle",
            json={"enabled": enabled, "reason": reason},
        )
        resp.raise_for_status()
        return resp.json()


async def fetch_ip_quota() -> dict:
    """Approximate IPQualityScore usage this month (see the backend's
    /sentinel/ip-intel-quota docstring for the counting caveat) — fetched
    on-demand when the dashboard loads, not on every poll cycle."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(f"{config.NUVOS_BACKEND_URL}/api/sentinel/ip-intel-quota")
        if resp.status_code != 200:
            return {"approx_lookups_this_month": None}
        return resp.json()
    except Exception:
        return {"approx_lookups_this_month": None}


async def fetch_ip_intel(ips: list[str]) -> dict:
    """Lazy enrichment — called by engine.py ONLY when a security_attack
    incident is newly opened, never on every poll."""
    if not ips:
        return {}
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=_HEADERS) as client:
            resp = await client.get(
                f"{config.NUVOS_BACKEND_URL}/api/sentinel/ip-intel",
                params={"ips": ",".join(ips)},
            )
        if resp.status_code != 200:
            return {}
        return resp.json()
    except Exception:
        return {}
