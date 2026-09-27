"""
Routing of personal capital-allocation decisions (chat.py's
_needs_claude_analysis) and LatAm acronyms in detect_tickers.

Found 2026-09-27: "Tengo $100,000 pesos, tengo una idea de negocio o puedo
invertirlo en la bolsa" had no ticker, so it went to GPT-mini and never saw
the capital-allocation toolbox. The same message with "MXN" reached Claude
only because MXN was misread as a ticker.
"""
import pytest

from app.api.routes.chat import _needs_claude_analysis
from app.services.market_data_service import detect_tickers


@pytest.mark.parametrize("message", [
    "Tengo $100,000 MXN, tengo una idea de negocio o puedo invertirlo en la bolsa, no sé que hacer",
    "Tengo $100,000 pesos, tengo una idea de negocio o puedo invertirlo en la bolsa, no sé que hacer",
    "tengo 50 mil ahorrados, ¿pago mi tarjeta o invierto?",
    "me dejaron una herencia de 200k pesos",
    "no sé qué hacer con mis ahorros",
    "¿debería renunciar para emprender?",
    "I have $20k saved, what should I do?",
])
def test_capital_decisions_reach_claude(message):
    assert _needs_claude_analysis(message, has_images=False)


@pytest.mark.parametrize("message", [
    "qué es un ETF",
    "qué es una afore",
    "cuánto rinden los CETES",
    "explícame el interés compuesto",
    "hola arthur",
])
def test_textbook_questions_stay_on_cheap_path(message):
    assert not _needs_claude_analysis(message, has_images=False)


def test_latam_acronyms_are_not_tickers():
    assert detect_tickers("Tengo $100,000 MXN en CETES, mi AFORE y pago IVA al SAT") == []


def test_real_tickers_that_look_like_acronyms_still_detected():
    assert set(detect_tickers("Analiza NVDA y CAT")) == {"NVDA", "CAT"}
