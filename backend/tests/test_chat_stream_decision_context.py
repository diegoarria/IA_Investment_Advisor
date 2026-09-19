"""
Integration test — chat_stream()'s wiring of the new Decision Context /
Portfolio Truth block (decision_engine.py) into the real system prompt sent
to Claude, plus the post-stream Recommendation Guard telemetry.

Mocks `client.messages.stream` (the Anthropic SDK's async streaming context
manager) rather than `_claude()`, since chat_stream calls the client
directly for streaming — same boundary chosen for anything that needs to
inspect what actually reached the model. Verifies:

1. The Decision Context block (with real Portfolio Truth numbers, market-
   value-weighted) is present in the `system` param passed to the real API
   call — this is the actual "did the wiring happen" check, not a proxy.
2. chat_stream still yields text chunks in order (streaming behavior
   unchanged by the new optional params).
3. A response containing prescriptive language is caught by the guard and
   logged (not blocked — see ai_service.py's comment on why chat_stream
   can't retroactively fix an already-streamed response), while a clean
   response logs nothing.
4. Existing callers that don't pass positions/quotes (e.g. voice_call.py)
   still work — backward compatibility of the new optional params.
"""
import logging

import pytest

import app.services.ai_service as ai_service
from app.models.user import ChatMessage, UserProfile


class _FakeUsage:
    input_tokens = 100
    output_tokens = 50


class _FakeFinalMessage:
    def __init__(self, stop_reason="end_turn"):
        self.usage = _FakeUsage()
        self.stop_reason = stop_reason
        self.content = []


class _FakeStream:
    def __init__(self, chunks: list[str]):
        self._chunks = chunks

    @property
    async def text_stream(self):
        for c in self._chunks:
            yield c

    async def get_final_message(self):
        return _FakeFinalMessage()


class _FakeStreamContextManager:
    """Mimics `client.messages.stream(...)` — an async context manager
    whose __aenter__ returns the stream object, capturing the kwargs it
    was called with so the test can inspect the real system prompt."""
    captured_kwargs: dict = {}

    def __init__(self, chunks: list[str], **kwargs):
        self._chunks = chunks
        _FakeStreamContextManager.captured_kwargs = kwargs

    async def __aenter__(self):
        return _FakeStream(self._chunks)

    async def __aexit__(self, *exc):
        return False


def _install_fake_stream(monkeypatch, chunks: list[str]):
    def fake_stream(**kwargs):
        return _FakeStreamContextManager(chunks, **kwargs)

    monkeypatch.setattr(ai_service.client.messages, "stream", fake_stream)
    monkeypatch.setattr(ai_service, "check_daily_spend_cap", lambda: None)


async def _collect(async_gen):
    return "".join([chunk async for chunk in async_gen])


async def test_decision_context_and_portfolio_truth_reach_the_real_system_prompt(monkeypatch):
    _install_fake_stream(monkeypatch, ["Todo bien con tu portafolio."])

    positions = [{"ticker": "NVDA", "shares": 50, "avg_price": 100.0}, {"ticker": "OTHER", "shares": 50, "avg_price": 100.0}]
    quotes = {"NVDA": {"price": 100.0}, "OTHER": {"price": 100.0}}

    result = await _collect(ai_service.chat_stream(
        message="¿Compro más NVDA?",
        conversation_history=[],
        profile=None,
        positions=positions,
        quotes=quotes,
    ))
    assert result == "Todo bien con tu portafolio."

    system_blocks = _FakeStreamContextManager.captured_kwargs["system"]
    full_system_text = "\n".join(b["text"] for b in system_blocks)
    assert "DECISION CONTEXT" in full_system_text
    assert "PORTFOLIO TRUTH" in full_system_text
    # NVDA and OTHER have equal cost basis and equal price -> 50/50 by
    # market value; this is the concentration fact Arthur must reason from.
    assert "peso actual del portafolio: 50.0%" in full_system_text


async def test_chat_stream_backward_compatible_without_positions_or_quotes(monkeypatch):
    # voice_call.py and other pre-existing callers never pass positions/
    # quotes — this must still work exactly as before, just with an
    # "unknown" Decision Context block instead of a populated one.
    _install_fake_stream(monkeypatch, ["Hola, ¿en qué te ayudo?"])
    result = await _collect(ai_service.chat_stream(
        message="hola",
        conversation_history=[],
        profile=None,
    ))
    assert result == "Hola, ¿en qué te ayudo?"
    system_blocks = _FakeStreamContextManager.captured_kwargs["system"]
    full_system_text = "\n".join(b["text"] for b in system_blocks)
    assert "DECISION CONTEXT" in full_system_text
    assert "DESCONOCIDO" in full_system_text  # no data given -> honestly says so, never invents


