"""All configuration via env vars only, read once at import time — this
service is deliberately dependency-light (no pydantic-settings, no Supabase
client) so it can run on infra completely separate from the main Nuvos
Railway deployment. See .env.example for every var this reads.
"""
import os

# Where to poll — the main Nuvos backend and public web frontend.
NUVOS_BACKEND_URL = os.environ.get("NUVOS_BACKEND_URL", "https://api.nuvosai.com").rstrip("/")
NUVOS_WEB_URL = os.environ.get("NUVOS_WEB_URL", "https://nuvosai.com").rstrip("/")

# Must match SENTINEL_SHARED_SECRET set in the main backend's Railway env
# (see backend/app/core/sentinel_auth.py) — sent as the X-Sentinel-Key header.
SENTINEL_SHARED_SECRET = os.environ.get("SENTINEL_SHARED_SECRET", "")

# Text expected somewhere in the frontend homepage's HTML — if a fetch of
# NUVOS_WEB_URL returns 200 but doesn't contain this, it's treated as a
# "white screen" (site technically responds, renders nothing useful).
# NOTE: keep this in sync with whatever the actual homepage renders —
# see frontend/web/src/app/page.tsx. A build that changes this text without
# updating this constant will silently stop detecting real white-screens.
FRONTEND_EXPECTED_MARKER = os.environ.get("FRONTEND_EXPECTED_MARKER", "Nuvos")

# Poll cadence and debounce thresholds.
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "120"))
CONSECUTIVE_FAILS_TO_ALERT = int(os.environ.get("CONSECUTIVE_FAILS_TO_ALERT", "3"))
REALERT_INTERVAL_SECONDS = int(os.environ.get("REALERT_INTERVAL_SECONDS", str(30 * 60)))
SECURITY_METRICS_WINDOW_MINUTES = int(os.environ.get("SECURITY_METRICS_WINDOW_MINUTES", "15"))

# Attack heuristic thresholds (see checks.check_security_metrics).
LOGIN_FAILED_THRESHOLD = int(os.environ.get("LOGIN_FAILED_THRESHOLD", "50"))
RATE_LIMIT_DISTINCT_IP_THRESHOLD = int(os.environ.get("RATE_LIMIT_DISTINCT_IP_THRESHOLD", "20"))
CLIENT_ERROR_SPIKE_THRESHOLD = int(os.environ.get("CLIENT_ERROR_SPIKE_THRESHOLD", "15"))

# Alerting — own copies of Twilio/Resend credentials, independent from the
# main backend's, so an alert can go out even if the main backend/Supabase
# is fully down.
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "")
ALERT_PHONE_NUMBER = os.environ.get("ALERT_PHONE_NUMBER", "")  # E.164, e.g. +1234567890

# "twilio" (SMS) or "kapso" (WhatsApp, via Meta's Cloud API format — see
# alerts.py's send_whatsapp_kapso docstring for the required template setup).
ALERT_WHATSAPP_PROVIDER = os.environ.get("ALERT_WHATSAPP_PROVIDER", "twilio")
KAPSO_API_KEY = os.environ.get("KAPSO_API_KEY", "")
KAPSO_PHONE_NUMBER_ID = os.environ.get("KAPSO_PHONE_NUMBER_ID", "")
KAPSO_TEMPLATE_NAME = os.environ.get("KAPSO_TEMPLATE_NAME", "nuvos_alert")
KAPSO_TEMPLATE_LANG = os.environ.get("KAPSO_TEMPLATE_LANG", "es_MX")
ALERT_WHATSAPP_NUMBER = os.environ.get("ALERT_WHATSAPP_NUMBER", "")  # E.164, e.g. +5215500000000

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
ALERT_EMAIL = os.environ.get("ALERT_EMAIL", "")

# Dashboard auth — its own password, not tied to Supabase, so it still works
# if the main app's auth system is the thing that's down.
SENTINEL_DASHBOARD_USER = os.environ.get("SENTINEL_DASHBOARD_USER", "admin")
SENTINEL_DASHBOARD_PASSWORD = os.environ.get("SENTINEL_DASHBOARD_PASSWORD", "")

DB_PATH = os.environ.get("SENTINEL_DB_PATH", "sentinel.db")

# Closed incidents (and their flagged_ips) older than this get pruned once a
# day — an open/ongoing incident is never deleted regardless of age.
RETENTION_DAYS = int(os.environ.get("SENTINEL_RETENTION_DAYS", "90"))

# IPQualityScore's free tier as of this writing — the dashboard warns once
# this month's approximate usage crosses 80% of it.
IPQUALITYSCORE_FREE_TIER_LIMIT = int(os.environ.get("IPQUALITYSCORE_FREE_TIER_LIMIT", "5000"))

# % of the daily LLM spend cap (backend's daily_llm_spend_cap_usd) that
# triggers a warning — before the hard circuit breaker itself trips.
LLM_SPEND_WARN_PCT = int(os.environ.get("LLM_SPEND_WARN_PCT", "80"))

# The nightly backup runs once/day — this is how stale its last-success
# heartbeat can get before being treated as a failure. Default 30h: enough
# slack for the exact run time to drift a bit without false-positiving,
# tight enough to catch a genuinely missed night within one poll cycle of
# the next day starting.
BACKUP_STALE_SECONDS = int(os.environ.get("BACKUP_STALE_SECONDS", str(30 * 3600)))
