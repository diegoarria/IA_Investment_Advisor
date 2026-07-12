export type RiskTolerance =
  | "conservative"
  | "conservative_moderate"
  | "moderate"
  | "moderate_growth"
  | "growth"
  | "aggressive"
  | "aggressive_speculative"
  | "speculative";

export interface UserProfile {
  id: string;
  user_id: string;
  name: string;
  birth_date: string;
  monthly_income: string;
  monthly_contribution: string;
  risk_tolerance: string;
  quiz_answers: Record<string, unknown>;
  mentor?: string | null;
  avatar_url?: string | null;
  investment_experience?: string | null;
  investment_amount?: string | null;
  investment_goal?: string | null;
  investment_goal_amount?: string | null;
  investment_horizon?: string | null;
  knowledge_level?: string | null;
  country?: string | null;
  initial_capital?: string | null;
  has_broker?: boolean | null;
  broker_name?: string | null;
  has_investments?: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  images?: Array<{ preview: string }>;
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

export interface IndexData {
  name: string;
  symbol: string;
  price: number | null;
  change: number;
  change_pct: number;
}

export interface IndexNewsItem {
  uuid: string;
  title: string;
  publisher: string;
  url: string;
  timestamp: number;
  symbol: string;
  thumbnail: string | null;
}