async def test_streaming_still_yields_chunks_in_order(monkeypatch):
    _install_fake_stream(monkeypatch, ["Uno", " dos", " tres"])
    result = await _collect(ai_service.chat_stream(
        message="hola", conversation_history=[], profile=None,
    ))
    assert result == "Uno dos tres"


async def test_prescriptive_response_gets_same_turn_correction(monkeypatch, caplog):
    # chat_stream cannot retroactively fix an already-streamed response
    # (see the comment in ai_service.py) — the original flagged text still
    # reaches the caller in full (never silently truncated or replaced).
    # But 2026-09-19: a real violation ("yo priorizaría...") reached a user
    # in production despite NIVEL 1 explicitly banning that exact phrase —
    # logging alone wasn't good enough, so a visible same-turn
    # self-correction is now appended right after the flagged response.
    _install_fake_stream(monkeypatch, ["Deberías comprar más NVDA ahora mismo."])
    with caplog.at_level(logging.WARNING):
        result = await _collect(ai_service.chat_stream(
            message="¿Compro más NVDA?", conversation_history=[], profile=None,
        ))
    assert result.startswith("Deberías comprar más NVDA ahora mismo.")  # original text untouched
    assert "Corrección:" in result  # same-turn self-correction appended
    assert any("appending same-turn correction" in r.message for r in caplog.records)


async def test_clean_response_logs_no_guard_warning(monkeypatch, caplog):
    _install_fake_stream(monkeypatch, ["NVDA tiene un margen bruto de 75%."])
    with caplog.at_level(logging.WARNING):
        result = await _collect(ai_service.chat_stream(
            message="¿Cómo va NVDA?", conversation_history=[], profile=None,
        ))
    assert not any("recommendation guard flagged" in r.message for r in caplog.records)
    assert "Corrección:" not in result and "Correction:" not in result


async def test_unanswered_first_message_still_intercepted_on_short_followup(monkeypatch):
    """Third real production failure, same day (2026-09-19): Diego's first
    message ("Arthur tienes recomendaciones para mi?") got no response at
    all, he sent a bare "?" as a follow-up, and THAT call answered with a
    full recommendation. Two bugs: (a) "tienes recomendaciones para mi"
    wasn't in the trigger regex at all, and (b) even once added, the
    intercept only checked the CURRENT message ("?"), never the unanswered
    trigger still sitting as the last entry in conversation_history.
    Confirms both are fixed — the bare "?" follow-up is intercepted, using
    never installing a fake stream to prove the model is never called."""
    unanswered = [ChatMessage(role="user", content="Arthur tienes recomendaciones para mi?")]
    result = await _collect(ai_service.chat_stream(
        message="?", conversation_history=unanswered, profile=None,
    ))
    assert "MSFT" not in result and "GOOGL" not in result and "NVDA" not in result
    assert "elegir por ti" in result.lower() or "picking for you" in result.lower()


async def test_guardrails_still_apply_on_a_later_turn_after_an_earlier_bad_one(monkeypatch):
    """Diego, 2026-09-19: 'no importa si Arthur se buguea en el primer
    mensaje — en el segundo, tercero, cuarto, etc. siguen aplicando las
    mismas prohibiciones.' chat_stream has no turn-number branching — the
    blind-recommendation intercept and the same-turn correction both run
    on every single call regardless of what's already in
    conversation_history. Simulates turn 1 already having a bad
    recommendation baked into the history (as if it had slipped through),
    then turn 2's own model response also violates the rule — confirms
    turn 2 still gets caught and corrected on its own, independently."""
    prior_bad_turn = [
        ChatMessage(role="user", content="me das una recomendación de donde invertir?"),
        ChatMessage(role="assistant", content="Yo priorizaría MSFT, GOOGL y NVDA para tu perfil."),
    ]
    _install_fake_stream(monkeypatch, ["Entre esas, mi top pick sería NVDA por el momentum de IA."])
    result = await _collect(ai_service.chat_stream(
        message="¿y de esas cuál eliges tú?",
        conversation_history=prior_bad_turn, profile=None,
    ))
    assert result.startswith("Entre esas, mi top pick sería NVDA")
    assert "Corrección:" in result  # turn 2 corrected on its own merits, not skipped


