"""
Tests — app.api.routes.sync's Personalización helpers (Fase 4, Incremento
12, Parte L). See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
from app.api.routes.sync import _build_personalization_update


class TestRequiredReturnPct:
    def test_valid_value_is_kept(self):
        assert _build_personalization_update({"required_return_pct": 12.5}) == {"required_return_pct": 12.5}

    def test_none_clears_it(self):
        assert _build_personalization_update({"required_return_pct": None}) == {"required_return_pct": None}

    def test_zero_or_below_is_rejected_to_none(self):
        assert _build_personalization_update({"required_return_pct": 0}) == {"required_return_pct": None}
        assert _build_personalization_update({"required_return_pct": -5}) == {"required_return_pct": None}

    def test_hundred_or_above_is_rejected_to_none(self):
        assert _build_personalization_update({"required_return_pct": 100}) == {"required_return_pct": None}
        assert _build_personalization_update({"required_return_pct": 250}) == {"required_return_pct": None}

    def test_absent_key_is_not_included(self):
        assert "required_return_pct" not in _build_personalization_update({})


class TestMinMarginOfSafetyPct:
    def test_valid_negative_and_positive_values_kept(self):
        assert _build_personalization_update({"min_margin_of_safety_pct": -10}) == {"min_margin_of_safety_pct": -10}
        assert _build_personalization_update({"min_margin_of_safety_pct": 25}) == {"min_margin_of_safety_pct": 25}

    def test_out_of_range_rejected_to_none(self):
        assert _build_personalization_update({"min_margin_of_safety_pct": 150}) == {"min_margin_of_safety_pct": None}
        assert _build_personalization_update({"min_margin_of_safety_pct": -150}) == {"min_margin_of_safety_pct": None}


class TestPreferredDiscountRateMethod:
    def test_valid_methods_kept(self):
        assert _build_personalization_update({"preferred_discount_rate_method": "wacc"}) == {"preferred_discount_rate_method": "wacc"}
        assert _build_personalization_update({"preferred_discount_rate_method": "required_return"}) == {"preferred_discount_rate_method": "required_return"}

    def test_invalid_method_defaults_to_wacc(self):
        assert _build_personalization_update({"preferred_discount_rate_method": "garbage"}) == {"preferred_discount_rate_method": "wacc"}


class TestFavoriteMetrics:
    def test_valid_list_kept(self):
        assert _build_personalization_update({"favorite_metrics": ["quality_score", "margin_of_safety_pct"]}) == {
            "favorite_metrics": ["quality_score", "margin_of_safety_pct"]
        }

    def test_capped_at_max(self):
        metrics = [f"m{i}" for i in range(10)]
        result = _build_personalization_update({"favorite_metrics": metrics})
        assert len(result["favorite_metrics"]) == 6

    def test_non_list_becomes_empty_list(self):
        assert _build_personalization_update({"favorite_metrics": "not-a-list"}) == {"favorite_metrics": []}


class TestDashboardSectionOrder:
    def test_valid_order_kept(self):
        order = ["summary", "key_risks", "moat_score"]
        assert _build_personalization_update({"dashboard_section_order": order}) == {"dashboard_section_order": order}

    def test_unknown_section_rejected_to_none(self):
        assert _build_personalization_update({"dashboard_section_order": ["summary", "made_up_section"]}) == {
            "dashboard_section_order": None
        }

    def test_non_list_rejected_to_none(self):
        assert _build_personalization_update({"dashboard_section_order": "summary"}) == {"dashboard_section_order": None}


class TestMultipleFieldsAndPartialUpdates:
    def test_only_present_keys_are_included(self):
        result = _build_personalization_update({"required_return_pct": 10})
        assert list(result.keys()) == ["required_return_pct"]

    def test_empty_body_yields_empty_update(self):
        assert _build_personalization_update({}) == {}

    def test_multiple_fields_all_validated_independently(self):
        result = _build_personalization_update({
            "required_return_pct": 15, "min_margin_of_safety_pct": 20,
            "preferred_discount_rate_method": "required_return", "favorite_metrics": ["roic"],
        })
        assert result == {
            "required_return_pct": 15, "min_margin_of_safety_pct": 20,
            "preferred_discount_rate_method": "required_return", "favorite_metrics": ["roic"],
        }
