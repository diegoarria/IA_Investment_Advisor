"""
Nuvos ETF — "Lo que debes entender": up to 3 rule-based observations per
ETF, built ONLY from real, already-computed overview data. Every rule is a
fixed threshold on a real number, documented inline, never an LLM call and
never a conclusion the data doesn't support.

Hard constraints from Diego's 2026-11 correction pass — enforced by
construction, not just by convention:

1. Holdings count is NEVER used to claim concentration/diversification —
   we don't have per-holding weights, so no observation here is built
   from `holdings_count` at all (it's shown as one of the 4 header
   metrics instead, a plain fact: "contains N positions").
2. Sector concentration and geographic exposure are ALWAYS separate
   observations, never merged into one "diversification" verdict.
3. Every phrasing is descriptive ("represents X%"), never evaluative
   ("low risk", "well diversified", "safe") — concentration language is
   allowed ONLY when tied to the real number that justifies it.
4. Priority order when more than 3 would qualify: sector concentration,
   then geographic exposure, then cost. Missing data for a slot means
   FEWER than 3 observations, never a padded/invented one.
"""
from app.services.etf.metrics import cost_tier as _cost_tier
from app.services.etf.translations import translate_country, translate_sector

_SECTOR_HIGH_PCT = 40.0   # at/above this, lead with "alta concentración"
_SECTOR_LOW_PCT = 20.0    # below this, lead with "distribuido entre varios sectores"
_COUNTRY_HIGH_PCT = 80.0
_COUNTRY_MID_PCT = 50.0

_COST_TIER_LABEL_ES = {"muy_bajo": "muy baja", "bajo": "baja", "moderado": "moderada", "alto": "alta"}
_COST_TIER_LABEL_EN = {"muy_bajo": "very low", "bajo": "low", "moderado": "moderate", "alto": "high"}


def _sector_observation(overview: dict, lang: str) -> dict | None:
    by_sector = overview.get("diversification", {}).get("by_sector", {})
    name = by_sector.get("top1_name")
    pct = by_sector.get("top1_weight_pct")
    bucket_count = by_sector.get("bucket_count") or 0
    if name is None or pct is None:
        return None

    translated = translate_sector(name, lang)
    if lang == "es":
        if pct >= _SECTOR_HIGH_PCT:
            text = f"El sector {translated} representa el {pct:.1f}% del fondo — una concentración alta en un solo sector."
        elif pct < _SECTOR_LOW_PCT and bucket_count > 1:
            text = f"La exposición está distribuida entre {bucket_count} sectores; el más grande es {translated} con {pct:.1f}%."
        else:
            text = f"El sector más grande del fondo es {translated}, con {pct:.1f}% del total."
    else:
        if pct >= _SECTOR_HIGH_PCT:
            text = f"{translated} makes up {pct:.1f}% of the fund — a high concentration in a single sector."
        elif pct < _SECTOR_LOW_PCT and bucket_count > 1:
            text = f"Exposure is spread across {bucket_count} sectors; the largest is {translated} at {pct:.1f}%."
        else:
            text = f"The fund's largest sector is {translated}, at {pct:.1f}% of the total."

    return {
        "category": "sector_concentration",
        "text": text,
        "supporting_data": {"sector": name, "weight_pct": pct, "bucket_count": bucket_count},
    }


def _geographic_observation(overview: dict, lang: str) -> dict | None:
    by_country = overview.get("diversification", {}).get("by_country", {})
    name = by_country.get("top1_name")
    pct = by_country.get("top1_weight_pct")
    bucket_count = by_country.get("bucket_count") or 0
    if name is None or pct is None:
        return None

    translated = translate_country(name, lang)
    if lang == "es":
        if pct >= _COUNTRY_HIGH_PCT:
            text = f"Casi toda la exposición geográfica está en {translated} ({pct:.1f}%)."
        elif pct >= _COUNTRY_MID_PCT:
            text = f"La mayor parte de la exposición geográfica está en {translated} ({pct:.1f}%)."
        elif bucket_count > 1:
            text = f"La exposición geográfica está distribuida entre {bucket_count} países; el principal es {translated} con {pct:.1f}%."
        else:
            text = f"El país con mayor peso es {translated}, con {pct:.1f}%."
    else:
        if pct >= _COUNTRY_HIGH_PCT:
            text = f"Nearly all geographic exposure is in {translated} ({pct:.1f}%)."
        elif pct >= _COUNTRY_MID_PCT:
            text = f"Most of the geographic exposure is in {translated} ({pct:.1f}%)."
        elif bucket_count > 1:
            text = f"Geographic exposure is spread across {bucket_count} countries; the largest is {translated} at {pct:.1f}%."
        else:
            text = f"The country with the largest weight is {translated}, at {pct:.1f}%."

    return {
        "category": "geographic_exposure",
        "text": text,
        "supporting_data": {"country": name, "weight_pct": pct, "bucket_count": bucket_count},
    }


