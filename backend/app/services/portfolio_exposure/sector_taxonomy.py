"""
Nuvos Plus — Fase 4A: canonical sector taxonomy for combining EQUITY and ETF
sector exposure into one honest number.

The problem this file exists to solve: `app.services.sector_lookup`
(equities, used by the existing portfolio diversification view) and
`app.services.etf.translations` (ETFs, this session's own engine) both
classify into the same real 11 GICS sectors, but under DIFFERENT Spanish
label strings for several of them — "Finanzas" vs. "Servicios financieros",
"Consumo Discrecional" vs. "Consumo cíclico", "Materiales" vs. "Materiales
básicos", "Comunicación de Servicios" vs. "Servicios de comunicación",
"REITs" vs. "Bienes raíces" (etf/translations.py's SECTOR_ES has no
"REITs" key — FMP's own ETF sector-weightings return "Real Estate", which
SECTOR_ES already translates to "Bienes raíces"). Summing values keyed by
these mismatched strings would silently split what is really ONE sector
into two separate, smaller-looking rows.

This module does NOT modify sector_lookup.py or etf/translations.py — it
only maps their already-produced OUTPUT strings onto one canonical
vocabulary (etf/translations.py's SECTOR_ES, since it already matches
FMP's own raw sector names 1:1 — no reason to invent a third taxonomy).

Diego, 2026-11 Fase 4A requirement: never silently merge concepts that
aren't actually equivalent. Sector IS the same real GICS concept on both
sides (same company sector classification standard) — this mapping is a
label normalization, not a methodology conflation like the geographic case
(see combiner.py's geographic_exposure docstring for why that one is kept
unmerged by methodology instead).
"""
from app.services import sector_lookup as _sl

# The canonical vocabulary — etf/translations.py's own SECTOR_ES values,
# duplicated here as plain strings (not imported) so this module has zero
# import-time dependency on the ETF package, same "no modify, no couple"
# discipline etf/provider.py itself documents for its own boundaries.
CANONICAL_TECHNOLOGY = "Tecnología"
CANONICAL_HEALTHCARE = "Salud"
CANONICAL_FINANCIAL_SERVICES = "Servicios financieros"
CANONICAL_ENERGY = "Energía"
CANONICAL_CONSUMER_CYCLICAL = "Consumo cíclico"
CANONICAL_CONSUMER_DEFENSIVE = "Consumo defensivo"
CANONICAL_INDUSTRIALS = "Industriales"
CANONICAL_UTILITIES = "Servicios públicos"
CANONICAL_REAL_ESTATE = "Bienes raíces"
CANONICAL_BASIC_MATERIALS = "Materiales básicos"
CANONICAL_COMMUNICATION_SERVICES = "Servicios de comunicación"
CANONICAL_BIOTECHNOLOGY = "Biotecnología"

# sector_lookup.py's SECTOR_GROUPS_ES label -> canonical label. Every key
# here is one of sector_lookup.SECTOR_GROUPS_ES's real, live constants
# (imported, not re-typed as a string, so a future rename there breaks this
# mapping loudly at import time instead of silently going stale).
_EQUITY_GROUP_TO_CANONICAL: dict[str, str] = {
    _sl.SECTOR_TECHNOLOGY: CANONICAL_TECHNOLOGY,
    _sl.SECTOR_FINANCIALS: CANONICAL_FINANCIAL_SERVICES,
    _sl.SECTOR_CONSUMER_DISCRETIONARY: CANONICAL_CONSUMER_CYCLICAL,
    _sl.SECTOR_CONSUMER_STAPLES: CANONICAL_CONSUMER_DEFENSIVE,
    _sl.SECTOR_INDUSTRIALS: CANONICAL_INDUSTRIALS,
    _sl.SECTOR_MATERIALS: CANONICAL_BASIC_MATERIALS,
    _sl.SECTOR_REITS: CANONICAL_REAL_ESTATE,
    _sl.SECTOR_COMMUNICATION_SERVICES: CANONICAL_COMMUNICATION_SERVICES,
    _sl.SECTOR_HEALTH: CANONICAL_HEALTHCARE,
    _sl.SECTOR_ENERGY: CANONICAL_ENERGY,
    _sl.SECTOR_UTILITIES: CANONICAL_UTILITIES,
    # Oro/Plata/Petróleo/Criptos (sector_lookup's curated commodity/crypto
    # buckets) and the opaque "ETFs" fallback are deliberately NOT mapped
    # here — see map_equity_sector_to_canonical's docstring below.
}


def map_equity_sector_to_canonical(equity_group_es: str | None) -> str | None:
    """`equity_group_es` is sector_lookup.get_sector_group_es()'s return
    value for a ticker already confirmed EQUITY by classify_asset(). Maps
    to the canonical label, or None when there's nothing honest to map:

      - sector_lookup's own "ETFs" fallback label — this combiner never
        uses sector_lookup for a ticker already classified ETF (it uses
        the real per-ETF weightings from etf/service.py instead), so
        seeing "ETFs" here would mean a genuine classification mismatch
        between classify_asset and sector_lookup — treated as unclassified
        rather than silently trusted.
      - Oro/Plata/Petróleo/Criptos — these are real, curated buckets, but
        not one of the 11 canonical GICS sectors the ETF side classifies
        into; merging "Oro" into some canonical GICS sector would be a
        fabrication. Left unclassified for the SECTOR view specifically
        (still a perfectly real, named holding in the position list)."""
    if not equity_group_es:
        return None
    return _EQUITY_GROUP_TO_CANONICAL.get(equity_group_es)
