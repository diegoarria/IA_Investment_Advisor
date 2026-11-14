"""
Nuvos ETF — Fase 3A: comparador educativo.

Reuses get_etf_overview() entirely — no new FMP calls, no new cache layer,
no duplicated fetch/normalize logic. This module only aligns 2-3 already
fetched overviews side by side and derives a small set of deterministic,
descriptive "lo que debes entender de esta comparación" observations from
real differences in the data those overviews already contain.

Hard constraints (Diego, 2026-11, same discipline as insights.py):
1. Never claim one ETF is better, safer, or more recommendable than
   another — every observation is a plain comparison of two real numbers,
   never a verdict.
2. Never claim holdings overlap/duplication between funds — this module
   has no access to individual holdings (see provider.py's docstring),
   so it never infers them from sector/country weightings either.
3. Sector concentration and total risk are different things — any
   observation phrased as a concentration magnitude says so explicitly.
4. A sector/country absent from an ETF's own weightings list is treated
   as a real 0% ONLY when that ETF's own weighting coverage is confirmed
   complete (normalize.py's `sum_in_expected_range`, already computed by
   service.py — the same signal the ficha individual's own data-quality
   section already relies on). If coverage isn't confirmed complete, OR
   the fetch itself failed, the value stays None/"No disponible" — never
   a guessed zero. Diego's 2026-11 Etapa-2 correction: an HTTP 200 alone
   is not enough to assume a sector's absence means zero.
5. Sector/country names are comparable across ETFs because every one of
   them comes from the same FMP endpoint using the same taxonomy, and
   translations.py maps both through the one shared dictionary — there
   is no second taxonomy in play here to reconcile.
6. Historical performance is NEVER compared directly in this version.
   Even price-history windows of similar length don't guarantee the same
   calendar period, the same dividend-reinvestment treatment, or the
   same methodology — so rather than approximate "comparable enough",
   each ETF's own performance is shown on its own, and no observation is
   ever built from a performance difference. Diego, 2026-11 Etapa-2:
   "omite las comparaciones directas de rendimientos si esos requisitos
   no pueden garantizarse" — they can't, so this module doesn't try.
7. At most 3 observations, each covering a DIFFERENT dimension (sector,
   country, cost) — never two observations about the same dimension, even
   when both would individually qualify. _sector_dimension_insight picks
   one sector-related framing, never both exposure-to-a-named-sector and
   raw top1-concentration at once, since those two are frequently near-
   identical numbers restated two ways.
"""
import logging
import time

from app.services.etf.service import NotAnETFError, get_etf_overview

logger = logging.getLogger(__name__)

MIN_COMPARE = 2
MAX_COMPARE = 3

# Minimum real gap before a difference is worth surfacing as an
# observation — below this, two funds are close enough that calling out
# the difference would overstate its significance.
_SECTOR_GAP_THRESHOLD_PCT = 15.0
_COST_GAP_THRESHOLD_PCT = 0.05  # 5 basis points
_CONCENTRATION_GAP_THRESHOLD_PCT = 15.0


class ComparisonValidationError(Exception):
    """Raised for a request-shape problem (count, duplicates) — always a
    400 at the route layer, never a provider/data problem."""


def _validate_tickers(tickers: list[str]) -> None:
    if len(tickers) < MIN_COMPARE or len(tickers) > MAX_COMPARE:
        raise ComparisonValidationError(f"Se requieren entre {MIN_COMPARE} y {MAX_COMPARE} ETFs para comparar, se recibieron {len(tickers)}.")
    if len(set(tickers)) != len(tickers):
        raise ComparisonValidationError("No se puede comparar un ticker consigo mismo — hay tickers duplicados.")


