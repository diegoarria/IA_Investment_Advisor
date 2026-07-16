from pydantic import BaseModel
from typing import Optional


class NotificationPreferences(BaseModel):
    market_moves: bool = True
    earnings_events: bool = True
    personalized_insights: bool = True
    learning_progress: bool = True
    threshold_percent: float = 3.0
