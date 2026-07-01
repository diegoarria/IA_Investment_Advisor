ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS portfolio_view_mode VARCHAR(20) DEFAULT 'basic';
