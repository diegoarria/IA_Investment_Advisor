"""format_fundamental_analysis_for_prompt() — the text block injected into
Arthur's chat context (chat.py's _fundamentals_context_block) and into the
company-diagnostic narrative prompt (ai_service.py). Confirmed live
2026-10-03: this crashed (raw TypeError, `dcf["scenarios"][name]` on a
dcf whose `scenarios` was None) for the WHOLE Priority-3 GQV-fallback
ticker population (RIVN/LCID/PLUG/MSTR/BA/INTC/MRNA/TTWO/NIO/BABA...) —
silently swallowed by chat.py's own try/except, so Arthur's chat had been
missing their real fundamentals with no visible error. These tests cover
the 2 new branches added to fix that: real GQV scenarios rendered
honestly, and a clean decline (never a crash, never a fabricated number)
when neither the legacy DCF nor GQV has anything real to say."""
from app.services.fundamental_analysis_service import format_fundamental_analysis_for_prompt

_YEARS = ["2021", "2022", "2023", "2024", "2025"]
_TREND5 = [1.0, 2.0, 3.0, 4.0, 5.0]  # generic 5-year placeholder trend, reused across every *_trend field

# A full, well-shaped `data` dict (every key format_fundamental_analysis_
# for_prompt reads unconditionally before it ever reaches the `dcf`
# section) — same real-world shape get_fundamental_analysis returns for a
# RIVN-like ticker (5 years of real statements, negative earnings/FCF).
_BASE_DATA = {
    "ticker": "RIVN", "company_name": "Rivian Automotive, Inc.", "sector": "Consumer Cyclical",
    "current_price": 14.3, "data_years_available": 5, "data_source": "fmp",
    "years": _YEARS, "ttm": None,
    "liquidity_gate": None, "data_validation": None, "sector_model_note": None, "segments": [],
    "revenue_trend": _TREND5, "revenue_cagr_pct": 214.6,
    "fcf_trend": [-4.0, -5.0, -3.0, -2.5, -2.0], "fcf_cagr_pct": None,
    "net_income_trend": [-4.0, -5.0, -4.5, -4.0, -3.0], "net_income_cagr_pct": None,
    "owner_earnings_trend": _TREND5,
    "gross_margin_trend": _TREND5, "operating_margin_trend": _TREND5, "net_margin_trend": _TREND5,
    "roic_trend": _TREND5, "roe_trend": _TREND5, "roa_trend": _TREND5,
    "total_debt": 4_440_000_000.0, "cash": 6_082_000_000.0, "net_cash": 1_642_000_000.0,
    "pe_ratio": None, "ev_ebitda": None, "peg_ratio": None, "ev_fcf": None, "p_fcf": None,
    "dividend_yield_pct": None, "quality_score_100": 50, "thesis_scores": None,
}


class TestGqvFallbackScenariosRendered:
    """dcf.gqv_fair_value.status == "ok" with real bear/base/bull — the
    Priority-3 minimal dcf dict shape (no `projection_years`, no
    `scenarios`), same as BRK.B / any GQV-without-legacy-DCF ticker."""

    def _dcf(self, status="ok"):
        return {
            "sector": "Consumer Cyclical", "current_price": 14.3,
            "scenarios": None, "nuvos_fair_value": None,
            "dcf_unavailable_reason": "El DCF estándar no aplica (margen de FCF promedio no positivo) — "
                                       "se intentó valorar de forma independiente con el motor Growth+Quality+Value.",
            "gqv_fair_value": {
                "status": status,
                "classification": {"reason": "Ganancias deprimidas con evidencia real de mejora reciente — clasificado como Turnaround."},
                "scenarios": {
                    "bear": {"fair_value_per_share": 9.5}, "base": {"fair_value_per_share": 14.0},
                    "bull": {"fair_value_per_share": 22.0}, "current_price": 14.3,
                    "margin_of_safety_pct": -2.1,
                } if status == "ok" else None,
            },
        }

    def test_renders_real_gqv_scenarios_no_crash(self):
        data = {**_BASE_DATA, "dcf": self._dcf("ok")}
        text = format_fundamental_analysis_for_prompt(data)
        assert "Growth+Quality+Value" in text
        assert "$9.5" in text and "$14.0" in text and "$22.0" in text
        assert "Turnaround" in text or "mejora reciente" in text

    def test_never_fabricates_a_number_outside_the_3_real_scenarios(self):
        data = {**_BASE_DATA, "dcf": self._dcf("ok")}
        text = format_fundamental_analysis_for_prompt(data)
        assert "No inventes" in text

    def test_insufficient_data_declines_cleanly_instead_of_crashing(self):
        # The exact shape that crashed live for RIVN before the fix:
        # gqv_fair_value.status == "insufficient_data", scenarios None.
        data = {**_BASE_DATA, "dcf": self._dcf("insufficient_data")}
        text = format_fundamental_analysis_for_prompt(data)  # must not raise
        assert "no se pudo calcular" in text.lower()
        assert "no inventes" in text.lower()
        assert "$9.5" not in text and "$14.0" not in text  # no real scenarios existed — never fabricated

    def test_decline_message_surfaces_the_real_reason(self):
        data = {**_BASE_DATA, "dcf": self._dcf("insufficient_data")}
        text = format_fundamental_analysis_for_prompt(data)
        assert "margen de FCF" in text  # the real dcf_unavailable_reason, not a generic string


class TestLegacyAndFinancialPathsUnaffected:
    """The 2 pre-existing shapes (legacy FCF-DCF, financial-sector residual
    income) must keep working exactly as before — this fix only ADDS 2 new
    branches, never touches the `if "projection_years" in dcf` / `elif
    dcf.get("scenarios") is not None` paths."""

    def test_legacy_dcf_shape_still_renders_scenarios_table(self):
        dcf = {
            "projection_years": 10, "base_fcf": 500_000_000, "avg_fcf_margin_pct": 12.0,
            "base_discount_rate_pct": 9.0, "terminal_growth_pct": 2.5, "sector": "Technology",
            "total_debt": 100_000_000, "cash": 300_000_000, "shares_outstanding": 50_000_000,
            "current_price": 40.0, "margin_of_safety_pct": 10.0,
            "scenarios": {
                "pessimistic": {"stage1_growth_pct": 5.0, "discount_rate_pct": 10.0, "intrinsic_value_per_share": 30.0},
                "base": {"stage1_growth_pct": 10.0, "discount_rate_pct": 9.0, "intrinsic_value_per_share": 44.0},
                "optimistic": {"stage1_growth_pct": 15.0, "discount_rate_pct": 8.0, "intrinsic_value_per_share": 60.0},
            },
        }
        data = {**_BASE_DATA, "dcf": dcf}
        text = format_fundamental_analysis_for_prompt(data)
        assert "$44.0" in text and "Pesimista" in text and "Optimista" in text

    def test_no_dcf_at_all_still_declines_cleanly(self):
        data = {**_BASE_DATA, "dcf": None}
        text = format_fundamental_analysis_for_prompt(data)
        assert "no se pudo calcular" in text.lower()