async def test_blind_recommendation_intercept_also_fires_on_turn_three(monkeypatch):
    """Same guarantee as above, but for the deterministic intercept
    specifically (not just the same-turn correction) — it only looks at
    the CURRENT message, never at conversation_history, so a trigger
    phrase on turn 3 is caught exactly the same as on turn 1."""
    long_history = [
        ChatMessage(role="user", content="Hola Arthur"),
        ChatMessage(role="assistant", content="¡Hola! ¿En qué te ayudo hoy?"),
        ChatMessage(role="user", content="¿Cómo va mi portafolio?"),
        ChatMessage(role="assistant", content="Tu portafolio subió 3% esta semana."),
    ]
    result = await _collect(ai_service.chat_stream(
        message="ok, entonces dame tu top 5",
        conversation_history=long_history, profile=None,
    ))
    assert "elegir por ti" in result.lower() or "picking for you" in result.lower()


async def test_blind_recommendation_request_never_reaches_the_model(monkeypatch):
    """Second real production failure, same day (2026-09-19): Diego asked
    Arthur literally "me das una recomendación de donde invertir?" and got
    a ranked stock list with per-ticker rationale and an offer to propose
    "una distribución exacta" — NIVEL 0's scripted redirect never fired.
    For this exact, high-stakes, very common trigger, chat_stream now
    answers deterministically from code without ever calling the model —
    confirmed here by never installing a fake stream at all, so if the
    code took the LLM path this test would error on a missing mock."""
    result = await _collect(ai_service.chat_stream(
        message="me das una recomendación de donde invertir?",
        conversation_history=[], profile=None,
    ))
    assert result  # got the deterministic redirect, not an error
    assert "MSFT" not in result and "GOOGL" not in result and "NVDA" not in result
    assert "elegir por ti" in result.lower() or "picking for you" in result.lower()


async def test_blind_recommendation_variants_all_intercepted(monkeypatch):
    from app.services.ai_service import _blind_recommendation_reply
    variants = [
        "¿Qué me recomiendas comprar?", "Dame una recomendación",
        "¿En qué debería invertir?", "Dame tu top 5", "Hazme un portafolio",
        "¿Qué harías con $10,000?", "What do you recommend I buy?",
        "Give me your top picks", "Recomiéndame un buen ETF para empezar",
    ]
    for text in variants:
        assert _blind_recommendation_reply(text) is not None, f"should intercept: {text!r}"


async def test_named_company_request_still_goes_to_the_model(monkeypatch):
    """The NIVEL 0 'special case' (a specific company IS named) must keep
    going through the normal deep-dive flow, not the blind-recommendation
    redirect — confirmed here since a fake stream IS required for this one."""
    _install_fake_stream(monkeypatch, ["Aquí está el análisis de Tesla..."])
    result = await _collect(ai_service.chat_stream(
        message="¿Me recomiendas Tesla?", conversation_history=[], profile=None,
    ))
    assert result == "Aquí está el análisis de Tesla..."


async def test_unrelated_recomiendame_request_not_intercepted(monkeypatch):
    """A non-financial 'recomiéndame' (e.g. a book) must not get the
    investment redirect."""
    from app.services.ai_service import _blind_recommendation_reply
    assert _blind_recommendation_reply("Recomiéndame un libro de finanzas") is None


async def test_real_production_failure_yo_priorizaria_gets_corrected(monkeypatch):
    """Reproduces the exact real-world failure Diego reported (2026-09-19):
    a ranked stock list closing with "yo priorizaría" reached a live user
    despite that exact phrase being explicitly banned in NIVEL 1. Confirms
    it's now caught and corrected in the same turn."""
    flagged_reply = (
        "Como ya tienes varias de estas en cartera, yo priorizaría:\n\n"
        "MSFT\nGOOGL\nAMZN\nMETA\nASML o MELI si quieres más crecimiento"
    )
    _install_fake_stream(monkeypatch, [flagged_reply])
    result = await _collect(ai_service.chat_stream(
        message="Dame una lista según mi perfil agresivo de largo plazo",
        conversation_history=[], profile=None,
    ))
    assert result.startswith(flagged_reply)
    assert "Corrección:" in result


