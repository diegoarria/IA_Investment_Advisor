from pydantic import BaseModel, EmailStr
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
    knowledge_level: Optional[str] = None
    terms_accepted_at: Optional[str] = None
    terms_version: Optional[str] = None


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


class UserProfile(BaseModel):
    id: str
    user_id: str
    name: str
    birth_date: str
    monthly_income: str
    monthly_contribution: str
    risk_tolerance: str
    quiz_answers: dict
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
    created_at: str
    updated_at: str


class AvatarUpload(BaseModel):
    image_base64: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatImage(BaseModel):
    data: str
    type: str = "image/jpeg"

class ChatRequest(BaseModel):
    message: str
    conversation_history: list[ChatMessage] = []
    mentor: Optional[str] = None
    # Legacy single-image fields (kept for backward compat)
    image_data: Optional[str] = None
    image_type: Optional[str] = None
    # Multi-image support (1-8 images)
    images: list[ChatImage] = []
    # Notification deep-link context (optional)
    notification_context: Optional[str] = None


class AuthRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    refresh_token: Optional[str] = None
