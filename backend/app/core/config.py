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
    resend_api_key: str = ""
    redis_url: str = ""  # e.g. redis://localhost:6379 — optional, falls back to in-memory
    elevenlabs_api_key: str = ""   # for TTS
    elevenlabs_voice_id: str = "pNInz6obpgDQGcFmaJgB"  # Adam — multilingual, good Spanish
    fiscal_ai_api_key: str = ""    # fiscal.ai — same data as stockanalysis.com
    # Plaid (brokerage integrations: IBKR, Schwab, Robinhood)
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"     # sandbox | production

    class Config:
        env_file = ".env"


settings = Settings()
