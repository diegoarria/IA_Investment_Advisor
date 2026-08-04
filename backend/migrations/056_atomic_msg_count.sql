-- Chat's msg_count limit was enforced with a plain read-then-write from
-- Python (select msg_count, compare to limit, update msg_count + 1) — two
-- concurrent requests (double-submit, flaky-network retry) can both read the
-- same count, both pass the limit check, and both write the same N+1,
-- silently losing an increment. Repeated concurrent bursts let a user
-- exceed their daily message limit indefinitely, with no cap on the
-- resulting Anthropic API spend. This function does the read, window-reset,
-- limit-check and increment as a single atomic statement under a row lock,
-- so concurrent callers serialize instead of racing.
CREATE OR REPLACE FUNCTION increment_msg_count_if_allowed(
  p_user_id UUID,
  p_limit INT,
  p_window_hours INT
)
RETURNS TABLE(allowed BOOLEAN, new_count INT, window_start TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INT;
BEGIN
  SELECT msg_window_start, msg_count INTO v_window_start, v_count
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_window_start IS NULL OR NOW() - v_window_start >= make_interval(hours => p_window_hours) THEN
    UPDATE user_profiles
    SET msg_count = 1, msg_window_start = NOW()
    WHERE user_id = p_user_id
    RETURNING user_profiles.msg_window_start INTO v_window_start;

    RETURN QUERY SELECT TRUE, 1, v_window_start;
    RETURN;
  END IF;

  IF v_count >= p_limit THEN
    RETURN QUERY SELECT FALSE, v_count, v_window_start;
    RETURN;
  END IF;

  UPDATE user_profiles
  SET msg_count = msg_count + 1
  WHERE user_id = p_user_id
  RETURNING user_profiles.msg_count INTO v_count;

  RETURN QUERY SELECT TRUE, v_count, v_window_start;
END;
$$;
