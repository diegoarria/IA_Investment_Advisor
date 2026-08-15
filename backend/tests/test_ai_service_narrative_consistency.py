"""
Regression tests — methodology audit round 3 (see /Users/diegoarria/
.claude/plans/cosmic-munching-crown.md): the AI-generated investment thesis
must cite the SAME Fair Value the UI actually shows (GQV-first), never the
legacy DCF's own number, which `format_fundamental_analysis_for_prompt`
renders instead. These tests capture the constructed prompt (mocking the
real Claude call) and assert the real GQV-first number is present and the
legacy-DCF number is explicitly disclaimed — never that the model "did the
right thing," since that would require a live LLM call.
"""
import app.services.ai_service as ai_service


class _FakeUsage:
    input_tokens = 100
    output_tokens = 50


class _FakeResponse:
    def __init__(self, text: str):
        self.content = [type("Block", (), {"text": text})()]
        self.usage = _FakeUsage()


async def _noop_log_llm_usage(*args, **kwargs):
    return None


def _valid_diagnostic_json() -> str:
    return (
        '{"oneLinerPitch": "x", "investmentThesis": "x", '
        '"noiseVsReality": {"marketSaw": "x", "nuvosReality": "x"}, '
        '"actionPlan": {"profile": "x", "strategy": "x"}}'
    )


def _valid_quick_summary_json() -> str:
    return '{"summary": "x", "business_understanding_stars": 3, "business_understanding_reason": "x", "checklist_reasons": {}}'


class TestCompanyDiagnosticNarrativeCitesRealFairValue:
    async def test_prompt_includes_real_gqv_base_value_and_disclaims_legacy_dcf(self, monkeypatch):
        captured = {}

        async def fake_claude(**kwargs):
            captured["prompt"] = kwargs["messages"][0]["content"]
            return _FakeResponse(_valid_diagnostic_json())

        monkeypatch.setattr(ai_service, "_claude", fake_claude)
        monkeypatch.setattr(ai_service, "log_llm_usage", _noop_log_llm_usage)
        # format_fundamental_analysis_for_prompt is imported locally inside
        # the function (`from app.services.fundamental_analysis_service
        # import format_fundamental_analysis_for_prompt`) — patch it at its
        # real source module so the local import picks up the fake.
        import app.services.fundamental_analysis_service as fas
        monkeypatch.setattr(fas, "format_fundamental_analysis_for_prompt", lambda data: "Valor intrínseco (DCF legado): $126.06 (otra metodología)")

        diagnostic = {
            "ticker": "AAPL", "companyName": "Apple Inc.", "score": 88, "scoreLabel": "Calidad Máxima",
            "moatPoints": [],
            "valuation": {"baseFairValue": 168.94, "marginOfSafetyPercent": -45.0},
        }
        data = {"ticker": "AAPL", "company_name": "Apple Inc."}

        result = await ai_service.generate_company_diagnostic_narrative(data=data, diagnostic=diagnostic, lang="es")

        assert result is not None
        prompt = captured["prompt"]
        assert "168.94" in prompt  # the REAL, displayed GQV-first value must be present
        assert "IGNÓRALA" in prompt  # explicit instruction not to cite the legacy DCF figure instead

    async def test_omits_the_real_value_line_when_valuation_missing(self, monkeypatch):
        # Never fabricate a fair-value line when there's genuinely nothing
        # real to cite — the prompt should degrade gracefully, not crash.
        captured = {}

        async def fake_claude(**kwargs):
            captured["prompt"] = kwargs["messages"][0]["content"]
            return _FakeResponse(_valid_diagnostic_json())

        monkeypatch.setattr(ai_service, "_claude", fake_claude)
        monkeypatch.setattr(ai_service, "log_llm_usage", _noop_log_llm_usage)
        import app.services.fundamental_analysis_service as fas
        monkeypatch.setattr(fas, "format_fundamental_analysis_for_prompt", lambda data: "(sin datos)")

        diagnostic = {"ticker": "XYZ", "companyName": "XYZ Corp", "score": 50, "scoreLabel": "N/D", "moatPoints": [], "valuation": {}}
        data = {"ticker": "XYZ", "company_name": "XYZ Corp"}

        result = await ai_service.generate_company_diagnostic_narrative(data=data, diagnostic=diagnostic, lang="es")
        assert result is not None
        assert "Valor razonable REAL" not in captured["prompt"]


class TestQuickValuationSummaryCitesRealFairValue:
    async def test_prompt_includes_real_primary_scenario_base_value(self, monkeypatch):
        captured = {}

        async def fake_claude(**kwargs):
            captured["prompt"] = kwargs["messages"][0]["content"]
            return _FakeResponse(_valid_quick_summary_json())

        monkeypatch.setattr(ai_service, "_claude", fake_claude)
        import app.services.fundamental_analysis_service as fas
        monkeypatch.setattr(fas, "format_fundamental_analysis_for_prompt", lambda data: "Valor intrínseco (DCF legado): $126.06")

        import app.services.company_diagnostic_service as cds
        monkeypatch.setattr(
            cds, "_primary_scenarios",
            lambda dcf: {"bear": 100.0, "base": 168.94, "bull": 250.0, "current_price": 307.20, "margin_of_safety_pct": -45.0, "source": "gqv"},
        )

        data = {
            "ticker": "AAPL", "company_name": "Apple Inc.", "dcf": {"gqv_fair_value": {"status": "ok"}},
            "checklist_items_real": [], "sector": "Technology",
        }

        result = await ai_service.generate_quick_valuation_summary(data=data, lang="es")

        assert result is not None
        prompt = captured["prompt"]
        assert "168.94" in prompt
        assert "IGNÓRALA" in prompt
