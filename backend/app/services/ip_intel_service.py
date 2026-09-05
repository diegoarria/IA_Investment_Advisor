"""IP geolocation + VPN/proxy/TOR + fraud score, via IPQualityScore
(https://ipqualityscore.com/documentation/proxy-detection-api/overview) —
field names confirmed against their docs: zip_code, region, city, ISP,
organization, ASN, connection_type, fraud_score, vpn, tor, proxy,
recent_abuse, country_code, success.

Deliberately LAZY: this is never called on every security_events write (that
would burn the free-tier quota exactly when an attack is generating the most
events). It's called only for IPs already involved in a flagged incident —
see app/api/routes/sentinel.py's /sentinel/ip-intel endpoint, which the
standalone Nuvos Sentinel monitor hits only when one of its attack
heuristics has already tripped. Results are cached in ip_intel_cache
(migration 088) so the same IP is never billed against the quota twice
within CACHE_TTL_HOURS.
"""
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import settings
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

CACHE_TTL_HOURS = 24


def _row_from_response(ip: str, data: dict) -> dict:
    return {
        "ip_address": ip,
        "country": data.get("country_code"),
        "region": data.get("region"),
        "city": data.get("city"),
        "postal_code": data.get("zip_code"),
        "isp": data.get("ISP"),
        "organization": data.get("organization"),
        "asn": str(data.get("ASN")) if data.get("ASN") is not None else None,
        "connection_type": data.get("connection_type"),
        "is_vpn": bool(data.get("vpn")),
        "is_tor": bool(data.get("tor")),
        "is_proxy": bool(data.get("proxy")),
        "fraud_score": data.get("fraud_score"),
        "raw": data,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


async def _fetch_cached(ip: str) -> dict | None:
    db = get_supabase()
    result = await run_query(db.table("ip_intel_cache").select("*").eq("ip_address", ip).limit(1))
    rows = result.data or []
    if not rows:
        return None
    row = rows[0]
    # Supabase/Postgres timestamps sometimes come back with a trailing 'Z'
    # instead of '+00:00' — fromisoformat() rejects 'Z' on Python <3.11.
    fetched_at = datetime.fromisoformat(row["fetched_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) - fetched_at > timedelta(hours=CACHE_TTL_HOURS):
        return None
    return row


async def get_ip_intel(ip: str) -> dict:
    """Best-effort — never raises. Returns a dict always (possibly with an
    "error" key) so callers can render "unknown" instead of crashing."""
    if not ip:
        return {"ip_address": ip, "error": "no ip provided"}

    try:
        cached = await _fetch_cached(ip)
        if cached:
            return cached
    except Exception as e:
        logger.warning("ip_intel_service: cache read failed for %s: %s", ip, e)

    if not settings.ipqualityscore_api_key:
        return {"ip_address": ip, "error": "IPQUALITYSCORE_API_KEY not configured"}

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"https://ipqualityscore.com/api/json/ip/{settings.ipqualityscore_api_key}/{ip}"
            )
        data = resp.json()
        if not data.get("success"):
            return {"ip_address": ip, "error": data.get("message", "lookup failed")}

        row = _row_from_response(ip, data)
        db = get_supabase()
        await run_query(db.table("ip_intel_cache").upsert(row))
        return row
    except Exception as e:
        logger.warning("ip_intel_service: lookup failed for %s: %s", ip, e)
        return {"ip_address": ip, "error": str(e)}


async def get_ip_intel_batch(ips: list[str], max_ips: int = 20) -> dict[str, dict]:
    """Sequential, not parallel — IPQualityScore's free tier is rate-limited
    per-second; a burst of concurrent calls right when an attack is flagged
    is exactly the wrong moment to risk a 429 from the provider itself."""
    out: dict[str, dict] = {}
    for ip in list(dict.fromkeys(ips))[:max_ips]:  # de-dupe, preserve order
        out[ip] = await get_ip_intel(ip)
    return out
