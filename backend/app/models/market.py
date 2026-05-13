from pydantic import BaseModel
from typing import Optional


class AssetAnalysisRequest(BaseModel):
    symbols: list[str]
    analysis_depth: str = "standard"  # standard | deep


class PortfolioScenarioRequest(BaseModel):
    scenario: str  # aggressive | moderate | conservative
    capital: Optional[float] = None
    focus_sectors: Optional[list[str]] = None


class NotificationPreferences(BaseModel):
    market_moves: bool = True
    earnings_events: bool = True
    personalized_insights: bool = True
    learning_progress: bool = True
    threshold_percent: float = 3.0
