"""
Regression tests — Aug 15 cost-control audit: the Research Engine routes
(app/api/routes/research_engine.py) had ZERO caching, no rate limit, and
no Premium gate. Every GET recomputed 1-5 real Claude calls from scratch,
so simply re-requesting the same company (page refresh, a frontend bug
re-mounting the component, a scripted loop) paid for fresh AI calls every
single time with no ceiling. Rate limiting is covered by slowapi's own
tests upstream (not re-tested here); this file covers the freshness-gate
logic that avoids the real recompute in the first place.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.api.routes.research_engine import _fresh_section_content, _MIN_REFRESH_HOURS


class TestFreshSectionContent:
    async def test_returns_cached_content_when_snapshot_is_fresh(self, monkeypatch):
        import app.services.research.knowledge_store as knowledge_store

        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        snapshot = {"created_at": recent, "content": {"how_it_makes_money": "Vende hardware real."}}

        async def fake_get_latest_snapshot(ticker, section):
            assert ticker == "AAPL"
            assert section == "business_understanding"
            return snapshot

        monkeypatch.setattr(knowledge_store, "get_latest_snapshot", fake_get_latest_snapshot)

        result = await _fresh_section_content("AAPL", "business_understanding")

        assert result == {"how_it_makes_money": "Vende hardware real."}

    async def test_returns_none_when_snapshot_is_stale(self, monkeypatch):
        import app.services.research.knowledge_store as knowledge_store

        old = (datetime.now(timezone.utc) - timedelta(hours=_MIN_REFRESH_HOURS + 1)).isoformat()
        snapshot = {"created_at": old, "content": {"how_it_makes_money": "stale"}}

        async def fake_get_latest_snapshot(ticker, section):
            return snapshot

        monkeypatch.setattr(knowledge_store, "get_latest_snapshot", fake_get_latest_snapshot)

        result = await _fresh_section_content("AAPL", "business_understanding")

        assert result is None

    async def test_returns_none_when_no_snapshot_exists_yet(self, monkeypatch):
        import app.services.research.knowledge_store as knowledge_store

        async def fake_get_latest_snapshot(ticker, section):
            return None

        monkeypatch.setattr(knowledge_store, "get_latest_snapshot", fake_get_latest_snapshot)

        result = await _fresh_section_content("NEW", "business_understanding")

        assert result is None
