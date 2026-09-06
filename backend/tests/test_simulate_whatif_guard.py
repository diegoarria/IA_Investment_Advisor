"""
Tests — simulate_whatif()'s Recommendation Guard wiring
(_guard_whatif_prose_fields in ai_service.py).

Mocks the Claude call (same pattern as test_ai_service_narrative_
consistency.py) — these test the DETERMINISTIC control flow around the
guard (clean pass-through, corrective retry succeeds, retry still fails ->
deterministic strip), never "the model behaved well," which would need a
live LLM call.
"""
import json

import app.services.ai_service as ai_service
from app.services.decision_engine import has_prescriptive_language


class _FakeUsage:
    input_tokens = 100
    output_tokens = 50


class _FakeResponse:
    def __init__(self, text: str):
        self.content = [type("Block", (), {"text": text})()]
        self.usage = _FakeUsage()


async def _noop_log_llm_usage(*args, **kwargs):
    return None


def _base_result(mentor_verdict: str, summary: str = "Resumen neutral del escenario.") -> dict:
    return {
        "scenario_title": "Escenario de prueba",
        "scenario_type": "swap",
        "summary": summary,
        "before": {"total_value": 1000, "risk_level": "Moderado", "top_sector": "Tech", "diversification_score": 5},
        "after": {"total_value_estimate": 1200, "risk_level": "Alto", "top_sector": "Tech", "diversification_score": 4},
        "impacts": [],
        "pros": [], "cons": [],
        "mentor_verdict": mentor_verdict,
        "recommendation": "proceder_con_cautela",
    }


async def test_clean_response_passes_through_without_a_retry_call(monkeypatch):
    call_count = {"n": 0}

    async def fake_claude(**kwargs):
        call_count["n"] += 1
        return _FakeResponse(json.dumps(_base_result("Este cambio aumentaría la concentración tecnológica del portafolio.")))

    monkeypatch.setattr(ai_service, "_claude", fake_claude)
    monkeypatch.setattr(ai_service, "log_llm_usage", _noop_log_llm_usage)

    result = await ai_service.simulate_whatif("swap", {"sell_ticker": "KO", "buy_ticker": "NVDA"}, [])
    assert call_count["n"] == 1  # no corrective retry needed
    assert not has_prescriptive_language(result["mentor_verdict"])
    # recommendation stays untouched — it's the frontend's fixed category badge, not personalized prose
    assert result["recommendation"] == "proceder_con_cautela"


async def test_violation_triggers_one_corrective_retry_that_fixes_it(monkeypatch):
    calls = []

    async def fake_claude(**kwargs):
        calls.append(kwargs["messages"][0]["content"])
        if len(calls) == 1:
            return _FakeResponse(json.dumps(_base_result("Deberías comprar NVDA con ese dinero.")))
        # Corrective retry returns a clean version
        return _FakeResponse(json.dumps(_base_result("Este cambio aumentaría la concentración tecnológica.")))

    monkeypatch.setattr(ai_service, "_claude", fake_claude)
    monkeypatch.setattr(ai_service, "log_llm_usage", _noop_log_llm_usage)

    result = await ai_service.simulate_whatif("swap", {"sell_ticker": "KO", "buy_ticker": "NVDA"}, [])
    assert len(calls) == 2  # exactly one corrective retry, not a loop
    assert not has_prescriptive_language(result["mentor_verdict"])
    assert "Deberías comprar" not in result["mentor_verdict"]


async def test_violation_surviving_the_retry_falls_back_to_deterministic_strip(monkeypatch, caplog):
    async def fake_claude(**kwargs):
        # Both the original call AND the corrective retry still violate —
        # must never loop a second time, must never surface prescriptive
        # text to the caller.
        return _FakeResponse(json.dumps(_base_result(
            "NVDA tiene buenos fundamentos. Deberías comprar más ahora. El margen es alto."
        )))

    monkeypatch.setattr(ai_service, "_claude", fake_claude)
    monkeypatch.setattr(ai_service, "log_llm_usage", _noop_log_llm_usage)

    result = await ai_service.simulate_whatif("swap", {"sell_ticker": "KO", "buy_ticker": "NVDA"}, [])
    assert not has_prescriptive_language(result["mentor_verdict"])
    assert "buenos fundamentos" in result["mentor_verdict"]  # clean sentences preserved
    assert "Deberías comprar" not in result["mentor_verdict"]


async def test_corrective_retry_call_failing_still_returns_a_safe_result(monkeypatch):
    # If the corrective regeneration call itself raises (network blip, rate
    # limit), the function must still degrade to the deterministic strip
    # rather than propagate the exception or leak the original violation.
    async def fake_claude(**kwargs):
        if "Tu respuesta anterior" in kwargs["messages"][0]["content"]:
            raise RuntimeError("simulated transient failure")
        return _FakeResponse(json.dumps(_base_result("Deberías vender toda tu posición ya.")))

    monkeypatch.setattr(ai_service, "_claude", fake_claude)
    monkeypatch.setattr(ai_service, "log_llm_usage", _noop_log_llm_usage)

    result = await ai_service.simulate_whatif("swap", {"sell_ticker": "KO", "buy_ticker": "NVDA"}, [])
    assert not has_prescriptive_language(result["mentor_verdict"])
