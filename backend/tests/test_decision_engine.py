"""
Tests — app.services.decision_engine (Decision Context / Portfolio Truth /
Recommendation Guard layer added on top of Arthur's existing prompt-driven
mentor in ai_service.py).

Pure-function, no network, no LLM calls — mirrors the deterministic pieces
of the spec (portfolio math, decision-state/guard regex classification).
The genuinely open-ended pieces (actual scenario prose, alternative
comparison) stay LLM-driven by design (see decision_engine.py's module
docstring) and aren't unit-tested here — they're covered by the existing
prompt content in SYSTEM_PROMPT_BASE plus manual/production verification.

Covers, from the spec's TEST 1-12 list, the ones that are genuinely
deterministic:
- TEST 5 (cost basis != market value -> current_weight uses market value)
- TEST 11 (Recommendation Guard: prescriptive vs. descriptive language)
- TEST 12 (missing data is never invented)
plus decision-state inference (used for TEST 2/3/6 in spirit — verifying
the classifier reads the FOMO/urgency/comparison signal correctly, since
the actual non-prescriptive response text itself is model-generated).
"""
from app.services.decision_engine import (
    DecisionState,
    PositionTruth,
    aggregate_positions_by_ticker,
    build_decision_context,
    check_recommendation_guard,
    compute_portfolio_truth,
    has_prescriptive_language,
    infer_decision_state,
    strip_prescriptive_sentences,
)


# ──────────────────────────────────────────────────────────────
# Portfolio Truth — TEST 5: current_weight must use market value, not cost.
# ──────────────────────────────────────────────────────────────

def test_current_weight_uses_market_value_not_cost_basis():
    # Two positions with equal cost basis ($10,000 each) but wildly
    # different market performance — NVDA tripled, KO is flat. If weight
    # were computed from cost basis, both would show 50%. It must not.
    positions = [
        {"ticker": "NVDA", "shares": 100, "avg_price": 100.0},  # cost basis $10,000
        {"ticker": "KO", "shares": 100, "avg_price": 100.0},    # cost basis $10,000
    ]
    quotes = {
        "NVDA": {"price": 300.0},  # market value $30,000
        "KO": {"price": 100.0},    # market value $10,000
    }
    rows = compute_portfolio_truth(positions, quotes)
    by_ticker = {r.ticker: r for r in rows}

    assert by_ticker["NVDA"].cost_basis == 10_000.0
    assert by_ticker["NVDA"].market_value == 30_000.0
    assert by_ticker["KO"].cost_basis == 10_000.0
    assert by_ticker["KO"].market_value == 10_000.0

    # Total market value = $40,000 -> NVDA is 75%, KO is 25%. A cost-basis
    # calculation would have given 50/50 — this is the exact bug class the
    # spec calls out (section 5).
    assert by_ticker["NVDA"].current_weight_pct == 75.0
    assert by_ticker["KO"].current_weight_pct == 25.0
    assert by_ticker["NVDA"].unrealized_pnl == 20_000.0
    assert by_ticker["NVDA"].unrealized_return_pct == 200.0
    assert by_ticker["KO"].unrealized_pnl == 0.0


def test_portfolio_truth_falls_back_to_cost_basis_weight_when_quote_missing():
    # If we don't have a live quote for even one position, weighting must
    # NOT silently mix market-value for some and cost-basis for others —
    # it falls back to cost-basis weighting for all, and callers can tell
    # via current_price is None which rows lack a real quote.
    positions = [
        {"ticker": "NVDA", "shares": 100, "avg_price": 100.0},
        {"ticker": "OBSCURETICKER", "shares": 50, "avg_price": 20.0},
    ]
    quotes = {"NVDA": {"price": 300.0}}  # no quote for the second ticker
    rows = compute_portfolio_truth(positions, quotes)
    by_ticker = {r.ticker: r for r in rows}

    assert by_ticker["NVDA"].market_value == 30_000.0
    assert by_ticker["OBSCURETICKER"].market_value is None
    assert by_ticker["OBSCURETICKER"].current_price is None
    # Fallback weighting uses cost basis: NVDA cost=10,000, OBSCURE cost=1,000
    total_cost = 10_000.0 + 1_000.0
    assert by_ticker["NVDA"].current_weight_pct == round(10_000 / total_cost * 100, 1)


