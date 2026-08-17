"""
Regression test — Diego's request (Aug 16): Arthur should also see the
user's own Saturday weekly-ritual reflections (qué salió bien / qué
aprendiste / qué harías diferente), same real-data-injection pattern
already used for the Diario de Decisiones, no AI cost added.
"""
from app.services.ai_service import build_deep_user_context


class TestBuildDeepUserContextReflections:
    def test_includes_real_reflection_text_when_present(self):
        reflections = [
            {"week_start_date": "2026-08-10", "went_well": "Vendí AAPL con ganancia real", "learned": "Paciencia paga", "would_do_differently": "Nada"},
        ]
        ctx = build_deep_user_context({}, [], [], [], {}, reflections)
        assert "REFLEXIONES SEMANALES" in ctx
        assert "Vendí AAPL con ganancia real" in ctx
        assert "Paciencia paga" in ctx
        assert "2026-08-10" in ctx

    def test_omits_the_section_entirely_when_no_reflections_exist(self):
        # Deliberate: never pad every chat message with "sin reflexiones
        # aún" for the majority of users who never did this ritual —
        # unlike Diario de Decisiones, this stays silent when empty.
        ctx = build_deep_user_context({}, [], [], [], {}, [])
        assert "REFLEXIONES SEMANALES" not in ctx

    def test_omits_the_section_when_reflections_arg_is_none(self):
        ctx = build_deep_user_context({}, [], [], [], {}, None)
        assert "REFLEXIONES SEMANALES" not in ctx

    def test_skips_a_week_with_no_real_answers(self):
        # A reflection row can exist (upserted) with all-null fields if
        # the user opened the ritual but answered nothing — must not show
        # a blank/empty bullet.
        reflections = [{"week_start_date": "2026-08-10", "went_well": None, "learned": None, "would_do_differently": None}]
        ctx = build_deep_user_context({}, [], [], [], {}, reflections)
        assert "2026-08-10" not in ctx

    def test_shows_multiple_weeks_most_recent_first(self):
        reflections = [
            {"week_start_date": "2026-08-10", "went_well": "Semana reciente", "learned": None, "would_do_differently": None},
            {"week_start_date": "2026-08-03", "went_well": "Semana anterior", "learned": None, "would_do_differently": None},
        ]
        ctx = build_deep_user_context({}, [], [], [], {}, reflections)
        recent_idx = ctx.index("Semana reciente")
        older_idx = ctx.index("Semana anterior")
        assert recent_idx < older_idx

    def test_truncates_long_answers_to_120_chars(self):
        long_text = "x" * 300
        reflections = [{"week_start_date": "2026-08-10", "went_well": long_text, "learned": None, "would_do_differently": None}]
        ctx = build_deep_user_context({}, [], [], [], {}, reflections)
        assert "x" * 121 not in ctx
        assert "x" * 120 in ctx
