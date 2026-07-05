from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    supabase_url: str = "http://localhost"
    supabase_anon_key: str = "dummy"
    supabase_service_key: str = "dummy"
    secret_key: str = "dev-secret-key-32chars-for-local-only"
    frontend_url: str = "*"
    environment: str = "production"  # set to "development" locally to enable /docs
    claude_model: str = "claude-sonnet-4-6"
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
    stripe_price_family_monthly: str = ""         # $19.99/month
    stripe_price_family_yearly: str = ""          # $199.99/year
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

    class Config:
        env_file = ".env"


settings = Settings()
