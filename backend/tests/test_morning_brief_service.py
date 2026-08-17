"""
Tests — app.services.morning_brief_service pure logic (news keyword
scoring) plus the one real Claude call this module makes (headline
translation for Spanish-language users, Aug 16 follow-up) — mocked, no
real Anthropic call. DB/Finnhub-touching orchestration (build_morning_
brief, _portfolio_day_change, _top_mover, ...) isn't covered here — same
convention as weekly_rituals_service/get_sunday_prep: only the pure
functions (and the one real-cost call site) get direct tests.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services.morning_brief_service import _score_news_item, _IMPACT_EMOJI, _translate_headlines_to_spanish, _headline_cache_key


class TestScoreNewsItem:
    def test_earnings_headline_scores_highest_category(self):
        score, category = _score_news_item("Apple reports Q3 earnings beat", "EPS beat estimates")
        assert category == "earnings"
        assert score > 0

    def test_guidance_headline_is_classified(self):
        score, category = _score_news_item("Company raises forecast for the year", "")
        assert category == "guidance"

    def test_ceo_change_headline_is_classified(self):
        score, category = _score_news_item("CEO steps down amid restructuring", "")
        assert category == "ceo_change"

    def test_m_and_a_headline_is_classified(self):
        score, category = _score_news_item("Company to acquire rival for $2B", "")
        assert category == "m_and_a"

    def test_regulation_headline_is_classified(self):
        score, category = _score_news_item("Firm faces SEC probe over disclosures", "")
        assert category == "regulation"

    def test_debt_capital_headline_is_classified(self):
        score, category = _score_news_item("Company announces new buyback program", "")
        assert category == "debt_capital"

    def test_irrelevant_headline_scores_zero(self):
        score, category = _score_news_item("Company opens new office in Austin", "Just a real-estate note")
        assert score == 0
        assert category is None

    def test_case_insensitive(self):
        score, category = _score_news_item("COMPANY REPORTS EARNINGS BEAT", "")
        assert category == "earnings"

    def test_earnings_outranks_debt_when_both_present(self):
        # Earnings (weight 6) must win over debt_capital (weight 4) when a
        # headline could plausibly match both category's keyword lists.
        score, category = _score_news_item("Earnings beat, plus a new buyback program announced", "")
        assert category == "earnings"


class TestImpactEmojiMapping:
    def test_covers_every_real_impact_level_macro_calendar_service_uses(self):
        # migrations/074_macro_economic_events.sql: impact_level is
        # VERY_HIGH | HIGH | MEDIUM (no LOW in the source data — LOW only
        # ever appears as this module's own defensive fallback).
        assert set(_IMPACT_EMOJI.keys()) >= {"VERY_HIGH", "HIGH", "MEDIUM", "LOW"}


def _fake_claude_response(text: str):
    return SimpleNamespace(content=[SimpleNamespace(text=text)])


class TestTranslateHeadlinesToSpanish:
    """Diego's Aug 16 follow-up: Spanish-language users see headlines in
    Spanish, not Finnhub's native English. The ONE real Claude call this
    module makes — must stay cheap: cached per headline, batched when
    multiple headlines need translating in the same call, never called
    at all for cached/English content."""

    async def test_fully_cached_makes_zero_claude_calls(self, monkeypatch):
        import app.core.cache as cache_mod
        import app.services.ai_service as ai_service
        import app.services.morning_brief_service as mbs

        monkeypatch.setattr(cache_mod, "cache_get", lambda key: "Apple reporta ganancias")
        claude_calls = []
        async def tracking_claude(**kwargs):
            claude_calls.append(kwargs)
            raise AssertionError("should never call Claude when everything is cached")
        monkeypatch.setattr(ai_service, "_claude", tracking_claude)

        result = await mbs._translate_headlines_to_spanish(["Apple reports earnings"])

        assert claude_calls == []
        assert result["Apple reports earnings"] == "Apple reporta ganancias"

    async def test_uncached_headlines_batched_into_one_call(self, monkeypatch):
        import app.core.cache as cache_mod
        import app.services.ai_service as ai_service

        monkeypatch.setattr(cache_mod, "cache_get", lambda key: None)
        cache_set_calls = []
        monkeypatch.setattr(cache_mod, "cache_set", lambda key, val, ttl: cache_set_calls.append((key, val)))

        claude_calls = []
        async def fake_claude(**kwargs):
            claude_calls.append(kwargs)
            return _fake_claude_response('{"translations": ["Titular uno", "Titular dos"]}')
        monkeypatch.setattr(ai_service, "_claude", fake_claude)

        import app.services.morning_brief_service as mbs
        result = await mbs._translate_headlines_to_spanish(["Headline one", "Headline two"])

        assert len(claude_calls) == 1  # ONE call for both, never one each
        assert result["Headline one"] == "Titular uno"
        assert result["Headline two"] == "Titular dos"
        assert len(cache_set_calls) == 2  # each cached individually for future reuse

    async def test_mismatched_translation_count_falls_back_to_english(self, monkeypatch):
        import app.core.cache as cache_mod
        import app.services.ai_service as ai_service

        monkeypatch.setattr(cache_mod, "cache_get", lambda key: None)
        monkeypatch.setattr(cache_mod, "cache_set", lambda *a, **k: None)

        async def fake_claude(**kwargs):
            return _fake_claude_response('{"translations": ["only one"]}')  # 2 requested, 1 returned
        monkeypatch.setattr(ai_service, "_claude", fake_claude)

        import app.services.morning_brief_service as mbs
        result = await mbs._translate_headlines_to_spanish(["Headline one", "Headline two"])

        assert result["Headline one"] == "Headline one"  # fell back to the real English text
        assert result["Headline two"] == "Headline two"

    async def test_claude_failure_falls_back_to_english_never_crashes(self, monkeypatch):
        import app.core.cache as cache_mod
        import app.services.ai_service as ai_service

        monkeypatch.setattr(cache_mod, "cache_get", lambda key: None)
        monkeypatch.setattr(cache_mod, "cache_set", lambda *a, **k: None)

        async def failing_claude(**kwargs):
            raise RuntimeError("simulated daily spend cap or API outage")
        monkeypatch.setattr(ai_service, "_claude", failing_claude)

        import app.services.morning_brief_service as mbs
        result = await mbs._translate_headlines_to_spanish(["Headline one"])

        assert result["Headline one"] == "Headline one"

    def test_cache_key_is_stable_and_headline_specific(self):
        import app.services.morning_brief_service as mbs
        k1 = mbs._headline_cache_key("Apple reports earnings")
        k2 = mbs._headline_cache_key("Apple reports earnings")
        k3 = mbs._headline_cache_key("Tesla reports earnings")
        assert k1 == k2
        assert k1 != k3
