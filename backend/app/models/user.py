from pydantic import BaseModel, EmailStr
from typing import Optional
from enum import Enum


class RiskTolerance(str, Enum):
    conservative = "conservative"
    moderate = "moderate"
    aggressive = "aggressive"


class InvestmentExperience(str, Enum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class InvestmentGoal(str, Enum):
    capital_preservation = "capital_preservation"
    income = "income"
    growth = "growth"
    aggressive_growth = "aggressive_growth"
    retirement = "retirement"


class UserProfileCreate(BaseModel):
    age: int
    monthly_income: float
    risk_tolerance: RiskTolerance
    investment_experience: InvestmentExperience
    time_horizon_years: int
    investment_goals: list[InvestmentGoal]
    initial_capital: Optional[float] = None
    monthly_savings: Optional[float] = None
    current_investments: Optional[str] = None
    financial_concerns: Optional[str] = None


class UserProfileUpdate(BaseModel):
    age: Optional[int] = None
    monthly_income: Optional[float] = None
    risk_tolerance: Optional[RiskTolerance] = None
    investment_experience: Optional[InvestmentExperience] = None
    time_horizon_years: Optional[int] = None
    investment_goals: Optional[list[InvestmentGoal]] = None
    initial_capital: Optional[float] = None
    monthly_savings: Optional[float] = None
    current_investments: Optional[str] = None
    financial_concerns: Optional[str] = None
    interaction_count: Optional[int] = None
    learned_concepts: Optional[list[str]] = None
    weak_areas: Optional[list[str]] = None


class UserProfile(BaseModel):
    id: str
    user_id: str
    age: int
    monthly_income: float
    risk_tolerance: RiskTolerance
    investment_experience: InvestmentExperience
    time_horizon_years: int
    investment_goals: list[InvestmentGoal]
    initial_capital: Optional[float] = None
    monthly_savings: Optional[float] = None
    current_investments: Optional[str] = None
    financial_concerns: Optional[str] = None
    interaction_count: int = 0
    learned_concepts: list[str] = []
    weak_areas: list[str] = []
    created_at: str
    updated_at: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    conversation_history: list[ChatMessage] = []


class AuthRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