def test_lots_are_aggregated_by_ticker_before_weighting():
    # A ticker bought twice must read as ONE holding, not two half-sized
    # ones — aggregate_positions_by_ticker's whole reason for existing.
    positions = [
        {"ticker": "NVDA", "shares": 50, "avg_price": 80.0},
        {"ticker": "NVDA", "shares": 50, "avg_price": 120.0},
    ]
    agg = aggregate_positions_by_ticker(positions)
    assert len(agg) == 1
    assert agg[0]["shares"] == 100
    assert agg[0]["avg_price"] == 100.0  # shares-weighted average of 80 and 120


def test_empty_positions_produce_empty_portfolio_truth():
    assert compute_portfolio_truth([], {}) == []
    assert compute_portfolio_truth([], None) == []


# ──────────────────────────────────────────────────────────────
# Recommendation Guard — TEST 11: prescriptive vs. descriptive language.
# ──────────────────────────────────────────────────────────────

def test_guard_flags_direct_prescriptive_spanish():
    assert has_prescriptive_language("Deberías comprar VOO ahora mismo.")
    assert has_prescriptive_language("Te recomiendo invertir en NVDA.")
    assert has_prescriptive_language("Mi recomendación es VTI.")
    assert has_prescriptive_language("Lo mejor para ti es esperar.")
    assert has_prescriptive_language("Yo compraría más NVDA aquí.")


def test_guard_flags_direct_prescriptive_english():
    assert has_prescriptive_language("You should buy NVDA before it goes up more.")
    assert has_prescriptive_language("I recommend investing in an S&P 500 ETF.")
    assert has_prescriptive_language("The best option for you is to wait.")
    assert has_prescriptive_language("I would sell that position.")


def test_guard_allows_descriptive_analysis_spanish():
    # Uses the infinitive "comprar", not the imperative "compra" — this is
    # exactly the section-16 example the spec calls out as a false positive
    # to avoid.
    assert not has_prescriptive_language(
        "Comprar acciones individuales implica mayor riesgo que un ETF diversificado."
    )
    assert not has_prescriptive_language(
        "Vender una posición ganadora puede generar un impuesto sobre la ganancia de capital."
    )
    assert not has_prescriptive_language(
        "Invertir en bienes raíces requiere más capital inicial que abrir una cuenta de inversión."
    )


def test_guard_allows_descriptive_analysis_english():
    assert not has_prescriptive_language(
        "Buying individual stocks carries more company-specific risk than a diversified ETF."
    )
    assert not has_prescriptive_language(
        "Selling a winning position can trigger a capital gains tax."
    )


def test_guard_returns_matched_phrases():
    matches = check_recommendation_guard("Deberías vender esa posición ya. Te recomiendo NVDA en su lugar.")
    assert len(matches) == 2


def test_guard_clean_text_returns_empty_list():
    assert check_recommendation_guard("") == []
    assert check_recommendation_guard(None) == []
    assert check_recommendation_guard("El P/E de la empresa es 25x.") == []


def test_strip_prescriptive_sentences_removes_only_the_bad_sentence():
    text = (
        "NVDA tiene un margen bruto de 75%. Deberías comprar más ahora. "
        "El crecimiento de ingresos fue de 40% interanual."
    )
    result = strip_prescriptive_sentences(text)
    assert not has_prescriptive_language(result)
    assert "margen bruto" in result
    assert "crecimiento de ingresos" in result
    assert "Deberías comprar" not in result


def test_strip_prescriptive_sentences_noop_on_clean_text():
    text = "NVDA tiene un margen bruto de 75%."
    assert strip_prescriptive_sentences(text) == text


# ──────────────────────────────────────────────────────────────
# Decision State inference
# ──────────────────────────────────────────────────────────────