def _etf_summary(ticker: str, overview: dict) -> dict:
    perf = overview["price"]["returns"]
    exposure = overview["exposure"]
    return {
        "ticker": ticker,
        "identification": overview["identification"],
        "costs": overview["costs"],
        "exposure": {
            "sector_weightings": exposure["sector_weightings"],
            "sector_weight_sum_in_expected_range": exposure["sector_weight_sum_in_expected_range"],
            "country_weightings": exposure["country_weightings"],
            "country_weight_sum_in_expected_range": exposure["country_weight_sum_in_expected_range"],
            "holdings_count": exposure["holdings_count"],
        },
        "diversification": overview["diversification"],
        "performance": {
            "ytd_pct": perf.get("ytd_pct"),
            "one_year_pct": perf.get("one_year_pct"),
            "five_year_pct": perf.get("five_year_pct"),
            "max_pct": perf.get("max_pct"),
            "max_start_date": perf.get("max_start_date"),
            "max_is_full_history": perf.get("max_is_full_history"),
        },
        "data_quality": {
            "missing_fields": overview["data_quality"]["missing_fields"],
            "provider_errors": overview["data_quality"]["provider_errors"],
            "structural_fetched_at": overview["data_quality"]["structural_fetched_at"],
            "price_fetched_at": overview["data_quality"]["price_fetched_at"],
        },
    }


def _coverage_confirmed(etf: dict, field: str, missing_key: str, sum_key: str) -> bool:
    """True only when `field`'s fetch succeeded AND its own weights summed
    close enough to 100% to trust the list as the complete picture for
    this fund — the two-part check Diego's Etapa-2 correction requires
    before an absent name can honestly become a 0%, not just an HTTP 200."""
    if missing_key in etf["data_quality"]["missing_fields"]:
        return False
    return bool(etf["exposure"].get(sum_key))


def _align_weightings(etfs: list[dict], field: str, missing_key: str, sum_key: str) -> list[dict]:
    """Rows of {"name": ..., "<TICKER>": weight_pct | None} across all
    compared ETFs, sorted by each row's max known weight descending.

    A ticker's value for a given name is:
      - the real weight, if that name is in its own weightings list
      - 0.0 — ONLY if that name is absent AND this ETF's coverage for
        `field` is confirmed complete (see _coverage_confirmed)
      - None otherwise — fetch failed, or coverage isn't confirmed
        complete, so an absence can't be honestly read as zero
    """
    names: set[str] = set()
    lookups: dict[str, dict[str, float]] = {}
    coverage: dict[str, bool] = {}
    for e in etfs:
        lookup = {i["name"]: i["weight_pct"] for i in e["exposure"][field]}
        lookups[e["ticker"]] = lookup
        coverage[e["ticker"]] = _coverage_confirmed(e, field, missing_key, sum_key)
        names.update(lookup.keys())

    rows = []
    for name in names:
        row: dict = {"name": name}
        for e in etfs:
            ticker = e["ticker"]
            lookup = lookups[ticker]
            if name in lookup:
                row[ticker] = lookup[name]
            elif coverage[ticker]:
                row[ticker] = 0.0
            else:
                row[ticker] = None
        rows.append(row)

    rows.sort(key=lambda r: max((v for k, v in r.items() if k != "name" and v is not None), default=0.0), reverse=True)
    return rows


def _dominant_sector_lookup(etfs: list[dict]) -> dict[str, dict[str, float | None]]:
    """{sector_name: {ticker: weight_pct_or_None}} — only for sectors that
    are the top1 sector of at least one compared ETF, built with the same
    coverage-confirmed-before-zero rule as _align_weightings."""
    dominant_sectors = {
        e["diversification"]["by_sector"]["top1_name"]
        for e in etfs
        if e["diversification"]["by_sector"]["top1_name"] is not None
    }
    out: dict[str, dict[str, float | None]] = {s: {} for s in dominant_sectors}
    for e in etfs:
        ticker = e["ticker"]
        lookup = {i["name"]: i["weight_pct"] for i in e["exposure"]["sector_weightings"]}
        coverage_ok = _coverage_confirmed(e, "sector_weightings", "sector_weightings", "sector_weight_sum_in_expected_range")
        for sector in dominant_sectors:
            if sector in lookup:
                out[sector][ticker] = lookup[sector]
            else:
                out[sector][ticker] = 0.0 if coverage_ok else None
    return out