def _cost_observation(overview: dict, lang: str) -> dict | None:
    costs = overview.get("costs", {})
    expense_ratio = costs.get("expense_ratio_pct")
    if expense_ratio is None:
        return None
    tier = costs.get("cost_tier") or _cost_tier(expense_ratio)
    label = (_COST_TIER_LABEL_ES if lang == "es" else _COST_TIER_LABEL_EN).get(tier, tier)
    annual_on_10k = round(10000 * expense_ratio / 100, 2)

    if lang == "es":
        text = f"Cobra {expense_ratio:.2f}% al año (comisión {label}) — aproximadamente ${annual_on_10k} anuales por cada $10,000 invertidos."
    else:
        text = f"Charges {expense_ratio:.2f}% per year (a {label} fee) — about ${annual_on_10k} per year for every $10,000 invested."

    return {
        "category": "cost",
        "text": text,
        "supporting_data": {"expense_ratio_pct": expense_ratio, "cost_tier": tier},
    }


def build_insights(overview: dict, lang: str = "es") -> list[dict]:
    """Returns up to 3 observations, in priority order (sector, geographic,
    cost), skipping any whose underlying data isn't available — never
    padded to reach 3."""
    candidates = [
        _sector_observation(overview, lang),
        _geographic_observation(overview, lang),
        _cost_observation(overview, lang),
    ]
    return [c for c in candidates if c is not None][:3]


_HORIZON_NOTE_SHORT_ES = (
    "Tu horizonte de inversión influye en cómo interpretas las fluctuaciones de este fondo. "
    "Es importante entender qué contiene, cuánto cobra y cómo podrían afectarte los cambios en su valor."
)
_HORIZON_NOTE_SHORT_EN = (
    "Your investment horizon shapes how you interpret this fund's fluctuations. "
    "It's worth understanding what it holds, what it charges, and how changes in its value could affect you."
)
_HORIZON_NOTE_EXTENDED_ES = (
    "A más corto plazo, la volatilidad del precio (cuánto sube y baja en periodos cortos) pesa más. "
    "A más largo plazo, suele importar más entender en qué invierte el fondo y cuánto cobra. "
    "Tu propia tolerancia a ver pérdidas temporales en el valor de tu inversión también es parte de esa decisión. "
    "Nuvos no recomienda un horizonte específico para este ni ningún otro ETF — esto es solo una guía para que tú lo evalúes con tu propio contexto."
)
_HORIZON_NOTE_EXTENDED_EN = (
    "Over shorter periods, price volatility (how much it moves up and down) matters more. "
    "Over longer periods, what the fund invests in and what it charges tends to matter more. "
    "Your own tolerance for seeing temporary losses in your investment's value is also part of that decision. "
    "Nuvos doesn't recommend a specific horizon for this or any other ETF — this is only a guide for you to evaluate with your own context."
)


def get_horizon_note(lang: str = "es") -> str:
    """Static educational text — deliberately NOT a function of the
    specific ETF's category/data. Diego, 2026-11: 'No asignes horizontes
    específicos según la categoría del ETF' — this is the same text for
    every ETF, on purpose. Diego, 2026-11 (ficha v2 ajustes): shortened to
    2 sentences so it reads at a glance — the rest of the same guidance
    moved to get_horizon_note_extended(), shown behind a "ver más" in the
    frontend rather than dropped."""
    return _HORIZON_NOTE_SHORT_ES if lang == "es" else _HORIZON_NOTE_SHORT_EN


def get_horizon_note_extended(lang: str = "es") -> str:
    """The rest of get_horizon_note()'s guidance — same no-recommendation
    discipline, just not shown by default."""
    return _HORIZON_NOTE_EXTENDED_ES if lang == "es" else _HORIZON_NOTE_EXTENDED_EN