def test_infers_executing_state_from_committed_language():
    assert infer_decision_state("Voy a comprar 10 acciones de NVDA hoy") == DecisionState.EXECUTING
    assert infer_decision_state("I just bought some TSLA") == DecisionState.EXECUTING


def test_infers_deciding_state_from_urgency_language():
    # TEST 6 spirit: FOMO/urgency language ("subió 15%, ¿compro antes de que
    # siga subiendo?") should read as DECIDING, not EXPLORING — this drives
    # how much Arthur should ask vs. answer, never a guardrail block.
    state = infer_decision_state("NVDA subió 15%, ¿compro antes de que siga subiendo?")
    assert state == DecisionState.DECIDING


def test_infers_comparing_state():
    assert infer_decision_state("¿Qué es mejor, VOO o QQQ para mi portafolio?") == DecisionState.COMPARING


def test_infers_evaluating_state_for_company_analysis_request():
    assert infer_decision_state("Analízame Tesla a fondo") == DecisionState.EVALUATING


def test_defaults_to_exploring_when_no_signal_matches():
    assert infer_decision_state("Hola, ¿cómo estás?") == DecisionState.EXPLORING
    assert infer_decision_state("") == DecisionState.EXPLORING


# ──────────────────────────────────────────────────────────────
# DecisionContext — TEST 12: never invent missing data.
# ──────────────────────────────────────────────────────────────

def test_decision_context_never_invents_unknown_fields():
    ctx = build_decision_context(message="Hola", profile=None, positions=None, quotes=None)
    assert ctx.available_capital is None
    assert ctx.purpose is None
    assert ctx.country is None
    assert ctx.monthly_income is None
    assert ctx.risk_tolerance is None
    assert ctx.portfolio == []
    # The rendered prompt block must say debt is unavailable rather than
    # silently omitting it or implying zero debt.
    block = ctx.to_prompt_block()
    assert "NO HAY DATOS ESTRUCTURADOS DE DEUDA" in block
    assert "DESCONOCIDO" in block


def test_decision_context_extracts_capital_mentioned_in_message():
    ctx = build_decision_context(message="Tengo $50,000 MXN, ¿dónde los invierto?", profile=None)
    assert ctx.available_capital == 50_000.0
    assert ctx.currency == "MXN"
    assert ctx.decision_state == DecisionState.EXPLORING


def test_decision_context_does_not_misread_unrelated_numbers_as_capital():
    # A ticker's price mentioned in conversation must not be misread as
    # "available capital" — the extraction regex requires an explicit
    # "tengo/i have" phrasing, not just any number in the message.
    ctx = build_decision_context(message="NVDA está en $185 ahora mismo", profile=None)
    assert ctx.available_capital is None


def test_decision_context_includes_portfolio_truth_when_positions_given():
    positions = [{"ticker": "NVDA", "shares": 10, "avg_price": 100.0}]
    quotes = {"NVDA": {"price": 150.0}}
    ctx = build_decision_context(message="¿Compro más NVDA?", positions=positions, quotes=quotes)
    assert len(ctx.portfolio) == 1
    assert ctx.portfolio[0].current_weight_pct == 100.0
    block = ctx.to_prompt_block()
    assert "PORTFOLIO TRUTH" in block
    assert "NVDA" in block


def test_decision_context_concentration_is_visible_for_test_4():
    # TEST 4 spirit: a position at 22% of the portfolio must be
    # identifiable directly from the rendered block (Arthur reasons about
    # concentration from this fact, never a personalized recommendation).
    positions = [
        {"ticker": "NVDA", "shares": 22, "avg_price": 100.0},
        {"ticker": "OTHER", "shares": 78, "avg_price": 100.0},
    ]
    quotes = {"NVDA": {"price": 100.0}, "OTHER": {"price": 100.0}}
    ctx = build_decision_context(message="¿Compro más NVDA?", positions=positions, quotes=quotes)
    nvda = next(p for p in ctx.portfolio if p.ticker == "NVDA")
    assert nvda.current_weight_pct == 22.0
