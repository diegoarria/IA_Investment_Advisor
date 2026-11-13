"""
Nuvos Plus — Fase 4B: ISO-3166 alpha-2 → English country name, for equity
positions only.

Found during Fase 4B's live data-quality verification (Diego's explicit
"comprueba que... los valores sean coherentes" requirement): FMP's equity
`/profile` returns `country` as a 2-letter ISO code ("US", "NL", "CN"),
while the ETF engine's `/etf/country-weightings` already returns full
English country names that `etf.translations.translate_country` maps to
Spanish ("United States" -> "Estados Unidos"). Showing a raw "NL" next to
a translated "Países Bajos" in the same geographic-exposure list would
read as broken, not just untranslated.

This module bridges the two WITHOUT touching etf/translations.py — it only
expands the ISO code to the same English name translate_country already
knows how to map, so combiner.py can feed equity countries through that
one existing dictionary instead of a second translation table. A code not
in this map returns None (shown as "no disponible" by the caller) — never
a guessed/invented country name.

Scope: common domiciles for equities that actually trade on US/European
exchanges (the ones FMP covers today) — not a complete ISO-3166 list."""

ISO_TO_ENGLISH: dict[str, str] = {
    "US": "United States", "CA": "Canada", "GB": "United Kingdom", "DE": "Germany",
    "FR": "France", "NL": "Netherlands", "CH": "Switzerland", "IE": "Ireland",
    "CN": "China", "TW": "Taiwan", "KR": "South Korea", "JP": "Japan",
    "IN": "India", "BR": "Brazil", "MX": "Mexico", "IL": "Israel",
    "AU": "Australia", "ES": "Spain", "IT": "Italy", "SE": "Sweden",
    "DK": "Denmark", "HK": "Hong Kong", "SG": "Singapore", "ZA": "South Africa",
    "LU": "Luxembourg", "BM": "Bermuda", "KY": "Cayman Islands", "VG": "British Virgin Islands",
    "BE": "Belgium", "FI": "Finland", "NO": "Norway", "AT": "Austria",
    "PT": "Portugal", "GR": "Greece", "PL": "Poland", "AR": "Argentina",
    "CL": "Chile", "CO": "Colombia", "PE": "Peru", "PA": "Panama",
    "JE": "Jersey", "GG": "Guernsey", "MC": "Monaco", "MT": "Malta",
}


def iso_to_english(code: str | None) -> str | None:
    if not code:
        return None
    return ISO_TO_ENGLISH.get(code.strip().upper())
