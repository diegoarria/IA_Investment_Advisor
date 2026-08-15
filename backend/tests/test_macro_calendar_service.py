from app.services.macro_calendar_service import (
    _classify, _strip_period_suffix, _event_id, why_it_matters,
)


class TestStripPeriodSuffix:
    def test_strips_month_parenthetical(self):
        assert _strip_period_suffix("Non Farm Payrolls (Oct)") == "non farm payrolls"

    def test_lowercases(self):
        assert _strip_period_suffix("CPI (Oct)") == "cpi"

    def test_no_suffix(self):
        assert _strip_period_suffix("Fed Interest Rate Decision") == "fed interest rate decision"


class TestClassify:
    def test_fomc_rate_decision(self):
        result = _classify("Fed Interest Rate Decision")
        assert result == ("fomc_rate_decision", "VERY_HIGH", None)

    def test_headline_cpi(self):
        result = _classify("Inflation Rate YoY (Sep)")
        assert result == ("cpi", "VERY_HIGH", None)

    def test_core_cpi_not_confused_with_headline_cpi(self):
        result = _classify("Core Inflation Rate YoY (Sep)")
        assert result[0] == "core_cpi"

    def test_nfp_matches_but_not_private_payrolls(self):
        assert _classify("Non Farm Payrolls (Oct)")[0] == "nfp"
        assert _classify("Nonfarm Payrolls Private (Sep)") is None
        assert _classify("Government Payrolls (Sep)") is None

    def test_unemployment_rate_not_confused_with_u6(self):
        assert _classify("Unemployment Rate (Oct)")[0] == "unemployment_rate"
        assert _classify("U-6 Unemployment Rate (Oct)") is None

    def test_gdp(self):
        assert _classify("GDP Growth Rate QoQ (Q3)")[0] == "gdp"

    def test_ppi_representative(self):
        assert _classify("PPI Ex Food, Energy and Trade YoY (Oct)")[0] == "ppi"

    def test_housing_starts_and_building_permits_both_map(self):
        assert _classify("Housing Starts (Oct)")[0] == "housing_starts"
        assert _classify("Building Permits (Oct)")[0] == "housing_starts"
        # MoM variants intentionally excluded (same release, avoid duplicate rows)
        assert _classify("Housing Starts MoM (Oct)") is None

    def test_fed_speaker_extracts_real_name(self):
        event_type, impact, speaker = _classify("Fed Barkin Speech")
        assert event_type == "fed_speaker"
        assert speaker == "Barkin"

    def test_powell_detected_even_without_speech_pattern(self):
        result = _classify("Fed Chair Powell Testimony")
        assert result is not None
        assert result[0] == "fed_speaker"
        assert result[2] == "Powell"

    def test_unrelated_events_filtered_out(self):
        assert _classify("Michigan Inflation Expectations (Aug)") is None
        assert _classify("3-Month Bill Auction") is None
        assert _classify("Existing Home Sales (Oct)") is None


class TestEventId:
    def test_deterministic(self):
        a = _event_id("cpi", "Inflation Rate YoY (Sep)", "2026-09-11T12:30:00+00:00")
        b = _event_id("cpi", "Inflation Rate YoY (Sep)", "2026-09-11T12:30:00+00:00")
        assert a == b

    def test_changes_with_inputs(self):
        a = _event_id("cpi", "Inflation Rate YoY (Sep)", "2026-09-11T12:30:00+00:00")
        b = _event_id("cpi", "Inflation Rate YoY (Oct)", "2026-10-11T12:30:00+00:00")
        assert a != b


class TestWhyItMatters:
    def test_returns_spanish_by_default(self):
        text = why_it_matters("cpi", "es")
        assert text and "inflaci" in text.lower()

    def test_returns_english(self):
        text = why_it_matters("cpi", "en")
        assert text and "inflation" in text.lower()

    def test_unknown_type_returns_empty(self):
        assert why_it_matters("not_a_real_type", "es") == ""
