from pydantic import BaseModel, EmailStr
from typing import Optional


class UserProfileCreate(BaseModel):
    name: str
    birth_date: str
    monthly_income: str
    monthly_contribution: str
    risk_tolerance: str
    quiz_answers: dict
    mentor: Optional[str] = None


class UserProfileUpdate(BaseModel):
    name: Optional[str] = None
    birth_date: Optional[str] = None
    monthly_income: Optional[str] = None
    monthly_contribution: Optional[str] = None
    risk_tolerance: Optional[str] = None
    quiz_answers: Optional[dict] = None
    mentor: Optional[str] = None


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
    created_at: str
    updated_at: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    conversation_history: list[ChatMessage] = []
    mentor: Optional[str] = None


class AuthRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    refresh_token: Optional[str] = None
