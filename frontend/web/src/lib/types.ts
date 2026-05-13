export type RiskTolerance = "conservative" | "moderate" | "aggressive";
export type InvestmentExperience = "beginner" | "intermediate" | "advanced";
export type InvestmentGoal =
  | "capital_preservation"
  | "income"
  | "growth"
  | "aggressive_growth"
  | "retirement";

export interface UserProfile {
  id: string;
  user_id: string;
  age: number;
  monthly_income: number;
  risk_tolerance: RiskTolerance;
  investment_experience: InvestmentExperience;
  time_horizon_years: number;
  investment_goals: InvestmentGoal[];
  initial_capital?: number;
  monthly_savings?: number;
  current_investments?: string;
  financial_concerns?: string;
  interaction_count: number;
  learned_concepts: string[];
  weak_areas: string[];
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

export interface MarketSummary {
  [index: string]: {
    value: number;
    change_pct: number;
    direction: "up" | "down";
  };
}

export interface AssetData {
  symbol: string;
  name: string;
  sector?: string;
  current_price?: number;
  market_cap?: number;
  pe_ratio?: number;
  ytd_return_pct?: number;
  annual_volatility_pct?: number;
  beta?: number;
  description?: string;
  error?: string;
}
