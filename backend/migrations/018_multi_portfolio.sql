-- Multi-portfolio support: up to 3 portfolios per user (premium)
-- Adds portfolio_id + portfolio_name columns, changes PK to composite

ALTER TABLE user_portfolio
  ADD COLUMN IF NOT EXISTS portfolio_id   text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS portfolio_name text NOT NULL DEFAULT 'Mi portafolio';

-- Drop old single-column primary key and replace with composite
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_portfolio_pkey'
  ) THEN
    ALTER TABLE user_portfolio DROP CONSTRAINT user_portfolio_pkey;
  END IF;
END $$;

ALTER TABLE user_portfolio ADD PRIMARY KEY (user_id, portfolio_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_user_id ON user_portfolio (user_id);
