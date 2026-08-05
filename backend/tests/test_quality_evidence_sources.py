"""
Tests — app.services.quality.evidence_sources (Fase 2, Incremento 6).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch

from app.services.quality.evidence_sources import (
    gather_filing_evidence,
    search_public_commentary,
    scrape_public_excerpt,
    gather_evidence_bundle,
    EvidenceBundle,
)


class TestGatherFilingEvidence:
    def test_delegates_to_sec_edgar_service(self):
        with patch(
            "app.services.sec_edgar_service.fetch_filing_text_sections",
            return_value={"ticker": "AAPL", "business": "Real business text."},
        ) as mock_fetch:
            result = gather_filing_evidence("AAPL")
        mock_fetch.assert_called_once_with("AAPL", form_type="10-K")
        assert result["business"] == "Real business text."

    def test_returns_empty_dict_when_none(self):
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", return_value=None):
            assert gather_filing_evidence("ZZZZ") == {}


class TestSearchPublicCommentary:
    def test_delegates_to_perplexity_with_a_real_query(self):
        with patch(
            "app.services.perplexity_service.search_web_with_citations",
            return_value={"answer": "real answer", "citations": []},
        ) as mock_search:
            result = search_public_commentary("AAPL", "Apple", "moat y ventaja competitiva")
        assert result["answer"] == "real answer"
        call_args = mock_search.call_args
        assert "Apple" in call_args[0][0]
        assert "AAPL" in call_args[0][0]
        assert "moat y ventaja competitiva" in call_args[0][0]

    def test_uses_english_system_prompt_when_lang_is_en(self):
        with patch("app.services.perplexity_service.search_web_with_citations", return_value={"answer": "", "citations": []}) as mock_search:
            search_public_commentary("AAPL", "Apple", "moat", lang="en")
        system_prompt = mock_search.call_args.kwargs.get("system_prompt")
        assert "English" in system_prompt


class TestScrapePublicExcerpt:
    def test_returns_extracted_text_on_success(self):
        mock_response = type("R", (), {"status_code": 200, "text": "<html>irrelevant</html>"})()
        with patch("requests.get", return_value=mock_response), \
             patch("app.services.html_extraction.extract_main_text", return_value="Real extracted text."):
            result = scrape_public_excerpt("https://example.com/article")
        assert result == "Real extracted text."

    def test_returns_none_on_non_200(self):
        mock_response = type("R", (), {"status_code": 404, "text": ""})()
        with patch("requests.get", return_value=mock_response):
            assert scrape_public_excerpt("https://example.com/missing") is None

    def test_returns_none_when_extraction_yields_nothing(self):
        mock_response = type("R", (), {"status_code": 200, "text": "<html>paywall</html>"})()
        with patch("requests.get", return_value=mock_response), \
             patch("app.services.html_extraction.extract_main_text", return_value=""):
            assert scrape_public_excerpt("https://example.com/paywalled") is None

    def test_returns_none_on_exception(self):
        with patch("requests.get", side_effect=Exception("timeout")):
            assert scrape_public_excerpt("https://example.com/slow") is None


class TestGatherEvidenceBundle:
    def test_combines_all_three_sources(self):
        with patch(
            "app.services.sec_edgar_service.fetch_filing_text_sections",
            return_value={"ticker": "AAPL", "business": "Real filing text."},
        ), patch(
            "app.services.perplexity_service.search_web_with_citations",
            return_value={
                "answer": "Real search answer.",
                "citations": [{"url": "https://example.com/a", "title": "Article A"}],
            },
        ), patch(
            "app.services.quality.evidence_sources.scrape_public_excerpt",
            return_value="Real scraped excerpt.",
        ):
            bundle = gather_evidence_bundle("AAPL", "Apple", "moat")

        assert isinstance(bundle, EvidenceBundle)
        assert bundle.filing_evidence["business"] == "Real filing text."
        assert bundle.search_answer == "Real search answer."
        assert len(bundle.scraped_excerpts) == 1
        assert bundle.scraped_excerpts[0].url == "https://example.com/a"
        assert bundle.has_any_real_evidence is True

    def test_has_any_real_evidence_false_when_everything_empty(self):
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", return_value=None), \
             patch("app.services.perplexity_service.search_web_with_citations", return_value={"answer": "", "citations": []}):
            bundle = gather_evidence_bundle("ZZZZ", "Unknown Co", "moat")
        assert bundle.has_any_real_evidence is False
        assert bundle.scraped_excerpts == []

    def test_skips_citations_without_a_url(self):
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", return_value=None), \
             patch(
                 "app.services.perplexity_service.search_web_with_citations",
                 return_value={"answer": "answer", "citations": [{"url": None, "title": "No URL"}]},
             ), patch("app.services.quality.evidence_sources.scrape_public_excerpt") as mock_scrape:
            bundle = gather_evidence_bundle("AAPL", "Apple", "moat")
        mock_scrape.assert_not_called()
        assert bundle.scraped_excerpts == []

    def test_a_failed_scrape_does_not_break_the_bundle(self):
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", return_value=None), \
             patch(
                 "app.services.perplexity_service.search_web_with_citations",
                 return_value={"answer": "real answer", "citations": [{"url": "https://example.com/x", "title": None}]},
             ), patch("app.services.quality.evidence_sources.scrape_public_excerpt", return_value=None):
            bundle = gather_evidence_bundle("AAPL", "Apple", "moat")
        assert bundle.scraped_excerpts == []
        assert bundle.has_any_real_evidence is True  # search_answer alone is enough

    def test_caps_excerpts_at_max_per_bundle(self):
        citations = [{"url": f"https://example.com/{i}", "title": None} for i in range(10)]
        with patch("app.services.sec_edgar_service.fetch_filing_text_sections", return_value=None), \
             patch("app.services.perplexity_service.search_web_with_citations", return_value={"answer": "a", "citations": citations}), \
             patch("app.services.quality.evidence_sources.scrape_public_excerpt", return_value="excerpt text"):
            bundle = gather_evidence_bundle("AAPL", "Apple", "moat")
        assert len(bundle.scraped_excerpts) == 3
