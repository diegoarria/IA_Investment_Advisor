from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional


class UserProfileCreate(BaseModel):
    name: str
    risk_tolerance: str
    quiz_answers: dict
    birth_date: Optional[str] = None
    monthly_income: Optional[str] = None
    monthly_contribution: Optional[str] = None
    mentor: Optional[str] = None
    investment_amount: Optional[str] = None
    investment_goal: Optional[str] = None
    investment_goal_amount: Optional[str] = None
    investment_horizon: Optional[str] = None
    knowledge_level: Optional[str] = None
    terms_accepted_at: Optional[str] = None
    terms_version: Optional[str] = None
    country: Optional[str] = None
    initial_capital: Optional[str] = None
    has_broker: Optional[bool] = None
    broker_name: Optional[str] = None
    has_investments: Optional[bool] = None
    language: Optional[str] = None  # UI language at signup ("es"/"en") — welcome email + preferred_language


class UserProfileUpdate(BaseModel):
    name: Optional[str] = None
    birth_date: Optional[str] = None
    monthly_income: Optional[str] = None
    monthly_contribution: Optional[str] = None
    risk_tolerance: Optional[str] = None
    quiz_answers: Optional[dict] = None
    mentor: Optional[str] = None
    avatar_url: Optional[str] = None
    nav_order: Optional[list] = None
    theme: Optional[str] = None
    investment_goal: Optional[str] = None
    investment_goal_amount: Optional[str] = None
    investment_horizon: Optional[str] = None
    knowledge_level: Optional[str] = None
    country: Optional[str] = None
    initial_capital: Optional[str] = None
    has_broker: Optional[bool] = None
    broker_name: Optional[str] = None
    has_investments: Optional[bool] = None


class UserProfile(BaseModel):
    id: str
    user_id: str
    name: str
    birth_date: Optional[str] = None
    monthly_income: Optional[str] = None
    monthly_contribution: Optional[str] = None
    risk_tolerance: str
    quiz_answers: Optional[dict] = None
    mentor: Optional[str] = None
    avatar_url: Optional[str] = None
    subscription_tier: str = "free"
    stripe_customer_id: Optional[str] = None
    msg_count: int = 0
    msg_window_start: Optional[str] = None
    nav_order: Optional[list] = None
    theme: Optional[str] = None
    investment_goal: Optional[str] = None
    investment_goal_amount: Optional[str] = None
    investment_horizon: Optional[str] = None
    knowledge_level: Optional[str] = None
    terms_accepted_at: Optional[str] = None
    terms_version: Optional[str] = None
    country: Optional[str] = None
    initial_capital: Optional[str] = None
    has_broker: Optional[bool] = None
    broker_name: Optional[str] = None
    has_investments: Optional[bool] = None
    net_worth_usd: Optional[float] = None
    monthly_expenses_usd: Optional[float] = None
    currency: Optional[str] = None
    preferred_language: Optional[str] = None
    investing_style: Optional[str] = None
    time_horizon_years: Optional[int] = None
    financial_freedom_target_usd: Optional[float] = None
    trial_started_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# Base64 inflates size ~4/3, so this caps the actual decoded image at ~5MB —
# matches Anthropic's own hard limit for images sent to Claude (larger ones
# fail the API call outright instead of getting a clean upfront rejection),
# and Claude downsamples anything past ~1568px on the long edge internally
# anyway, so accepting more never improves what the model actually sees.
_MAX_IMAGE_B64_CHARS = 6_700_000


class AvatarUpload(BaseModel):
    image_base64: str

    @field_validator("image_base64")
    @classmethod
    def _limit_avatar_upload_size(cls, v: str) -> str:
        # Same limit as ChatImage below — this had NO limit at all before,
        # and unlike chat images (seen once), an avatar gets re-served by
        # Supabase Storage to every viewer of every comment/profile this user
        # appears on, so an uncompressed multi-MB phone photo here is a much
        # bigger repeated-egress cost than the same size limit is for chat.
        if len(v) > _MAX_IMAGE_B64_CHARS:
            raise ValueError(f"Image too large (max ~5MB, got base64 length {len(v)})")
        return v


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatImage(BaseModel):
    data: str
    type: str = "image/jpeg"

    @field_validator("data")
    @classmethod
    def _limit_image_size(cls, v: str) -> str:
        if len(v) > _MAX_IMAGE_B64_CHARS:
            raise ValueError(f"Image too large (max ~5MB, got base64 length {len(v)})")
        return v

class ChatRequest(BaseModel):
    message: str
    conversation_history: list[ChatMessage] = []
    mentor: Optional[str] = None
    # Legacy single-image fields (kept for backward compat)
    image_data: Optional[str] = None
    image_type: Optional[str] = None
    # Multi-image support (1-8 images)
    images: list[ChatImage] = []

    @field_validator("image_data")
    @classmethod
    def _limit_legacy_image_size(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > _MAX_IMAGE_B64_CHARS:
            raise ValueError(f"Image too large (max ~5MB, got base64 length {len(v)})")
        return v
    # Notification deep-link context (optional)
    notification_context: Optional[str] = None


class AuthRequest(BaseModel):
    email: EmailStr
    password: str
    language: Optional[str] = None  # UI language at signup ("es"/"en") — which welcome email copy to send


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    refresh_token: Optional[str] = None