async def test_english_profile_gets_english_correction(monkeypatch):
    en_profile = UserProfile(
        id="p1", user_id="u1", name="Test", risk_tolerance="moderate",
        preferred_language="en",
    )
    _install_fake_stream(monkeypatch, ["I would prioritize NVDA and MSFT."])
    result = await _collect(ai_service.chat_stream(
        message="How is NVDA doing this week?", conversation_history=[], profile=en_profile,
    ))
    assert "Correction:" in result
    assert "Corrección:" not in result


async def test_opinion_about_named_company_is_verified_before_display(monkeypatch):
    """Fourth real production failure report, same day (2026-09-19): a
    named-company opinion question ("¿me lo recomiendas?", "¿debería
    comprar X?") relied only on the after-the-fact correction, which
    still shows the original flagged text to the user before the note.
    For this narrower, highest-risk combination (opinion-seeking language
    + a named ticker), the response is now buffered and verified BEFORE
    ever reaching the user — a violation is stripped, never just noted."""
    flagged_reply = (
        "NVDA tiene un ROIC excelente y un moat fuerte en chips de IA. "
        "Deberías comprar NVDA ahora mismo. El resto del negocio también luce sólido."
    )
    _install_fake_stream(monkeypatch, [flagged_reply])
    result = await _collect(ai_service.chat_stream(
        message="¿Debería comprar NVDA?", conversation_history=[], profile=None,
    ))
    assert "Deberías comprar NVDA" not in result  # never reached the user
    assert "ROIC excelente" in result  # legitimate analysis sentence preserved
    assert "resto del negocio también luce sólido" in result


async def test_opinion_about_named_company_streams_live_when_clean(monkeypatch):
    """Buffered mode must not alter a genuinely clean response — it's
    still yielded in full (just not token-by-token), never modified."""
    clean_reply = "NVDA tiene un ROIC de 45% y margen operativo de 60%. Los datos hablan por sí solos."
    _install_fake_stream(monkeypatch, [clean_reply])
    result = await _collect(ai_service.chat_stream(
        message="¿Debería comprar NVDA?", conversation_history=[], profile=None,
    ))
    assert result == clean_reply


async def test_pure_fundamentals_request_still_streams_live_not_buffered(monkeypatch):
    """A plain numbers/fundamentals request about a named company (no
    opinion-seeking language) must NOT go through buffered verification —
    it should stream normally like any other message."""
    _install_fake_stream(monkeypatch, ["TSLA", " tiene", " un P/E de 45x."])
    result = await _collect(ai_service.chat_stream(
        message="dame los números de Tesla", conversation_history=[], profile=None,
    ))
    assert result == "TSLA tiene un P/E de 45x."


async def test_stem_changing_recomendar_conjugations_are_intercepted(monkeypatch):
    """Fifth real production failure, same day (2026-09-19): "me puedes
    recomendar acciones?" reached the model untouched. Root cause:
    "recomendar" is a Spanish stem-changing verb (recomEND-ar but
    recomIEND-o/as/a/…) — a plain "recomend\\w*" stem regex NEVER matches
    the present-tense/imperative conjugations actually used in casual
    speech ("recomiendas", "recomiéndame"). Covers both stems now,
    reproduced here with the exact reported phrase plus other
    conjugations that were silently missed before."""
    from app.services.ai_service import _blind_recommendation_reply
    variants = [
        "hola arthur, me puedes recomendar acciones?",
        "dame una recomendacion de en que invertir",  # no accents, as actually typed
        "podrías recomendarme algo",
        "qué me recomendarías",
        "recomiéndame algo para invertir",
    ]
    for text in variants:
        assert _blind_recommendation_reply(text) is not None, f"should intercept: {text!r}"


async def test_named_company_opinion_uses_conjugated_recomendar_too(monkeypatch):
    """Same stem-changing-verb bug, but for the buffered/named-company
    path (_needs_buffered_verification) — "me recomiendas comprar Tesla?"
    must trigger buffered verification, not slip through untouched."""
    assert ai_service._needs_buffered_verification("me recomiendas comprar Tesla?")


async def test_code_level_guard_catches_conjugated_recomendar_forms():
    """The same stem-changing-verb bug also affected decision_engine.py's
    blanket word-ban (added earlier today) — "recomiendo"/"recomiendas"/
    "recomienda" were never actually caught by a plain "recomend\\w*"
    stem, silently defeating that whole guardrail for the most common
    conversational forms of the verb."""
    from app.services.decision_engine import check_recommendation_guard as g
    for text in ["Recomiendo esto.", "Te recomiendas algo.", "Le recomienda comprar.", "Recomiéndame X."]:
        assert g(text), f"should flag: {text!r}"


