"""
NOT EXECUTED. Prepared for Diego's review per the 2026-11-12 "backend
editorial mínimo" directive ("Plan de inserción controlada de los cinco
borradores... No insertes ni publiques los cinco borradores todavía").

Updated 2026-11-12 to go through the real validated write path
(qualitative_content_service.create_draft) instead of a raw REST POST —
the earlier version of this script bypassed structural validation
entirely (empty explanations, missing sources for material claims,
prescriptive language would all have been accepted silently). Using
create_draft() means these 5 records get the SAME validation any future
editorial draft will get, catching a regression in the content itself
before it ever reaches Supabase, not just testing the insert mechanics.

This still only ever creates drafts (review_status='draft',
is_current=false) — never calls publish_company_qualitative_content.
Reviewing sources, marking reviewed, and publishing are separate,
later, explicit human actions via the /api/qualitative-content/review
and /api/qualitative-content/publish admin routes (admin_emails-gated).

Requires: SUPABASE_URL + SUPABASE_SERVICE_KEY in backend/.env (or
ENV_FILE pointing at an isolated project — never run this against
production without Diego's explicit go-ahead for each of these 5
tickers). Run manually, after approval, with:
    cd backend && python3 editorial_content/pilot_5/insert_drafts.py
"""
import asyncio
import json
from pathlib import Path

import app.services.qualitative_content_service as qcs

HERE = Path(__file__).parent
TICKERS = ["googl", "cost", "jpm", "nvda", "mcd"]


async def main():
    for t in TICKERS:
        with open(HERE / f"{t}.json") as f:
            record = json.load(f)
        row = await qcs.create_draft(
            record["ticker"],
            record["business_model_summary"],
            record["moat"],
            record["risks"],
            record["updated_by"],
        )
        print(record["ticker"], "->", row["review_status"], "v" + str(row["version"]), "is_current=" + str(row["is_current"]))


if __name__ == "__main__":
    raise SystemExit(
        "This script is NOT meant to be run automatically. "
        "Remove this guard only after Diego has explicitly approved "
        "inserting these 5 drafts into production Supabase."
    )
    asyncio.run(main())
