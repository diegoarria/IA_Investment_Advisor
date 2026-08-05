"""
Tests — app.services.sec_edgar_service's real filing-text extension
(Fase 2, Incremento 6).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch

from app.services.sec_edgar_service import (
    _find_recent_filing,
    _build_filing_url,
    _extract_section,
    fetch_filing_text_sections,
)


class TestFindRecentFiling:
    def test_finds_the_first_matching_form(self):
        submissions = {
            "filings": {"recent": {
                "form": ["10-Q", "10-K", "10-Q"],
                "accessionNumber": ["0001-a", "0002-b", "0003-c"],
                "primaryDocument": ["docA.htm", "docB.htm", "docC.htm"],
                "filingDate": ["2024-06-01", "2024-02-01", "2023-06-01"],
            }},
        }
        filing = _find_recent_filing(submissions, "10-K")
        assert filing == {"accessionNumber": "0002-b", "primaryDocument": "docB.htm", "filingDate": "2024-02-01"}

    def test_returns_none_when_form_type_absent(self):
        submissions = {"filings": {"recent": {"form": ["10-Q"], "accessionNumber": ["x"], "primaryDocument": ["y"], "filingDate": ["z"]}}}
        assert _find_recent_filing(submissions, "10-K") is None

    def test_returns_none_with_empty_submissions(self):
        assert _find_recent_filing({}, "10-K") is None


class TestBuildFilingUrl:
    def test_strips_leading_zeros_and_dashes(self):
        url = _build_filing_url("0000320193", "0000320193-24-000123", "aapl-20240928.htm")
        assert url == "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm"


class TestExtractSection:
    def test_extracts_text_between_start_and_end_pattern(self):
        text = (
            "Table of Contents ... Item 1. Business ... page 5\n"
            + "Item 1. Business " + ("Real business description here. " * 10)
            + "Item 1A. Risk Factors Real risk content."
        )
        result = _extract_section(text, r"item\s*1\.\s*business", r"item\s*1a\.\s*risk\s*factors")
        assert result is not None
        assert "Real business description" in result

    def test_returns_none_when_pattern_not_found(self):
        assert _extract_section("no relevant headers here", r"item\s*1\.\s*business", r"item\s*1a\.") is None

    def test_returns_none_when_extracted_section_too_short(self):
        text = "Item 1. Business Item 1A. Risk Factors"  # nothing real between them
        assert _extract_section(text, r"item\s*1\.\s*business", r"item\s*1a\.\s*risk\s*factors") is None

    def test_uses_last_match_to_skip_table_of_contents(self):
        # ToC reference to "Item 1. Business" early, real section later
        text = (
            "Contents: Item 1. Business ... page 5\n" * 2
            + "Item 1. Business " + ("Real detailed business description content. " * 10)
            + "Item 1A. Risk Factors real content here."
        )
        result = _extract_section(text, r"item\s*1\.\s*business", r"item\s*1a\.\s*risk\s*factors")
        assert result is not None
        assert "Real detailed business description" in result


class TestFetchFilingTextSections:
    def test_returns_none_when_no_cik(self):
        with patch("app.services.sec_edgar_service.get_cik", return_value=None):
            assert fetch_filing_text_sections("ZZZZ") is None

    def test_returns_none_when_no_submissions(self):
        with patch("app.services.sec_edgar_service.get_cik", return_value="0000320193"), \
             patch("app.services.sec_edgar_service._fetch_submissions", return_value=None):
            assert fetch_filing_text_sections("AAPL") is None

    def test_returns_none_when_no_matching_filing(self):
        with patch("app.services.sec_edgar_service.get_cik", return_value="0000320193"), \
             patch("app.services.sec_edgar_service._fetch_submissions", return_value={"filings": {"recent": {"form": [], "accessionNumber": [], "primaryDocument": [], "filingDate": []}}}):
            assert fetch_filing_text_sections("AAPL") is None

    def test_returns_none_when_html_fetch_fails(self):
        submissions = {"filings": {"recent": {
            "form": ["10-K"], "accessionNumber": ["0000320193-24-000123"],
            "primaryDocument": ["aapl-20240928.htm"], "filingDate": ["2024-11-01"],
        }}}
        with patch("app.services.sec_edgar_service.get_cik", return_value="0000320193"), \
             patch("app.services.sec_edgar_service._fetch_submissions", return_value=submissions), \
             patch("app.services.sec_edgar_service._fetch_filing_html", return_value=None):
            assert fetch_filing_text_sections("AAPL") is None

    def test_returns_real_sections_when_everything_succeeds(self):
        submissions = {"filings": {"recent": {
            "form": ["10-K"], "accessionNumber": ["0000320193-24-000123"],
            "primaryDocument": ["aapl-20240928.htm"], "filingDate": ["2024-11-01"],
        }}}
        fake_html = "<html><body>irrelevant, extract_main_text is mocked</body></html>"
        fake_full_text = (
            "Item 1. Business " + ("Real business description content here. " * 10)
            + "Item 1A. Risk Factors " + ("Real risk factor content here. " * 10)
            + "Item 7. Management's Discussion and Analysis " + ("Real MDA content here. " * 10)
            + "Item 7A."
        )
        with patch("app.services.sec_edgar_service.get_cik", return_value="0000320193"), \
             patch("app.services.sec_edgar_service._fetch_submissions", return_value=submissions), \
             patch("app.services.sec_edgar_service._fetch_filing_html", return_value=fake_html), \
             patch("app.services.sec_edgar_service.extract_main_text", return_value=fake_full_text):
            result = fetch_filing_text_sections("AAPL")

        assert result is not None
        assert result["ticker"] == "AAPL"
        assert result["form_type"] == "10-K"
        assert result["filing_date"] == "2024-11-01"
        assert "320193" in result["source_url"]
        assert result["business"] and "Real business description" in result["business"]
        assert result["risk_factors"] and "Real risk factor content" in result["risk_factors"]
        assert result["mda"] and "Real MDA content" in result["mda"]

    def test_10q_uses_item_2_for_mda_not_item_7(self):
        """Fase 3, Incremento 2 (Document Intelligence Engine): a 10-Q's
        MD&A is Item 2, not Item 7 like a 10-K's — and a 10-Q has no full
        'business' section (financial-statement notes only), so that key
        must be absent/None rather than mislabeled."""
        submissions = {"filings": {"recent": {
            "form": ["10-Q"], "accessionNumber": ["0000320193-24-000456"],
            "primaryDocument": ["aapl-20240629.htm"], "filingDate": ["2024-07-15"],
        }}}
        fake_full_text = (
            "Item 1A. Risk Factors " + ("Real quarterly risk content here. " * 10)
            + "Item 2. Management's Discussion and Analysis " + ("Real quarterly MDA content here. " * 10)
            + "Item 3."
        )
        with patch("app.services.sec_edgar_service.get_cik", return_value="0000320193"), \
             patch("app.services.sec_edgar_service._fetch_submissions", return_value=submissions), \
             patch("app.services.sec_edgar_service._fetch_filing_html", return_value="<html></html>"), \
             patch("app.services.sec_edgar_service.extract_main_text", return_value=fake_full_text):
            result = fetch_filing_text_sections("AAPL", form_type="10-Q")

        assert result is not None
        assert result["form_type"] == "10-Q"
        assert result["mda"] and "Real quarterly MDA content" in result["mda"]
        assert result["risk_factors"] and "Real quarterly risk content" in result["risk_factors"]
        assert "business" not in result

    def test_unknown_form_type_falls_back_to_raw_text(self):
        """DEF 14A (proxy) and 8-K have no reliable Item-numbering scheme
        to segment honestly — must return real cleaned text under
        raw_text instead of guessing at section boundaries."""
        submissions = {"filings": {"recent": {
            "form": ["DEF 14A"], "accessionNumber": ["0000320193-24-000789"],
            "primaryDocument": ["aapl-proxy.htm"], "filingDate": ["2024-01-10"],
        }}}
        fake_full_text = "Real proxy statement content about executive compensation and board elections."
        with patch("app.services.sec_edgar_service.get_cik", return_value="0000320193"), \
             patch("app.services.sec_edgar_service._fetch_submissions", return_value=submissions), \
             patch("app.services.sec_edgar_service._fetch_filing_html", return_value="<html></html>"), \
             patch("app.services.sec_edgar_service.extract_main_text", return_value=fake_full_text):
            result = fetch_filing_text_sections("AAPL", form_type="DEF 14A")

        assert result is not None
        assert result["form_type"] == "DEF 14A"
        assert result["raw_text"] == fake_full_text
        assert "business" not in result and "mda" not in result