async def test_detect_tickers_word_boundary_fix_no_longer_false_positives():
    """Real bug found while fixing the above: detect_tickers's company-
    name dict lookup used a raw substring check, so "arm" (Arm Holdings)
    matched inside "recomend-ARM-e" ("recomendarme"), silently misrouting
    an unrelated message as if the user had named that company. Fixed to
    a word-boundary match; confirmed legitimate matches (including short
    ones like "arm") still work."""
    from app.services.market_data_service import detect_tickers
    assert detect_tickers("podrías recomendarme algo") == []
    assert detect_tickers("qué opinas de arm holdings?") == ["ARM"]
    assert detect_tickers("me gusta comer pineapple") == []
    assert detect_tickers("qué opinas de apple?") == ["AAPL"]


async def test_false_transaction_claim_without_tool_call_gets_flagged(monkeypatch):
    """Real production failure, 2026-09-19: Arthur told a user "Registrado,
    Diego: 3 acciones de Google a $343.58..." after they confirmed a
    proposed purchase — verified directly in Supabase that
    confirm_pending_financial_action was never actually called that turn
    (the pending_financial_actions row was still status='pending', never
    'applied'). The model claimed success without the tool call that
    would have made it true. Reproduces the exact reported text with NO
    tool_use in the fake response (confirm_pending_financial_action never
    called) and confirms a visible warning gets appended."""
    claimed_success = (
        "Registrado, Diego: 3 acciones de Google a $343.58 el 18 de septiembre de 2026.\n\n"
        "Esto no es recomendación de compra o venta."
    )
    _install_fake_stream(monkeypatch, [claimed_success])
    result = await _collect(ai_service.chat_stream(
        message="sí, confírmalo", conversation_history=[], profile=None,
    ))
    assert result.startswith(claimed_success)
    assert "no llegué a confirmar esa operación con el sistema todavía" in result


async def test_false_transaction_claim_across_multiple_lines_gets_flagged(monkeypatch):
    """Second real occurrence, same day: the FIRST fix for this only
    matched the success word and the transaction details when they sat on
    the SAME line — but Diego's actual second report showed Arthur's real
    reply puts them on separate lines ("Registrado, Diego:\n\nGOOGL: 3
    acciones\n..."), which the old `[^.\\n]{0,100}` gap (explicitly
    excluding newlines) could never span. Reproduces that exact multi-
    line shape."""
    claimed_success = (
        "Registrado, Diego:\n\n"
        "GOOGL: 3 acciones\n"
        "Precio de compra: $343.58\n"
        "Monto total invertido: $1,030.74\n\n"
        "Si quieres, también puedo ayudarte a llevar un registro de precio "
        "promedio, valor actual y ganancia/pérdida no realizada de tus posiciones."
    )
    _install_fake_stream(monkeypatch, [claimed_success])
    result = await _collect(ai_service.chat_stream(
        message="si", conversation_history=[], profile=None,
    ))
    assert result.startswith(claimed_success)
    assert "no llegué a confirmar esa operación con el sistema todavía" in result


async def test_false_transaction_claim_detector_unit():
    """Direct unit coverage of _false_transaction_claim's two branches —
    the full chat_stream integration test above only exercises the "tool
    never called" path; this locks in that a genuine confirm.. call
    correctly suppresses the warning, and that an unrelated use of
    "registrado" never false-positives."""
    from app.services.ai_service import _false_transaction_claim
    claim_text = "Registrado, Diego: 3 acciones de Google a $343.58."
    assert _false_transaction_claim(claim_text, set()) is True
    assert _false_transaction_claim(claim_text, {"confirm_pending_financial_action"}) is False
    assert _false_transaction_claim("El crecimiento registrado el último trimestre fue de 16.7%.", set()) is False


async def test_conversation_history_still_forwarded_correctly(monkeypatch):
    _install_fake_stream(monkeypatch, ["ok"])
    history = [ChatMessage(role="user", content="hola"), ChatMessage(role="assistant", content="hola, ¿en qué ayudo?")]
    await _collect(ai_service.chat_stream(
        message="¿y ahora?", conversation_history=history, profile=None,
    ))
    messages = _FakeStreamContextManager.captured_kwargs["messages"]
    assert messages[0] == {"role": "user", "content": "hola"}
    assert messages[1] == {"role": "assistant", "content": "hola, ¿en qué ayudo?"}
    assert messages[-1] == {"role": "user", "content": "¿y ahora?"}
