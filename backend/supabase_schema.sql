-- IA Investment Advisor - Supabase Schema
-- Run this in your Supabase SQL editor

-- User profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    age INTEGER NOT NULL,
    monthly_income DECIMAL(12, 2) NOT NULL,
    risk_tolerance VARCHAR(20) NOT NULL CHECK (risk_tolerance IN ('conservative', 'moderate', 'aggressive')),
    investment_experience VARCHAR(20) NOT NULL CHECK (investment_experience IN ('beginner', 'intermediate', 'advanced')),
    time_horizon_years INTEGER NOT NULL,
    investment_goals TEXT[] NOT NULL DEFAULT '{}',
    initial_capital DECIMAL(12, 2),
    monthly_savings DECIMAL(12, 2),
    current_investments TEXT,
    financial_concerns TEXT,
    interaction_count INTEGER DEFAULT 0,
    learned_concepts TEXT[] DEFAULT '{}',
    weak_areas TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat history table
CREATE TABLE IF NOT EXISTS chat_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policies: users can only access their own data
CREATE POLICY "Users can manage own profile" ON user_profiles
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own chat history" ON chat_history
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own notifications" ON notifications
    FOR ALL USING (auth.uid() = user_id);

-- Service role bypass (for backend)
CREATE POLICY "Service role full access to profiles" ON user_profiles
    FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access to chat" ON chat_history
    FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access to notifications" ON notifications
    FOR ALL TO service_role USING (true);

-- Indexes
CREATE INDEX idx_chat_history_user_id ON chat_history(user_id, created_at DESC);
CREATE INDEX idx_notifications_user_id ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