def _sector_exposure_candidate(etfs: list[dict], lang: str) -> dict | None:
    """Named-sector framing: 'X has more exposure to {sector} than Y'."""
    by_sector = _dominant_sector_lookup(etfs)
    best = None  # (gap, sector, hi_ticker, hi_pct, lo_ticker, lo_pct)
    for sector, weights in by_sector.items():
        known = {t: w for t, w in weights.items() if w is not None}
        if len(known) < 2:
            continue
        hi_ticker = max(known, key=known.get)
        lo_ticker = min(known, key=known.get)
        if hi_ticker == lo_ticker:
            continue
        gap = round(known[hi_ticker] - known[lo_ticker], 2)
        if gap < _SECTOR_GAP_THRESHOLD_PCT:
            continue
        if best is None or gap > best[0]:
            best = (gap, sector, hi_ticker, known[hi_ticker], lo_ticker, known[lo_ticker])

    if best is None:
        return None
    gap, sector, hi_ticker, hi_pct, lo_ticker, lo_pct = best

    if lang == "es":
        text = f"{hi_ticker} tiene una exposición mayor a {sector} que {lo_ticker} ({hi_pct:.1f}% vs {lo_pct:.1f}%)."
    else:
        text = f"{hi_ticker} has greater exposure to {sector} than {lo_ticker} ({hi_pct:.1f}% vs {lo_pct:.1f}%)."

    return {
        "category": "sector_exposure_difference",
        "text": text,
        "supporting_data": {"sector": sector, "higher_ticker": hi_ticker, "higher_pct": hi_pct, "lower_ticker": lo_ticker, "lower_pct": lo_pct},
        "_gap": gap,
    }


def _concentration_candidate(etfs: list[dict], lang: str) -> dict | None:
    """Magnitude framing: top1 sector weight of X vs Y, with an explicit
    concentration-is-not-total-risk caveat every time."""
    known = [(e["ticker"], e["diversification"]["by_sector"]["top1_weight_pct"]) for e in etfs if e["diversification"]["by_sector"]["top1_weight_pct"] is not None]
    if len(known) < 2:
        return None
    hi_ticker, hi_pct = max(known, key=lambda x: x[1])
    lo_ticker, lo_pct = min(known, key=lambda x: x[1])
    if hi_ticker == lo_ticker:
        return None
    gap = round(hi_pct - lo_pct, 2)
    if gap < _CONCENTRATION_GAP_THRESHOLD_PCT:
        return None

    if lang == "es":
        text = (
            f"{hi_ticker} está más concentrado en su sector principal que {lo_ticker} "
            f"({hi_pct:.1f}% vs {lo_pct:.1f}%) — esto describe concentración sectorial, no el riesgo total del fondo."
        )
    else:
        text = (
            f"{hi_ticker} is more concentrated in its top sector than {lo_ticker} "
            f"({hi_pct:.1f}% vs {lo_pct:.1f}%) — this describes sector concentration, not the fund's overall risk."
        )

    return {
        "category": "concentration_difference",
        "text": text,
        "supporting_data": {"higher_ticker": hi_ticker, "higher_top1_pct": hi_pct, "lower_ticker": lo_ticker, "lower_top1_pct": lo_pct},
        "_gap": gap,
    }


