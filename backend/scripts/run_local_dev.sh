#!/usr/bin/env bash
# Nuvos — local dev server launcher, Supabase Local environment.
#
# Why this exists (found auditing Fase 4B's 81.7% sector-coverage gap,
# 2026-11): this repo's own env-file loading (app/core/config.py's
# pydantic Settings, `ENV_FILE=.env.development`) populates the Settings
# OBJECT only — it never calls python-dotenv's load_dotenv(), so it never
# writes into os.environ. Most of this codebase reads config via
# `settings.x` (robust to that), but app/core/finnhub.py's API key lookup
# calls `os.getenv("FINNHUB_API_KEY")` directly — so running uvicorn with
# just `ENV_FILE=.env.development` set (no separate export) leaves
# Finnhub silently keyless: every fh_profile()/fh_search() call returns
# None/[] with no error, which is exactly what made ASML (not in the
# S&P 500 UNIVERSE table, so it needs the Finnhub fallback) classify as
# "no sector data" — not a bug in the sector/taxonomy logic itself.
#
# This script exports the chosen env file into the actual process
# environment first, so every `os.getenv(...)` call in the app (not just
# `settings.x` ones) sees the same values — without touching
# app/core/finnhub.py or any other shared service.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.development}"
if [ ! -f "$ENV_FILE" ]; then
  echo "run_local_dev.sh: $ENV_FILE not found" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export ENV_FILE
exec venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
