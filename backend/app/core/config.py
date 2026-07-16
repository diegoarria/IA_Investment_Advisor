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
    # Upsell one-time prices (create in Stripe dashboard as one-time products)
    stripe_price_annual_report_free: str = ""     # $34.99
    stripe_price_annual_report_premium: str = ""  # $19.99
    stripe_price_session_free: str = ""           # $149
    stripe_price_session_premium: str = ""        # $99
    stripe_price_session_bundle: str = ""         # $247 (3 sessions, premium only)
    stripe_price_family_monthly: str = ""         # $23.99/month
    stripe_price_family_yearly: str = ""          # $224.99/year
    stripe_price_deep_research_free: str = ""     # $19.99
    stripe_price_deep_research_premium: str = ""  # $9.99
    resend_api_key: str = ""
    perplexity_api_key: str = ""  # Perplexity sonar — real-time web search
    redis_url: str = ""  # e.g. redis://localhost:6379 — optional, falls back to in-memory
    elevenlabs_api_key: str = ""   # for TTS
    elevenlabs_voice_id: str = "pNInz6obpgDQGcFmaJgB"  # Adam — multilingual, good Spanish
    fiscal_ai_api_key: str = ""    # fiscal.ai — same data as stockanalysis.com
    # Plaid (brokerage integrations: IBKR, Schwab, Robinhood)
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"     # sandbox | production
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
