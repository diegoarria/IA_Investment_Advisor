"""
Nuvos ETF — curated, short, factual Spanish/English descriptions for the
tickers this app actually curates (categories.py + the Explorer's
discovery section). NOT a translation of FMP's English paragraph (that
would risk mistranslating a legal/financial document) and NOT AI-generated
(no LLM call, no added cost, no risk of inventing something about a real
fund) — each entry states only the well-known, publicly documented index
or theme the fund tracks (e.g. "VOO sigue el índice S&P 500"), which is
verifiable against the fund's own prospectus/website.

Deliberately small and closed — only for tickers this app already curates
elsewhere. Any ticker NOT in this dict (e.g. a generic search result)
falls back honestly in service.py rather than getting a guessed
description.
"""

DESCRIPTIONS: dict[str, dict[str, str]] = {
    "SPY":  {"es": "Sigue el índice S&P 500 — las 500 empresas más grandes de EE. UU.", "en": "Tracks the S&P 500 index — the 500 largest U.S. companies."},
    "VOO":  {"es": "Sigue el índice S&P 500 — las 500 empresas más grandes de EE. UU.", "en": "Tracks the S&P 500 index — the 500 largest U.S. companies."},
    "VTI":  {"es": "Cubre prácticamente todo el mercado accionario de EE. UU., grandes y pequeñas empresas.", "en": "Covers nearly the entire U.S. stock market, large and small companies."},
    "QQQ":  {"es": "Sigue el índice Nasdaq-100 — las 100 empresas no financieras más grandes del Nasdaq.", "en": "Tracks the Nasdaq-100 index — the 100 largest non-financial Nasdaq companies."},
    "XLK":  {"es": "Empresas del sector tecnológico dentro del S&P 500.", "en": "Technology-sector companies within the S&P 500."},
    "XLV":  {"es": "Empresas del sector salud dentro del S&P 500.", "en": "Healthcare-sector companies within the S&P 500."},
    "IBB":  {"es": "Empresas de biotecnología que cotizan en EE. UU.", "en": "U.S.-listed biotechnology companies."},
    "XLF":  {"es": "Empresas del sector financiero dentro del S&P 500 (bancos, aseguradoras, etc.).", "en": "Financial-sector companies within the S&P 500 (banks, insurers, etc.)."},
    "XLE":  {"es": "Empresas del sector energético dentro del S&P 500.", "en": "Energy-sector companies within the S&P 500."},
    "XLY":  {"es": "Empresas de consumo discrecional (retail, entretenimiento) dentro del S&P 500.", "en": "Consumer discretionary companies (retail, entertainment) within the S&P 500."},
    "XLP":  {"es": "Empresas de consumo básico (alimentos, higiene) dentro del S&P 500.", "en": "Consumer staples companies (food, household goods) within the S&P 500."},
    "XLI":  {"es": "Empresas industriales dentro del S&P 500.", "en": "Industrial-sector companies within the S&P 500."},
    "XLU":  {"es": "Empresas de servicios públicos (electricidad, agua, gas) dentro del S&P 500.", "en": "Utility companies (electricity, water, gas) within the S&P 500."},
    "VNQ":  {"es": "Empresas de bienes raíces (REITs) que cotizan en EE. UU.", "en": "U.S.-listed real estate companies (REITs)."},
    "BOTZ": {"es": "Empresas globales relacionadas con robótica e inteligencia artificial.", "en": "Global companies related to robotics and artificial intelligence."},
    "VXUS": {"es": "Mercado accionario internacional, fuera de EE. UU. (desarrollado y emergente).", "en": "International stock market, outside the U.S. (developed and emerging)."},
    "EFA":  {"es": "Mercados desarrollados fuera de EE. UU. y Canadá (Europa, Asia-Pacífico).", "en": "Developed markets outside the U.S. and Canada (Europe, Asia-Pacific)."},
    "EEM":  {"es": "Mercados emergentes a nivel global.", "en": "Global emerging markets."},
    "FXI":  {"es": "Las empresas chinas más grandes que cotizan en bolsa.", "en": "The largest publicly traded Chinese companies."},
    "EWJ":  {"es": "Mercado accionario de Japón.", "en": "Japan's stock market."},
    "INDA": {"es": "Mercado accionario de India.", "en": "India's stock market."},
    "EWZ":  {"es": "Mercado accionario de Brasil.", "en": "Brazil's stock market."},
}


def get_editorial_description(ticker: str, lang: str = "es") -> str | None:
    entry = DESCRIPTIONS.get((ticker or "").strip().upper())
    if not entry:
        return None
    return entry.get(lang) or entry.get("es")