def _sector_dimension_insight(etfs: list[dict], lang: str) -> dict | None:
    """Exactly ONE sector-related observation, never both the named-sector
    and the raw-concentration framing at once — when both ETFs share the
    same dominant sector those two framings restate the same numbers, so
    this always prefers the concentration framing (it carries the
    not-total-risk caveat) in that case; otherwise it keeps whichever
    framing reflects the larger real gap."""
    exposure = _sector_exposure_candidate(etfs, lang)
    concentration = _concentration_candidate(etfs, lang)

    if exposure and concentration:
        same_pair = (
            exposure["supporting_data"]["higher_pct"] == concentration["supporting_data"]["higher_top1_pct"]
            and exposure["supporting_data"]["lower_pct"] == concentration["supporting_data"]["lower_top1_pct"]
        )
        if same_pair:
            # The shared dominant sector name IS known here (that's what
            # made the two framings redundant in the first place) — carry
            # it along so build_comparison_summary can still name the
            # sector concretely, even though the detailed observation
            # keeps the concentration/not-total-risk framing.
            concentration["supporting_data"]["sector"] = exposure["supporting_data"]["sector"]
            chosen = concentration
        else:
            chosen = max(exposure, concentration, key=lambda c: c["_gap"])
    else:
        chosen = exposure or concentration

    if chosen is None:
        return None
    chosen.pop("_gap", None)
    return chosen


def _cost_insight(etfs: list[dict], lang: str) -> dict | None:
    known = [(e["ticker"], e["costs"]["expense_ratio_pct"]) for e in etfs if e["costs"]["expense_ratio_pct"] is not None]
    if len(known) < 2:
        return None
    hi_ticker, hi_pct = max(known, key=lambda x: x[1])
    lo_ticker, lo_pct = min(known, key=lambda x: x[1])
    if hi_ticker == lo_ticker:
        return None
    gap = round(hi_pct - lo_pct, 4)
    if gap < _COST_GAP_THRESHOLD_PCT:
        return None

    if lang == "es":
        text = f"{hi_ticker} cobra una comisión anual mayor que {lo_ticker} ({hi_pct:.2f}% vs {lo_pct:.2f}%)."
    else:
        text = f"{hi_ticker} charges a higher annual fee than {lo_ticker} ({hi_pct:.2f}% vs {lo_pct:.2f}%)."

    return {
        "category": "cost_difference",
        "text": text,
        "supporting_data": {"higher_ticker": hi_ticker, "higher_expense_ratio_pct": hi_pct, "lower_ticker": lo_ticker, "lower_expense_ratio_pct": lo_pct},
    }


def _geographic_insight(etfs: list[dict], lang: str) -> dict | None:
    known = [
        (e["ticker"], e["diversification"]["by_country"]["top1_name"], e["diversification"]["by_country"]["top1_weight_pct"])
        for e in etfs
        if e["diversification"]["by_country"]["top1_name"] is not None and e["diversification"]["by_country"]["top1_weight_pct"] is not None
    ]
    if len(known) < 2:
        return None

    distinct_countries = {t[1] for t in known}
    if len(distinct_countries) == 1:
        country = next(iter(distinct_countries))
        detail = ", ".join(f"{t[0]} {t[2]:.1f}%" for t in known)
        if lang == "es":
            text = f"Los ETFs comparados concentran su exposición geográfica principalmente en {country} ({detail})."
        else:
            text = f"The compared ETFs concentrate their geographic exposure mainly in {country} ({detail})."
        category = "geographic_similarity"
        supporting_data = {"country": country, "weights": {t[0]: t[2] for t in known}}
    else:
        detail = ", ".join(f"{t[0]}: {t[1]} ({t[2]:.1f}%)" for t in known)
        if lang == "es":
            text = f"Estos ETFs invierten en mercados geográficos distintos — exposición principal: {detail}."
        else:
            text = f"These ETFs invest in different geographic markets — main exposure: {detail}."
        category = "geographic_difference"
        supporting_data = {"top_countries": {t[0]: {"country": t[1], "weight_pct": t[2]} for t in known}}

    return {"category": category, "text": text, "supporting_data": supporting_data}


