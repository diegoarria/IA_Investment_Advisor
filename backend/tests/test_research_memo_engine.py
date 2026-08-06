"""
Tests — app.services.research.memo_engine (Fase 3, Incremento 9).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.research.memo_engine import (
    compute_investment_memo,
    _compose_conclusion,
    _texts,
)

_BUSINESS_SNAPSHOT = {"content": {
    "how_it_makes_money": "Vende hardware con alto margen y servicios recurrentes.",
    "what_it_sells": "Smartphones y servicios.", "who_pays": "Consumidores.",
    "key_customers": "Consumidores globales.", "most_profitable_segment": "Services.",
    "value_destroying_segment": "ninguno identificado",
}}
_COMPETITIVE_SNAPSHOT = {"content": {
    "direct_competitors": "MSFT, GOOGL.", "competitive_advantages_vs_peers": "ROIC superior.",
    "peer_comparison": {"quality_score_percentile": 80.0},
}}
_INDUSTRY_SNAPSHOT = {"content": {"category": "Software", "market_size_and_growth": "Grande y creciendo.", "trends": "IA.", "structural_risks": "Regulación."}}
_MANAGEMENT_SNAPSHOT = {"content": {"strategic_priorities": "Foco en IA.", "consistency_assessment": "Consistente.", "guidance_track_record_note": "Sin evidencia suficiente."}}
_THESIS = {
    "thesis_summary": "Negocio de alta calidad con moat real.", "confidence": "medium",
    "key_risks": [{"text": "Concentración de clientes."}],
    "critical_variables": [{"text": "El margen de Services debe mantenerse sobre 25%."}],
    "invalidation_events": [{"text": "Pérdida del cliente principal."}],
}
_EARNINGS_QUALITY = {"alerts": [{"description": "SBC elevado vs. revenue.", "severity": "media"}]}
_CATALYSTS = {"catalysts": [{"catalyst": "Nuevo producto.", "time_horizon": "corto_plazo"}]}


class TestComposeConclusion:
    def test_combines_summary_confidence_and_conviction(self):
        text = _compose_conclusion("Resumen real.", "medium", 75.0)
        assert "Resumen real." in text
        assert "medium" in text
        assert "75.0/100" in text

    def test_none_summary_produces_none(self):
        assert _compose_conclusion(None, "medium", 75.0) is None


class TestTexts:
    def test_extracts_text_field(self):
        assert _texts([{"text": "a"}, {"text": "b"}]) == ["a", "b"]

    def test_none_or_empty(self):
        assert _texts(None) == []
        assert _texts([]) == []


class TestComputeInvestmentMemo:
    @pytest.mark.asyncio
    async def test_assembles_every_section_from_real_inputs(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", side_effect=[_BUSINESS_SNAPSHOT, _COMPETITIVE_SNAPSHOT, _INDUSTRY_SNAPSHOT, _MANAGEMENT_SNAPSHOT]), \
             patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_user_thesis, \
             patch("app.services.research.thesis_engine.get_thesis_draft", new_callable=AsyncMock) as mock_draft:
            mock_user_thesis.return_value = None
            mock_draft.return_value = _THESIS
            result = await compute_investment_memo(
                "AAPL", "Apple",
                quality_score=85.0, moat_score=70.0, management_score=65.0, conviction_score=75.0,
                intrinsic_value_per_share=180.0, fair_value_range={"low": 150, "high": 200},
                earnings_quality_result=_EARNINGS_QUALITY, catalysts=_CATALYSTS,
                segments=[{"name": "iPhone", "pct_of_total": 55.0}],
            )

        assert result.has_any_signal is True
        assert result.sections["executive_summary"] == _THESIS["thesis_summary"]
        assert result.sections["business_description"] == _BUSINESS_SNAPSHOT["content"]["how_it_makes_money"]
        assert result.sections["quality_score"] == 85.0
        assert result.sections["intrinsic_value"] == 180.0
        assert "Concentración de clientes." in result.sections["risks"]
        assert "SBC elevado vs. revenue. (severidad: media)" in result.sections["risks"]
        assert result.sections["catalysts"] == _CATALYSTS["catalysts"]
        assert result.sections["variables_to_monitor"] == ["El margen de Services debe mantenerse sobre 25%."]
        assert result.sections["reasons_to_sell"] == ["Pérdida del cliente principal."]
        assert result.sections["segments"][0]["name"] == "iPhone"

    @pytest.mark.asyncio
    async def test_user_thesis_preferred_over_shared_draft(self):
        user_thesis = dict(_THESIS, thesis_summary="Tesis personal del usuario.")
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_user_thesis, \
             patch("app.services.research.thesis_engine.get_thesis_draft", new_callable=AsyncMock) as mock_draft:
            mock_user_thesis.return_value = user_thesis
            result = await compute_investment_memo("AAPL", "Apple", user_id="user1")

        assert result.sections["executive_summary"] == "Tesis personal del usuario."
        mock_draft.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_snapshots_or_thesis_degrades_to_empty_sections(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_user_thesis, \
             patch("app.services.research.thesis_engine.get_thesis_draft", new_callable=AsyncMock) as mock_draft:
            mock_user_thesis.return_value = None
            mock_draft.return_value = None
            result = await compute_investment_memo("AAPL", "Apple")

        assert result.sections["executive_summary"] is None
        assert result.sections["risks"] == []
        assert result.sections["variables_to_monitor"] == []

    @pytest.mark.asyncio
    async def test_generated_at_is_a_real_timestamp(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_user_thesis, \
             patch("app.services.research.thesis_engine.get_thesis_draft", new_callable=AsyncMock) as mock_draft:
            mock_user_thesis.return_value = None
            mock_draft.return_value = None
            result = await compute_investment_memo("AAPL", "Apple")

        assert result.generated_at.startswith("20")

    @pytest.mark.asyncio
    async def test_to_dict_preserves_section_order(self):
        with patch("app.services.research.knowledge_store.get_latest_snapshot", return_value=None), \
             patch("app.services.research.thesis_engine.get_user_current_thesis", new_callable=AsyncMock) as mock_user_thesis, \
             patch("app.services.research.thesis_engine.get_thesis_draft", new_callable=AsyncMock) as mock_draft:
            mock_user_thesis.return_value = None
            mock_draft.return_value = None
            result = await compute_investment_memo("AAPL", "Apple")

        d = result.to_dict()
        assert list(d["sections"].keys())[0] == "executive_summary"
        assert list(d["sections"].keys())[-1] == "reasons_to_sell"
