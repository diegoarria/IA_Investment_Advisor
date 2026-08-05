"""
Tests — app.services.perplexity_service.search_web_with_citations
(Fase 2, Incremento 6).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import patch, MagicMock

from app.services.perplexity_service import search_web_with_citations


def _mock_settings_with_key():
    settings = MagicMock()
    settings.perplexity_api_key = "fake-key"
    return settings


class TestSearchWebWithCitations:
    def test_returns_empty_without_api_key(self):
        settings = MagicMock()
        settings.perplexity_api_key = ""
        with patch("app.core.config.settings", settings), patch.dict("os.environ", {}, clear=True):
            result = search_web_with_citations("some query")
        assert result == {"answer": "", "citations": []}

    def test_captures_search_results_as_citations(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Real answer text."}}],
            "search_results": [
                {"url": "https://example.com/a", "title": "Article A"},
                {"url": "https://example.com/b", "title": "Article B"},
            ],
        }
        with patch("app.core.config.settings", _mock_settings_with_key()), \
             patch("app.services.perplexity_service.requests.post", return_value=mock_response), \
             patch("app.services.perplexity_service.cache_get", return_value=None), \
             patch("app.services.perplexity_service.cache_set"):
            result = search_web_with_citations("some query")

        assert result["answer"] == "Real answer text."
        assert len(result["citations"]) == 2
        assert result["citations"][0] == {"url": "https://example.com/a", "title": "Article A"}

    def test_falls_back_to_plain_citations_array(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Real answer."}}],
            "citations": ["https://example.com/c", "https://example.com/d"],
        }
        with patch("app.core.config.settings", _mock_settings_with_key()), \
             patch("app.services.perplexity_service.requests.post", return_value=mock_response), \
             patch("app.services.perplexity_service.cache_get", return_value=None), \
             patch("app.services.perplexity_service.cache_set"):
            result = search_web_with_citations("some query")

        assert len(result["citations"]) == 2
        assert result["citations"][0] == {"url": "https://example.com/c", "title": None}

    def test_returns_empty_on_non_200_status(self):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "server error"
        with patch("app.core.config.settings", _mock_settings_with_key()), \
             patch("app.services.perplexity_service.requests.post", return_value=mock_response), \
             patch("app.services.perplexity_service.cache_get", return_value=None):
            result = search_web_with_citations("some query")
        assert result == {"answer": "", "citations": []}

    def test_returns_empty_on_exception(self):
        with patch("app.core.config.settings", _mock_settings_with_key()), \
             patch("app.services.perplexity_service.requests.post", side_effect=Exception("network error")), \
             patch("app.services.perplexity_service.cache_get", return_value=None):
            result = search_web_with_citations("some query")
        assert result == {"answer": "", "citations": []}

    def test_no_citations_when_neither_field_present(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"choices": [{"message": {"content": "Answer with no sources."}}]}
        with patch("app.core.config.settings", _mock_settings_with_key()), \
             patch("app.services.perplexity_service.requests.post", return_value=mock_response), \
             patch("app.services.perplexity_service.cache_get", return_value=None), \
             patch("app.services.perplexity_service.cache_set"):
            result = search_web_with_citations("some query")
        assert result["citations"] == []
        assert result["answer"] == "Answer with no sources."

    def test_uses_cache_when_present(self):
        cached_value = {"answer": "cached answer", "citations": []}
        with patch("app.core.config.settings", _mock_settings_with_key()), \
             patch("app.services.perplexity_service.cache_get", return_value=cached_value), \
             patch("app.services.perplexity_service.requests.post") as mock_post:
            result = search_web_with_citations("some query")
        assert result == cached_value
        mock_post.assert_not_called()