def build_comparison_insights(etfs: list[dict], lang: str = "es") -> list[dict]:
    """At most 3 observations, one per dimension (sector, country, cost),
    in that priority order — never two about the same dimension, never
    padded when a dimension's data doesn't support an observation. Needs
    at least 2 valid ETFs; returns [] otherwise."""
    if len(etfs) < 2:
        return []
    candidates = [
        _sector_dimension_insight(etfs, lang),
        _geographic_insight(etfs, lang),
        _cost_insight(etfs, lang),
    ]
    return [c for c in candidates if c is not None][:3]


_SECTOR_CATEGORIES = {"sector_exposure_difference", "concentration_difference"}
_GEOGRAPHIC_CATEGORIES = {"geographic_similarity", "geographic_difference"}


def _directional_fragment(insight: dict, lang: str) -> tuple[str, str, str] | None:
    """(subject_ticker, other_ticker, fragment_text) for a sector- or
    cost-dimension insight — fragment_text has no leading verb ("tiene"/
    "cobra" is added by the caller) and NEVER includes a number, since the
    numbers already live in comparison_insights' detailed text; this
    summary only states WHO and WHAT, grounded in that same insight's
    already-computed supporting_data."""
    cat, sd = insight["category"], insight["supporting_data"]
    if cat == "sector_exposure_difference":
        sector = sd["sector"]
        frag = f"mayor exposición a {sector}" if lang == "es" else f"greater exposure to {sector}"
        return sd["higher_ticker"], sd["lower_ticker"], frag
    if cat == "concentration_difference":
        sector = sd.get("sector")
        if sector:
            frag = f"mayor exposición a {sector}" if lang == "es" else f"greater exposure to {sector}"
        else:
            frag = "mayor concentración en su sector principal" if lang == "es" else "greater concentration in its top sector"
        return sd["higher_ticker"], sd["lower_ticker"], frag
    if cat == "cost_difference":
        frag = "una comisión anual superior" if lang == "es" else "a higher annual fee"
        return sd["higher_ticker"], sd["lower_ticker"], frag
    return None


def _geographic_sentence(insight: dict, lang: str) -> str:
    cat, sd = insight["category"], insight["supporting_data"]
    if cat == "geographic_similarity":
        country = sd["country"]
        both_or_all = ("Ambos" if len(sd["weights"]) == 2 else "Los tres") if lang == "es" else ("Both" if len(sd["weights"]) == 2 else "All three")
        return f"{both_or_all} concentran su exposición geográfica en {country}." if lang == "es" else f"{both_or_all} concentrate their geographic exposure in {country}."
    # geographic_difference
    top_countries = sd["top_countries"]
    parts = [f"{ticker} en {info['country']}" if lang == "es" else f"{ticker} in {info['country']}" for ticker, info in top_countries.items()]
    joined = "; ".join(parts)
    return f"Cada ETF concentra su exposición geográfica en un país distinto: {joined}." if lang == "es" else f"Each ETF concentrates its geographic exposure in a different country: {joined}."


