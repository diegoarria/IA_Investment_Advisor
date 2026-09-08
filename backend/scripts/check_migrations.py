#!/usr/bin/env python
"""
Migration drift checker — Diego, 2026-09-08 (pre-launch audit, P2).

There's no automated migration runner in this repo (migrations are applied
by hand in the Supabase SQL editor) and, until migration 092, no tracking
table either — no auditable way to know which of backend/migrations/*.sql
had actually been applied to a given environment. This script doesn't
apply anything; it only reports drift between the .sql files on disk and
what schema_migrations (092_schema_migrations_tracking.sql) says has run.

Usage:
    venv/bin/python scripts/check_migrations.py

Exit code is 0 when nothing is pending, 1 when something is — so this can
be wired into a pre-deploy check later without extra plumbing.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import get_supabase  # noqa: E402

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def main() -> int:
    local_files = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
    if not local_files:
        print("No .sql files found under migrations/ — check MIGRATIONS_DIR.")
        return 1

    db = get_supabase()
    try:
        res = db.table("schema_migrations").select("filename").execute()
        applied = {row["filename"] for row in (res.data or [])}
    except Exception as e:
        print(f"Could not read schema_migrations (has 092_schema_migrations_tracking.sql "
              f"been applied to this environment yet?): {e}")
        return 1

    pending = [f for f in local_files if f not in applied]
    orphaned = sorted(applied - set(local_files))  # recorded as applied but no longer on disk

    print(f"{len(local_files)} migration files on disk, {len(applied)} recorded as applied.")
    if pending:
        print(f"\nPENDING ({len(pending)}) — on disk but not recorded as applied:")
        for f in pending:
            print(f"  - {f}")
    if orphaned:
        print(f"\nRECORDED BUT MISSING FROM DISK ({len(orphaned)}) — investigate before trusting either source:")
        for f in orphaned:
            print(f"  - {f}")
    if not pending and not orphaned:
        print("\nNo drift — every local migration file is recorded as applied.")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
