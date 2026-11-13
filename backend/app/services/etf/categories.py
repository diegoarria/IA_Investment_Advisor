"""
Nuvos ETF — browsable categories.

Fase 2B second iteration (2026-11): Diego's explicit feedback was that a
single "Sectores" bucket mixing 10 different sectors together reads as a
generic directory, not navigation by interest — split into specific,
named interests (Tecnología, Salud, Mercados internacionales, Mercado
amplio, etc.) instead.

Still NOT built by inferring a category from a ticker's or name's text —
there is no bulk "ETFs by sector" endpoint in Fase 1's confirmed-available
FMP set (that would need per-ETF /etf/sector-weightings calls across
thousands of tickers). Still a small, explicitly curated list of
well-known, real ETFs per category, the same curation discipline
screener.py's own UNIVERSE list already uses — and every ticker here is
re-verified through classify_asset() before being returned, never just
assumed from being a famous ticker.

Explicitly a curated starting point, not exhaustive — the Explorer must
say so in the UI (categoryCuratedNote i18n key), per Diego's requirement.
"""
from app.services.asset_classification import classify_asset, ETF

CATEGORIES: dict[str, dict] = {
    "mercado_amplio": {
        "label": "Mercado amplio",
        "tickers": [
            ("SPY", "S&P 500"), ("VOO", "S&P 500"),
            ("VTI", "Mercado total EE. UU."), ("QQQ", "Nasdaq 100"),
        ],
    },
    "tecnologia": {
        "label": "Tecnología",
        "tickers": [("XLK", "Sector tecnológico"), ("BOTZ", "Robótica e inteligencia artificial")],
    },
    "salud": {
        "label": "Salud y biotecnología",
        "tickers": [("XLV", "Sector salud"), ("IBB", "Biotecnología")],
    },
    "mercados_internacionales": {
        "label": "Mercados internacionales",
        "tickers": [
            ("VXUS", "Internacional (fuera de EE. UU.)"), ("EFA", "Mercados desarrollados"),
            ("EEM", "Mercados emergentes"), ("FXI", "China"), ("EWJ", "Japón"),
            ("INDA", "India"), ("EWZ", "Brasil"),
        ],
    },
    "financiero_y_energia": {
        "label": "Financiero y energía",
        "tickers": [("XLF", "Sector financiero"), ("XLE", "Sector energético")],
    },
    "consumo_e_industria": {
        "label": "Consumo e industria",
        "tickers": [
            ("XLY", "Consumo discrecional"), ("XLP", "Consumo básico"),
            ("XLI", "Industriales"), ("XLU", "Servicios públicos"), ("VNQ", "Bienes raíces"),
        ],
    },
}


def get_categories() -> list[dict]:
    """Returns the curated categories, each with its tickers re-verified
    as real ETFs via classify_asset() (cheap — classify_asset itself
    caches each ticker's result for 24h, so this costs real FMP calls
    only the first time a given ticker is checked, ever, across the
    whole app)."""
    out = []
    for key, cat in CATEGORIES.items():
        verified = []
        for ticker, label in cat["tickers"]:
            if classify_asset(ticker) == ETF:
                verified.append({"ticker": ticker, "label": label})
        out.append({"key": key, "label": cat["label"], "etfs": verified})
    return out