def build_comparison_summary(insights: list[dict], lang: str = "es") -> str | None:
    """A short, concrete synthesis of the main real differences — e.g.
    'QQQ tiene mayor exposición a Technology y una comisión anual superior
    a VOO. Ambos concentran su exposición geográfica en Estados Unidos.'
    Built ENTIRELY from comparison_insights' own already-computed,
    already-verified supporting_data — no new threshold, no new rule, and
    never a number (those stay in the detailed insight text below it, so
    nothing here can drift out of sync with it). Never a verdict on which
    ETF is 'better'. Returns None when there's nothing to summarize —
    never a generic filler sentence."""
    if not insights:
        return None

    directional = [f for f in (_directional_fragment(i, lang) for i in insights) if f is not None]
    geographic = [i for i in insights if i["category"] in _GEOGRAPHIC_CATEGORIES]

    sentences: list[str] = []

    # Group directional fragments by (subject, other) pair so "X has
    # greater exposure to Y and a higher fee than Z" reads as one sentence
    # when it's genuinely the same ETF on both sides of the comparison —
    # never merged when the subject/other pairing actually differs.
    if directional:
        first_subject, first_other, _ = directional[0]
        same_pair = all(subj == first_subject and other == first_other for subj, other, _ in directional)
        if same_pair:
            frags = [frag for _, _, frag in directional]
            if lang == "es":
                joined = (", ".join(frags[:-1]) + f" y {frags[-1]}") if len(frags) > 1 else frags[0]
                # "comisión ... superior A X" is the standard Spanish idiom
                # ("superior que" reads wrong); "mayor exposición/
                # concentración ... QUE X" is standard for the others — the
                # last fragment in `directional` decides the connector
                # since cost_difference (if present) always comes last.
                connector = "a" if directional[-1][2].endswith("superior") else "que"
                sentences.append(f"{first_subject} tiene {joined} {connector} {first_other}.")
            else:
                joined = (", ".join(frags[:-1]) + f" and {frags[-1]}") if len(frags) > 1 else frags[0]
                sentences.append(f"{first_subject} has {joined} than {first_other}.")
        else:
            for subj, other, frag in directional:
                if lang == "es":
                    connector = "a" if frag.endswith("superior") else "que"
                    sentences.append(f"{subj} tiene {frag} {connector} {other}.")
                else:
                    sentences.append(f"{subj} has {frag} than {other}.")

    for g in geographic:
        sentences.append(_geographic_sentence(g, lang))

    if not sentences:
        return None
    return " ".join(sentences)


def compare_etfs(tickers: list[str], lang: str = "es", use_cache: bool = True) -> dict:
    """Entry point. `tickers` must already be 2-3 upper-cased, trimmed
    symbols (route layer's job to parse/validate the raw query string) —
    this function re-validates count/duplicates defensively and raises
    ComparisonValidationError if that's violated, but does NOT re-parse
    free-form input.

    Never drops a requested ticker from the response — one that isn't an
    ETF, or whose overview fetch fails outright, shows up in
    `unavailable` instead, same discipline as /etf/cards.

    `comparison_ready` is False whenever fewer than 2 ETFs came back
    valid — the caller (route/frontend) must treat that as an incomplete
    comparison, never render it as if it were finished, per Diego's
    Etapa-2 requirement."""
    tickers = [t.strip().upper() for t in tickers]
    _validate_tickers(tickers)

    etfs: list[dict] = []
    unavailable: list[dict] = []
    for ticker in tickers:
        try:
            overview = get_etf_overview(ticker, use_cache, lang)
        except NotAnETFError:
            unavailable.append({"ticker": ticker, "reason": "not_etf"})
            continue
        except Exception:
            logger.exception("etf/comparison: get_etf_overview(%s) raised unexpectedly", ticker)
            unavailable.append({"ticker": ticker, "reason": "unavailable"})
            continue
        etfs.append(_etf_summary(ticker, overview))

    sector_rows = _align_weightings(etfs, "sector_weightings", "sector_weightings", "sector_weight_sum_in_expected_range") if etfs else []
    country_rows = _align_weightings(etfs, "country_weightings", "country_weightings", "country_weight_sum_in_expected_range") if etfs else []

    performance_note = (
        "El rendimiento histórico se muestra por separado para cada ETF. Esta versión no los compara directamente — "
        "los periodos disponibles, la metodología y el tratamiento de dividendos pueden no ser idénticos entre fondos."
        if lang == "es"
        else "Historical performance is shown separately for each ETF. This version doesn't compare it directly — "
        "the available periods, methodology, and dividend treatment may not be identical across funds."
    )

    insights = build_comparison_insights(etfs, lang)

    return {
        "tickers": tickers,
        "etfs": etfs,
        "unavailable": unavailable,
        "comparison_ready": len(etfs) >= MIN_COMPARE,
        "exposure_comparison": {"sectors": sector_rows, "countries": country_rows},
        "comparison_summary": build_comparison_summary(insights, lang),
        "comparison_insights": insights,
        "performance_note": performance_note,
        "generated_at": time.time(),
    }
