from pydantic import model_validator
from pydantic_settings import BaseSettings

_DEV_SECRET_KEY = "dev-secret-key-32chars-for-local-only"
_DEV_SUPABASE_URL = "http://localhost"
_DEV_SUPABASE_SERVICE_KEY = "dummy"


class Settings(BaseSettings):
    anthropic_api_key: str
    supabase_url: str = "http://localhost"
    supabase_anon_key: str = "dummy"
    supabase_service_key: str = "dummy"
    # Direct Postgres connection string (Supabase dashboard → Settings →
    # Database → Connection string). NOT used by the running app (which only
    # ever talks to Supabase via its REST client) — only by
    # scripts/backup_db.sh for the independent nightly pg_dump backup layer.
    # See docs/DISASTER_RECOVERY.md.
    database_url: str = ""
    secret_key: str = "dev-secret-key-32chars-for-local-only"
    frontend_url: str = "*"
    environment: str = "production"  # set to "development" locally to enable /docs
    claude_model: str = "claude-sonnet-4-6"
    # Real-money incident, Aug 15 — a hard circuit breaker on top of every
    # other cost fix from that day: once TODAY's real, logged Claude spend
    # (across the whole platform, all users, all cron jobs) crosses this
    # many dollars, _claude() in ai_service.py stops making new calls until
    # midnight ET, regardless of cause. This is deliberately generous
    # relative to the ~$0.50-2/day normal baseline — it exists to make a
    # repeat of the Aug 15 $10.51 spike structurally impossible, not to
    # throttle normal operation. Override via DAILY_LLM_SPEND_CAP_USD.
    daily_llm_spend_cap_usd: float = 5.0
    # ── Unit economics / Cost Guard (Sep 2026 COGS work) ─────────────────
    # ONE place for every number that decides how much a Premium user may
    # cost. Thresholds are FRACTIONS of the subscription price, derived from
    # the margin target (60-70% gross margin => variable COGS <= 30-40% of
    # revenue => $4.50-$6.00 on $14.99), so re-pricing Premium re-scales
    # every threshold automatically. Override any via env var.
    premium_price_usd: float = 14.99
    payment_fee_pct: float = 0.029        # Stripe standard — NOT verified against the live account
    payment_fee_fixed_usd: float = 0.30
    target_cogs_pct_max: float = 0.40     # upper edge of the 60-70% gross-margin target
    # Premium per-user LLM spend, month-to-date, as a fraction of price:
    guard_warning_pct: float = 0.20       # $3.00 — logged only
    guard_high_usage_pct: float = 0.40    # $6.00 — logged + flagged in admin (== target ceiling)
    guard_protection_pct: float = 0.60    # $9.00 — Arthur silently routes to the cheaper model
    guard_hard_stop_pct: float = 0.90     # $13.49 — friendly "renews on the 1st" message
    # Per-day Premium ceiling, as a fraction of price — stops a single-day
    # blowup that a monthly budget would only notice after the fact.
    guard_daily_cap_pct: float = 0.20     # $3.00/day
    guard_enabled: bool = True
    free_msg_limit: int = 15
    premium_msg_limit: int = 80
    msg_window_hours: int = 24
    free_daily_cost_cap_usd: float = 0.20
    # Model Arthur falls back to under COST_PROTECTION (never used otherwise).
    cost_protection_model: str = "claude-haiku-4-5-20251001"
    # Stage 4: what happens after confirm_pending_financial_action already
    # applied (or failed to apply) a BUY/SELL. The backend knows the outcome
    # exactly, so the follow-up narration LLM call is redundant.
    #   "off"    — legacy: the LLM narrates (no comparison)
    #   "shadow" — legacy reply is what the user sees; a deterministic reply is
    #              built alongside and any discrepancy is logged (NO savings yet)
    #   "on"     — the deterministic reply is sent and the narration call is skipped
    portfolio_confirm_render_mode: str = "shadow"
    # OpenAI — routes standalone, non-personalized educational Q&A (see
    # app.services.generic_qa_cache) away from Claude. Optional: if unset,
    # that traffic just falls back to the existing Haiku path.
    openai_api_key: str = ""
    openai_generic_model: str = "gpt-5.4-mini"  # gpt-5-mini was retired; this is the current mini-tier model
    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id_monthly: str = ""
    stripe_price_id_yearly: str = ""
    # MXN counterparts (Stripe Price IDs created in MXN) used for users in
    # Mexico — many Mexican cards, especially debit, reject USD charges
    # ("Your card doesn't support this currency"). Every one is OPTIONAL: if
    # blank, that product silently falls back to its USD price (see
    # app/core/pricing_region.py), so setting them can never break checkout.
    stripe_price_id_monthly_mxn: str = ""
    stripe_price_id_yearly_mxn: str = ""
    stripe_price_family_monthly_mxn: str = ""
    stripe_price_family_yearly_mxn: str = ""
    stripe_price_session_free_mxn: str = ""
    stripe_price_session_premium_mxn: str = ""
    stripe_price_session_bundle_mxn: str = ""
    # Stripe Adaptive Pricing (Checkout Sessions, ui_mode="elements"). OFF by
    # default: with it on, Premium individual is charged through a Checkout
    # Session whose price is the MXN one (this Stripe account settles ONLY in
    # MXN, and Adaptive Pricing requires prices in a settlement currency);
    # Stripe then presents the customer's local currency at checkout.
    # Env: CHECKOUT_ADAPTIVE_PRICING=true. Any failure falls back to the
    # existing embedded Payment Element flow on the client.
    checkout_adaptive_pricing: bool = False
    # ui_mode="elements" needs a newer API version than the pinned SDK default
    # (2024-12-18.acacia); it's sent per request, so nothing else is affected.
    stripe_checkout_api_version: str = "2026-08-26.dahlia"
    # Approximate MXN per USD used ONLY to express MXN subscriptions in USD in
    # the admin MRR figure (real charges are settled by Stripe at its own rate).
    reporting_mxn_per_usd: float = 17.3
    # Upsell one-time prices (create in Stripe dashboard as one-time products)
    stripe_price_session_free: str = ""           # $149
    stripe_price_session_premium: str = ""        # $99
    stripe_price_session_bundle: str = ""         # $247 (3 sessions, premium only)
    stripe_price_family_monthly: str = ""         # $23.99/month
    stripe_price_family_yearly: str = ""          # $224.99/year
    stripe_price_broker_call: str = ""            # $20 flat — 1:1 broker onboarding call, after the 24h free window
    stripe_price_broker_call_mxn: str = ""        # same call, MXN price (falls back to USD when unset)
    # PostHog — read-only Personal API Key for the admin business-overview
    # dashboard (DAU/WAU/top events). Distinct from the mobile/web client's
    # project token (POSTHOG_PROJECT_TOKEN), which only ever WRITES events —
    # querying them back requires this separate personal key + project id.
    posthog_personal_api_key: str = ""
    posthog_project_id: str = ""
    posthog_host: str = "https://us.i.posthog.com"
    resend_api_key: str = ""
    perplexity_api_key: str = ""  # Perplexity sonar — real-time web search
    redis_url: str = ""  # e.g. redis://localhost:6379 — optional, falls back to in-memory
    elevenlabs_api_key: str = ""   # for TTS
    elevenlabs_voice_id: str = "pNInz6obpgDQGcFmaJgB"  # Adam — multilingual, good Spanish
    fiscal_ai_api_key: str = ""    # fiscal.ai — same data as stockanalysis.com
    fmp_api_key: str = ""          # Financial Modeling Prep — read directly via os.getenv in
                                   # financial_data_service.py; declared here only so pydantic-settings
                                   # (extra="forbid" by default) doesn't reject the env var at boot
    finnhub_api_key: str = ""      # Read directly via os.getenv everywhere it's used (app/core/finnhub.py,
                                   # market_data_service.py, several routes) — same reason as fmp_api_key
                                   # above: this was missing entirely, so any .env with a real (non-empty)
                                   # FINNHUB_API_KEY failed Settings() at boot. Found while running the
                                   # Fase 1.5 validation harness with a real key for the first time.
    # Plaid (brokerage integrations: IBKR, Schwab, Robinhood)
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"     # sandbox | production
    # Belvo (LatAm open banking: bank accounts + brokerage, starting with
    # Mexico — GBM, Actinver) — see backend/app/api/routes/belvo.py.
    # Sandbox and production are FULLY SEPARATE Belvo accounts with their
    # own secret_id/secret_password pairs, unlike Plaid's single key + env
    # flag above — using a sandbox secret_id against the production API
    # host 401s rather than giving a helpful error, so keep this pair in
    # sync with belvo_env when switching.
    belvo_secret_id: str = ""
    belvo_secret_password: str = ""
    belvo_env: str = "sandbox"     # sandbox | production
    belvo_webhook_secret: str = ""
    # Web Push (VAPID)
    vapid_private_key: str = ""   # base64url-encoded private key
    vapid_public_key: str = ""    # base64url-encoded public key (sent to browser)
    vapid_claim_email: str = "mailto:diego.arria19@gmail.com"
    # Comma-separated emails allowed to use the read-only admin "view as" panel
    admin_emails: str = "diego.arria19@gmail.com"

    class Config:
        env_file = ".env"

    @model_validator(mode="after")
    def _fail_fast_on_dev_defaults_in_production(self) -> "Settings":
        """Previously, a misconfigured production deploy (e.g. a typo'd env
        var name on Railway) would boot successfully against
        supabase_url="http://localhost" or a placeholder service key —
        silently trying to talk to nothing and failing every single request
        with a confusing low-level connection error, instead of a clear
        startup failure. Fail fast instead: refuse to boot in production with
        a known dev/placeholder value in any of the three settings that
        gate every single request (DB connection + JWT signing)."""
        if self.environment != "production":
            return self
        problems = []
        if self.supabase_url == _DEV_SUPABASE_URL:
            problems.append("SUPABASE_URL is unset (defaulting to http://localhost)")
        if self.supabase_service_key == _DEV_SUPABASE_SERVICE_KEY:
            problems.append("SUPABASE_SERVICE_KEY is unset (defaulting to a placeholder)")
        # Diego, 2026-09-08: a same-day audit pass added a check here for
        # supabase_anon_key (it shares the same "dummy" default as
        # supabase_service_key) — REVERTED the same day after it took
        # production down: `grep -rn supabase_anon_key app/` (excluding this
        # file) returns zero hits — the field is never actually read
        # anywhere in the app, and it was never set in Railway's real env,
        # so this "fixed" a gap that had zero real effect while breaking a
        # deploy that had been fine forever. Left unchecked on purpose now.
        if self.secret_key == _DEV_SECRET_KEY:
            problems.append("SECRET_KEY is unset (defaulting to a publicly-known dev value)")
        if problems:
            raise ValueError(
                "Refusing to start in production with dev/placeholder config: "
                + "; ".join(problems)
                + ". Set these environment variables, or set ENVIRONMENT=development if this is intentional."
            )
        return self


settings = Settings()
