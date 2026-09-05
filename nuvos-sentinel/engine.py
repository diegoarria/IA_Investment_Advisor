"""The debounce/state-machine loop: runs each check on a timer, decides
when a blip becomes a real incident, and when to (re-)alert without
spamming. See config.py for every tunable threshold."""
import asyncio
import logging
import time

import config
import state
import alerts
from checks import (
    check_health, check_frontend, check_worker_heartbeat, check_security_metrics,
    check_llm_spend, check_backup_heartbeat, fetch_ip_intel,
)

logger = logging.getLogger("nuvos-sentinel")

CHECKS = {
    "backend_health": ("Nuvos backend", check_health),
    "frontend": ("Nuvos web frontend", check_frontend),
    "worker_heartbeat": ("Nuvos worker process", check_worker_heartbeat),
    "security_attack": ("Possible attack in progress", check_security_metrics),
    "llm_spend": ("Gasto de LLM acercándose al tope diario", check_llm_spend),
    "backup_heartbeat": ("Backup nocturno de la base de datos", check_backup_heartbeat),
}


def _describe_intel(ip: str, count: int, device: str | None, intel: dict) -> str:
    if intel.get("error"):
        return f"{ip} x{count}"
    flags = []
    if intel.get("is_vpn"):
        flags.append("VPN")
    if intel.get("is_tor"):
        flags.append("TOR")
    if intel.get("is_proxy"):
        flags.append("proxy")
    if intel.get("connection_type") == "Data Center":
        flags.append("datacenter")
    place = ", ".join(p for p in (intel.get("city"), intel.get("region"), intel.get("country")) if p)
    parts = [f"{ip} x{count}"]
    if place:
        parts.append(place)
    if intel.get("isp"):
        parts.append(intel["isp"])
    if flags:
        parts.append("/".join(flags))
    if intel.get("fraud_score") is not None:
        parts.append(f"fraud={intel['fraud_score']}")
    return " — ".join(parts)


async def _enrich_and_flag(incident_id: int, extra: dict) -> str:
    """Called ONLY when a security_attack incident is newly opened — fetches
    geolocation/VPN/fraud data for the offending IPs (lazy, cached on the
    backend side) and stores it for the dashboard's suspicious-IPs table.
    Returns a human-readable summary to fold into the alert itself."""
    top_ips = extra.get("top_ips", [])
    device_by_ip = extra.get("device_by_ip", {})
    ips = [row["ip"] for row in top_ips]
    intel_by_ip = await fetch_ip_intel(ips)

    lines = []
    for row in top_ips:
        ip, count = row["ip"], row["count"]
        intel = intel_by_ip.get(ip, {})
        device = device_by_ip.get(ip)
        state.save_flagged_ip(incident_id, ip, count, device, intel)
        lines.append(_describe_intel(ip, count, device, intel))
    return "; ".join(lines)


async def _run_one(kind: str, label: str, check_fn) -> None:
    ok, detail, extra = await check_fn()
    st = state.get_state(kind)

    if ok:
        consecutive_ok = st["consecutive_ok"] + 1
        was_down = bool(st["is_down"])
        state.save_state(kind, consecutive_fails=0, consecutive_ok=consecutive_ok, is_down=0, last_detail=detail)
        if was_down:
            state.close_incident(kind)
            logger.info("%s: RECOVERED (%s)", kind, detail)
            await alerts.send_alert(
                f"✅ Nuvos — {label} recuperado",
                f"{label} volvió a estar operativo. Detalle: {detail}",
            )
        return

    consecutive_fails = st["consecutive_fails"] + 1
    state.save_state(kind, consecutive_fails=consecutive_fails, consecutive_ok=0, last_detail=detail)

    if consecutive_fails < config.CONSECUTIVE_FAILS_TO_ALERT:
        logger.warning("%s: fail %d/%d (%s)", kind, consecutive_fails, config.CONSECUTIVE_FAILS_TO_ALERT, detail)
        return

    now = time.time()
    already_down = bool(st["is_down"])
    last_alert_at = st["last_alert_at"] or 0

    if not already_down:
        state.save_state(kind, is_down=1, last_alert_at=now)
        incident_id = state.open_incident(kind, detail)

        alert_detail = detail
        if extra and extra.get("top_ips"):
            try:
                ip_summary = await _enrich_and_flag(incident_id, extra)
                if ip_summary:
                    alert_detail = f"{detail}\nIPs: {ip_summary}"
            except Exception:
                logger.exception("%s: IP enrichment failed, alerting without it", kind)

        logger.error("%s: DOWN — alerting (%s)", kind, alert_detail)
        await alerts.send_alert(f"🚨 Nuvos — {label}", alert_detail)
    elif now - last_alert_at > config.REALERT_INTERVAL_SECONDS:
        state.save_state(kind, last_alert_at=now)
        logger.error("%s: still down — re-alerting (%s)", kind, detail)
        await alerts.send_alert(f"🚨 Nuvos — {label} (sigue caído)", detail)


async def run_cycle() -> None:
    for kind, (label, check_fn) in CHECKS.items():
        try:
            await _run_one(kind, label, check_fn)
        except Exception:
            logger.exception("check %s raised unexpectedly", kind)


_CLEANUP_INTERVAL_SECONDS = 24 * 3600
_last_cleanup_at = 0.0


def _maybe_cleanup() -> None:
    global _last_cleanup_at
    now = time.time()
    if now - _last_cleanup_at < _CLEANUP_INTERVAL_SECONDS:
        return
    _last_cleanup_at = now
    try:
        result = state.cleanup_old(days=config.RETENTION_DAYS)
        if result["incidents_deleted"] or result["flagged_ips_deleted"]:
            logger.info("cleanup: pruned %s", result)
    except Exception:
        logger.exception("cleanup_old failed")


async def poll_forever() -> None:
    state.init_db()
    logger.info("Nuvos Sentinel started — polling every %ds", config.POLL_INTERVAL_SECONDS)
    while True:
        await run_cycle()
        _maybe_cleanup()
        await asyncio.sleep(config.POLL_INTERVAL_SECONDS)
