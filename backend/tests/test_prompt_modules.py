"""Prompt modularization (COGS work, Sep 2026) — see app/services/prompt_modules.py.

The invariants that matter: (1) splitting never loses or alters a single
character of the base prompt, (2) the sections Arthur's safety behavior
depends on stay in CORE, (3) the module selector errs toward including a
module, and always includes everything when it can't tell."""
import re

import pytest

import app.services.ai_service as ai
from app.models.user import ChatMessage
from app.services import prompt_modules as pm


def test_split_is_lossless():
    base = ai.SYSTEM_PROMPT_BASE
    core, modules = pm.split_prompt(base)
    sections = [s for s in pm._SECTION_SPLIT_RE.split(base) if s]
    rebuilt = []
    remaining = {m: list(pm._SECTION_SPLIT_RE.split(t)) for m, t in modules.items()}
    for s in sections:
        m = pm._module_for_section(s)
        rebuilt.append(s)
    assert "".join(rebuilt) == base
    total = len(core) + sum(len(t) for t in modules.values())
    assert total == len(base)


def test_every_module_header_actually_exists():
    """A renamed header would silently move a module's text back into CORE
    (safe, but it would quietly erase the savings) — fail loudly instead."""
    _, modules = pm.split_prompt(ai.SYSTEM_PROMPT_BASE)
    assert set(modules) == set(pm.ALL_MODULES)
    for prefix, _m in pm._SECTION_MODULE:
        assert prefix in ai.SYSTEM_PROMPT_BASE, prefix


@pytest.mark.parametrize("must_stay_core", [
    "REGLA CENTRAL DE NUVOS", "NIVEL 0", "NIVEL 1", "NIVEL 3", "TRES BLOQUEOS ABSOLUTOS",
    "LO QUE NUNCA DEBES HACER", "DIAGNÓSTICO CONDUCTUAL", "NIVEL 4 — VERIFICACIÓN DE DATOS",
])
def test_safety_sections_stay_in_core(must_stay_core):
    core, modules = pm.split_prompt(ai.SYSTEM_PROMPT_BASE)
    header = re.compile(rf"(?m)^## .*{re.escape(must_stay_core)}")
    assert header.search(core)
    assert not any(header.search(t) for t in modules.values())


def test_no_raw_message_or_images_sends_everything():
    assert pm.select_modules(None) == pm.ALL_MODULES
    assert pm.select_modules("   ") == pm.ALL_MODULES
    assert pm.select_modules("hola", has_images=True) == pm.ALL_MODULES


@pytest.mark.parametrize("msg,expected", [
    ("Analiza Micron a fondo", "analysis"),
    ("¿Es buena compra AAPL?", "analysis"),
    ("compré 3 acciones de Google a $343", "transactions"),
    ("elimina AAPL de mi portafolio", "transactions"),
    ("tengo $10,000 ahorrados, ¿qué hago?", "capital"),
    ("¿por qué cayó Tesla hoy?", "news"),
    ("¿por qué cayó Tesla hoy?", "drawdown"),
    ("dame ideas de acciones subvaluadas", "screener"),
    ("¿debería vender mi posición?", "trade_intent"),
    ("sí", "transactions"),
    ("confirmo", "transactions"),
])
def test_selector_includes_expected_module(msg, expected):
    assert expected in pm.select_modules(msg, has_ticker=bool(re.search(r"AAPL|Micron|Tesla|Google", msg)))


def test_bare_confirmation_after_proposal_forces_transactions():
    hist = [
        ChatMessage(role="user", content="compré 2 de NVDA a 120"),
        ChatMessage(role="assistant", content="Propuesta lista. ¿Confirmas que lo registre?"),
    ]
    assert "transactions" in pm.select_modules("ok gracias listo", hist)


def test_plain_greeting_is_core_only():
    assert pm.select_modules("hola, ¿cómo estás?") == frozenset()


def test_pure_quote_question_skips_verdict_module():
    assert "analysis" not in pm.select_modules("¿cuánto está AAPL?", has_ticker=True)
    assert "analysis" in pm.select_modules("¿cuánto está AAPL? ¿vale la pena?", has_ticker=True)


def test_blocks_are_ordered_and_portfolio_is_not_cached():
    blocks, selected = ai._build_static_system_blocks(
        None, None, is_voice=False, is_premium=True,
        raw_message="hola", history=[], has_ticker=False,
    )
    assert selected == frozenset()
    # language+core, profile, guardrails (no module text for a greeting)
    assert len(blocks) == 3
    assert all(b["cache_control"] == {"type": "ephemeral"} for b in blocks)
    assert "REGLA CENTRAL DE NUVOS" in blocks[0]["text"]
    assert "FORMATO OBLIGATORIO — \"¿ES BUENA INVERSIÓN" not in "".join(b["text"] for b in blocks)


def test_legacy_caller_gets_full_prompt():
    blocks, selected = ai._build_static_system_blocks(
        None, None, is_voice=False, is_premium=True, raw_message=None,
    )
    joined = "".join(b["text"] for b in blocks)
    assert selected == pm.ALL_MODULES
    assert "FORMATO OBLIGATORIO — \"¿ES BUENA INVERSIÓN" in joined
    assert "REGISTRAR TRANSACCIONES" in joined


def test_free_tier_still_gets_replacement_not_full_verdict():
    blocks, _ = ai._build_static_system_blocks(None, None, is_voice=False, is_premium=False, raw_message=None)
    joined = "".join(b["text"] for b in blocks)
    assert "FORMATO OBLIGATORIO (GRATIS)" in joined
    assert "\"¿ES BUENA INVERSIÓN [EMPRESA]?\" / \"¿ES BUENA COMPRA" not in joined


def test_cache_breakpoint_budget():
    """Anthropic rejects >4 cache_control blocks per request (found by a real
    count_tokens call). Tools already carry one — keep static blocks <= 3."""
    blocks, _ = ai._build_static_system_blocks(None, None, False, True, raw_message=None)
    n_tools = sum(1 for t in ai.MENTOR_TOOLS if "cache_control" in t)
    assert len(blocks) + n_tools <= 4


def test_trade_report_gets_transactions_without_verdict_or_capital_modules():
    sel = pm.select_modules("compré 3 acciones de Google a $343.58", [], has_ticker=True)
    assert "transactions" in sel
    assert "analysis" not in sel and "capital" not in sel and "trade_intent" not in sel


def test_trade_report_with_real_question_still_gets_the_extra_modules():
    sel = pm.select_modules("vendí todo y ahora tengo 10k, ¿qué hago con mi dinero? ¿es buena compra AAPL?", [], has_ticker=True)
    assert {"transactions", "capital", "analysis"} <= sel
