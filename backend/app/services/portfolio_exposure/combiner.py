"""
Nuvos Plus — Fase 4A: the portfolio exposure combiner.

Pure computation over an already-aggregated, already-classified position
list — this module never reads Supabase and never decides what counts as
"the user's portfolio" (that's service.py's job). Every function here is
synchronous and side-effect-free except for the real FMP reads inside
`value_position` (price/profile), which are the same cached, honest,
never-fabricating calls the rest of the app already uses.

Hard constraints (Diego, 2026-11 Fase 4A):
1. Weight is by MARKET VALUE, never cost basis (same principle
   decision_engine.compute_portfolio_truth already enforces for Arthur).
2. A position whose market value can't be verified (no quote, no FX rate)
   is NEVER folded into the verified total using its cost basis as a
   silent stand-in — it's excluded from `total_value_verified` and
   `weight_pct`, and shown separately, always.
3. Sector exposure never infers an ETF's INDIVIDUAL holdings from its
   aggregate sector weights — it only ever multiplies an ETF's own real
   sector_weightings percentages by that ETF's own market value, exactly
   what Fase 1's ETF engine already computed and verified.
4. Geographic exposure for an equity (company domicile, from FMP) and for
   an ETF (its underlying assets' real country weights) are NOT the same
   concept — rows are tagged by `methodology` and never silently merged
   into one number that pretends they're equivalent.
5. A sector/country contribution from an ETF only counts as a real
   percentage (not an unknown) when that ETF's OWN weightings coverage is
   confirmed complete (sum_in_expected_range) — same discipline as
   app.services.etf.comparison's _coverage_confirmed.
"""
import copy
import logging
import math
import time

from app.services.asset_classification import EQUITY, ETF, UNKNOWN, classify_asset
from app.services.decision_engine import aggregate_positions_by_ticker
from app.services.etf.translations import SECTOR_ES, translate_country
from app.services.financial_data_service import _usd_rate, get_fmp_quote_price
from app.services.portfolio_exposure import country_codes, equity_profile, sector_taxonomy
from app.services.sector_lookup import get_sector_group_es

logger = logging.getLogger(__name__)

# Sector/country contributions below this absolute dollar value aren't
# worth a row — avoids a list of 40 one-cent "exposures" from rounding
# noise across many small ETF weightings. Purely a display-cleanliness
# filter, applied AFTER every real dollar is counted in the totals.
_MIN_ROW_VALUE_USD = 1.0


def _equity_country_es(iso_code: str | None) -> str | None:
    """FMP's equity /profile `country` is a 2-letter ISO code — expand to
    English via country_codes.py, then through the ETF engine's own
    translate_country so an equity's domicile and an ETF's underlying
    country use the exact same Spanish vocabulary. None (not the raw
    code, not a guess) when the code isn't in our known set."""
    country_en = country_codes.iso_to_english(iso_code)
    return translate_country(country_en, "es") if country_en else None


def aggregate_and_classify(positions: list[dict]) -> list[dict]:
    """One row per real ticker (lots merged, decision_engine's own
    discipline), each tagged with its real asset_class. Never drops a
    ticker for being unclassifiable — UNKNOWN positions stay in the list,
    visible, just excluded from valuation later."""
    agg = aggregate_positions_by_ticker(positions)
    for p in agg:
        p["asset_class"] = classify_asset(p["ticker"])
    return agg


def _convert_to_portfolio_currency(shares: float, native_price: float, native_currency: str | None, portfolio_currency: str) -> tuple[float | None, float | None, str | None]:
    """Returns (market_value, fx_rate_applied, failure_reason). Never
    assumes a missing currency is USD or the portfolio's own currency —
    an unknown quote currency is a verification failure, not a guess."""
    if not native_currency:
        return None, None, "currency_unknown"
    if native_currency.upper() == (portfolio_currency or "USD").upper():
        return round(shares * native_price, 2), 1.0, None
    rate_native_to_usd = _usd_rate(native_currency)
    rate_portfolio_to_usd = _usd_rate(portfolio_currency)
    if rate_native_to_usd is None or rate_portfolio_to_usd is None or rate_portfolio_to_usd == 0:
        return None, None, "fx_conversion_failed"
    fx_rate = rate_native_to_usd / rate_portfolio_to_usd
    return round(shares * native_price * fx_rate, 2), round(fx_rate, 6), None


def value_position(position: dict, portfolio_currency: str) -> dict:
    """Adds valuation fields to one aggregated, classified position.
    cost_basis is always computable (shares × avg_price, already in the
    portfolio's own currency — the same assumption the rest of the app
    already makes about user-entered purchase prices). market_value is
    None whenever it can't be honestly verified; `verifiable` and
    `unverifiable_reason` always say exactly why."""
    ticker = position["ticker"]
    shares = float(position.get("shares") or 0)
    avg_price = float(position.get("avg_price") or 0)
    cost_basis = round(shares * avg_price, 2)
    asset_class = position["asset_class"]

    out = {
        "ticker": ticker,
        "name": position.get("name"),
        "asset_class": asset_class,
        "shares": shares,
        "avg_price": avg_price,
        "cost_basis": cost_basis,
        "market_value": None,
        "verifiable": False,
        "unverifiable_reason": None,
        "quote_currency": None,
        "fx_rate_applied": None,
        "sector": None,
        "country": None,
        # Fase 5D: the fund's real issuer/manager name (e.g. "Vanguard")
        # for ETFs only — never a holding inside the fund, never guessed.
        "etf_company": None,
        # Fase 6B (Nuvos Pulse): the native-currency quote actually used —
        # distinct from `market_value` (already converted to the
        # portfolio's base currency) — a snapshot needs the raw price a
        # provider actually quoted, not just the converted total.
        "price": None,
        "price_fetched_at": time.time(),
        "_etf_overview": None,  # internal only — never serialized in the route response
    }

    if asset_class == UNKNOWN:
        out["unverifiable_reason"] = "unclassified_asset"
        return out

    if asset_class == ETF:
        from app.services.etf.service import NotAnETFError, get_etf_overview
        try:
            overview = get_etf_overview(ticker, use_cache=True, lang="es")
        except NotAnETFError:
            out["unverifiable_reason"] = "unclassified_asset"
            return out
        except Exception:
            logger.exception("portfolio_exposure.value_position(%s): ETF overview fetch raised unexpectedly", ticker)
            out["unverifiable_reason"] = "no_price"
            return out

        # Fase 5D: the fund's own real name (e.g. "Vanguard S&P 500 ETF"),
        # from the SAME already-cached overview fetch above — never a
        # second request. The user's own typed name (if any) always wins;
        # this only fills it in when the user never entered one.
        out["name"] = out["name"] or overview["identification"]["name"]
        out["etf_company"] = overview["identification"]["etf_company"]

        price = overview["price"]["current"]
        if price is None:
            out["unverifiable_reason"] = "no_price"
            return out
        out["price"] = price
        # An ETF's NAV currency is a real FMP field and, for the
        # exchange-traded share class itself, matches its trading
        # currency — a documented approximation, not a guess from
        # nothing (see etf/normalize.py's own confirmed field shapes).
        native_currency = overview["costs"]["nav_currency"]
        market_value, fx_rate, reason = _convert_to_portfolio_currency(shares, price, native_currency, portfolio_currency)
        out["quote_currency"] = native_currency
        out["fx_rate_applied"] = fx_rate
        if market_value is None:
            out["unverifiable_reason"] = reason
            return out
        out["market_value"] = market_value
        out["verifiable"] = True
        out["_etf_overview"] = overview
        return out

    # EQUITY
    price = get_fmp_quote_price(ticker)
    if price is None:
        out["unverifiable_reason"] = "no_price"
        return out
    out["price"] = price
    profile = equity_profile.get_equity_profile(ticker)
    # Fase 5D: the company's real name, from the SAME already-cached
    # /profile call this line already makes for sector/country/currency.
    out["name"] = out["name"] or profile.get("company_name")
    native_currency = profile.get("currency")
    market_value, fx_rate, reason = _convert_to_portfolio_currency(shares, price, native_currency, portfolio_currency)
    out["quote_currency"] = native_currency
    out["fx_rate_applied"] = fx_rate
    if market_value is None:
        out["unverifiable_reason"] = reason
        return out
    out["market_value"] = market_value
    out["verifiable"] = True
    out["country"] = _equity_country_es(profile.get("country"))
    equity_group = get_sector_group_es(ticker)
    out["sector"] = sector_taxonomy.map_equity_sector_to_canonical(equity_group)
    return out


def compute_valuation_summary(valued: list[dict]) -> dict:
    verified = [p for p in valued if p["verifiable"]]
    total_value_verified = round(sum(p["market_value"] for p in verified), 2) if verified else None
    total_cost_basis_all = round(sum(p["cost_basis"] for p in valued), 2)
    verified_cost_basis = round(sum(p["cost_basis"] for p in verified), 2)
    coverage_pct = round(verified_cost_basis / total_cost_basis_all * 100, 1) if total_cost_basis_all > 0 else None
    return {
        "total_value_verified": total_value_verified,
        "total_cost_basis_all_positions": total_cost_basis_all,
        "position_count": len(valued),
        "verified_position_count": len(verified),
        "unverifiable_position_count": len(valued) - len(verified),
        "valuation_coverage_pct": coverage_pct,
    }


def compute_weights(valued: list[dict], total_value_verified: float | None) -> None:
    """Mutates `valued` in place, adding weight_pct — None for any
    unverifiable position, never a number computed against the wrong
    (cost-basis) denominator.

    Also adds `_weight_fraction` — the SAME ratio, at full float precision,
    never rounded. Diego, Fase 5B.1: 'no redondear pesos antes del cálculo
    histórico' — rounding weight_pct to 2 decimals (for display) before
    summing 4 positions' weights back up to validate 'starts at 100' was
    producing 99.99/100.01 drift in the historical engine, a cosmetic
    display concern leaking into a financial calculation. Leading
    underscore keeps it internal-only (stripped by
    service._strip_internal_fields, same as `_etf_overview`) — this is not
    a new public field, just the one true fraction `weight_pct` already
    rounds FROM, kept alongside it instead of thrown away."""
    for p in valued:
        if p["verifiable"] and total_value_verified:
            fraction = p["market_value"] / total_value_verified
            p["weight_pct"] = round(fraction * 100, 2)
            p["_weight_fraction"] = fraction
        else:
            p["weight_pct"] = None
            p["_weight_fraction"] = None


def compute_composition(valued: list[dict], total_value_verified: float | None) -> dict:
    verified = [p for p in valued if p["verifiable"]]
    equity_value = round(sum(p["market_value"] for p in verified if p["asset_class"] == EQUITY), 2)
    etf_value = round(sum(p["market_value"] for p in verified if p["asset_class"] == ETF), 2)
    unknown_cost_basis = round(sum(p["cost_basis"] for p in valued if p["asset_class"] == UNKNOWN), 2)
    denom = total_value_verified or 0
    return {
        "equity_value": equity_value,
        "equity_pct": round(equity_value / denom * 100, 1) if denom else None,
        "etf_value": etf_value,
        "etf_pct": round(etf_value / denom * 100, 1) if denom else None,
        "unknown_asset_value_cost_basis": unknown_cost_basis,
    }


# Fase 8-fix (2026-11-12, real incident): confirmed live against FMP that
# `sector_weightings` means something fundamentally different depending on
# an ETF's underlying asset class — GLD (gold) reports 100% "Cash & Others"
# and AGG (bonds) reports credit-type buckets ("Treasury", "MBS Pass-
# Through", "Sovereign", "Agency"...), neither of which is a GICS equity
# sector. Folding those names into `by_sector` next to real equity sectors
# ("Tecnología", "Salud"...) would present two incompatible classification
# systems as if they were one comparable breakdown — not a fabrication
# (FMP really does report these names), but a false equivalence. Reusing
# etf/translations.SECTOR_ES (the closed, known GICS vocabulary the ETF
# engine already translates into) as the allow-list: any sector_weightings
# entry whose name isn't a recognized GICS sector in either language is
# "not applicable" to an equity-style sector breakdown, not "unavailable" —
# counted separately in `non_equity_style_value`, never merged in and
# never dropped from the fund's own total coverage math.
_KNOWN_EQUITY_STYLE_SECTOR_NAMES = frozenset(SECTOR_ES.keys()) | frozenset(SECTOR_ES.values())


def compute_sector_exposure(valued: list[dict]) -> dict:
    """Σ(equity market value in its own sector) + Σ(ETF market value ×
    that ETF's own real sector weight / 100, only when that ETF's own
    weightings coverage is confirmed complete). Never treats a missing
    ETF-sector coverage flag as "close enough" — an unconfirmed ETF's
    entire value goes to `unclassified_value`, not spread evenly or
    guessed.

    `non_equity_style_value` is the separate, confirmed-but-not-applicable
    bucket above — distinct from `unclassified_value` ("no disponible": we
    couldn't confirm the breakdown at all) vs this one ("no aplica": FMP
    gave a real, complete answer, it just isn't a GICS-style sector)."""
    verified = [p for p in valued if p["verifiable"]]
    totals: dict[str, float] = {}
    unclassified = 0.0
    non_equity_style = 0.0

    for p in verified:
        if p["asset_class"] == EQUITY:
            if p["sector"]:
                totals[p["sector"]] = totals.get(p["sector"], 0.0) + p["market_value"]
            else:
                unclassified += p["market_value"]
        elif p["asset_class"] == ETF:
            overview = p.get("_etf_overview")
            coverage_ok = bool(overview and overview["exposure"]["sector_weight_sum_in_expected_range"])
            if not coverage_ok:
                unclassified += p["market_value"]
                continue
            for item in overview["exposure"]["sector_weightings"]:
                item_value = p["market_value"] * item["weight_pct"] / 100
                if item["name"] in _KNOWN_EQUITY_STYLE_SECTOR_NAMES:
                    totals[item["name"]] = totals.get(item["name"], 0.0) + item_value
                else:
                    non_equity_style += item_value

    verified_total = sum(p["market_value"] for p in verified) or 0.0
    by_sector = [
        {"sector": name, "value": round(value, 2), "pct_of_verified_total": round(value / verified_total * 100, 1) if verified_total else None}
        for name, value in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
        if value >= _MIN_ROW_VALUE_USD
    ]
    # Fase 8-fix §1: `coverage_pct`'s denominator stays exactly what it
    # always was — `verified_total`, the same "valor total verificado"
    # every other coverage figure in this module already uses, never
    # changed silently. `eligible_for_sector_value` makes the real
    # three-way split inspectable instead of forcing a caller to subtract
    # it themselves (and risk getting the denominator wrong): verified
    # total = (value WITH a real GICS sector) + (non_equity_style_value,
    # "no aplica") + (unclassified_value, "no disponible").
    eligible_for_sector_value = round(verified_total - non_equity_style, 2)
    coverage_pct = round((verified_total - unclassified - non_equity_style) / verified_total * 100, 1) if verified_total else None
    return {
        "by_sector": by_sector,
        "coverage_pct": coverage_pct,
        "unclassified_value": round(unclassified, 2),
        "non_equity_style_value": round(non_equity_style, 2),
        "eligible_for_sector_value": eligible_for_sector_value,
    }


def compute_geographic_exposure(valued: list[dict]) -> dict:
    """Two methodologies, two sets of rows, NEVER merged by country name
    even when they coincide (e.g. an equity domiciled in the US and an
    ETF whose underlying assets are 99% US-listed both produce a "United
    States" row, kept separate and tagged) — see module docstring
    constraint 4. The caller (API consumer) decides how to present that,
    this layer never pretends they're the same measurement.

    Diego, 2026-11 (Fase 4C audit, point 1): confirmed and fixed a
    misleading field — each row's percentage is of its OWN asset-class
    subset (equity-only total for `equity_domicile` rows, ETF-only total
    for `etf_underlying` rows), NEVER of the whole verified portfolio.
    The math was already internally consistent (adding to an ETF leaves
    every equity_domicile row's % exactly unchanged, since equities
    weren't touched — confirmed live); the bug was the field being named
    `pct_of_verified_total` as if it meant "of the whole portfolio," the
    same name sector rows correctly use for a genuinely whole-portfolio
    denominator. Renamed to `pct_of_asset_class_value` here specifically,
    and the subset's own dollar total is now exposed alongside it
    (`asset_class_total_value`) so the real denominator is always
    inspectable, never just implied."""
    verified = [p for p in valued if p["verifiable"]]
    equity_totals: dict[str, float] = {}
    equity_unclassified = 0.0
    equity_total_value = 0.0

    etf_totals: dict[str, float] = {}
    etf_unclassified = 0.0
    etf_non_applicable = 0.0
    etf_total_value = 0.0

    for p in verified:
        if p["asset_class"] == EQUITY:
            equity_total_value += p["market_value"]
            # p["country"] is already the translated Spanish name by this
            # point (value_position sets it via _equity_country_es).
            country = p["country"]
            if country:
                equity_totals[country] = equity_totals.get(country, 0.0) + p["market_value"]
            else:
                equity_unclassified += p["market_value"]
        elif p["asset_class"] == ETF:
            overview = p.get("_etf_overview")
            etf_total_value += p["market_value"]
            coverage_ok = bool(overview and overview["exposure"]["country_weight_sum_in_expected_range"])
            if not coverage_ok:
                # Fase 8-fix: confirmed live against FMP — a physically-
                # backed commodity fund (GLD) reports `holdings_count: 0`
                # with no country weightings at all, because there is
                # nothing with a country to attribute (bullion has no
                # domicile). That's "no aplica," not "no disponible" — a
                # real data gap (holdings_count > 0 but weightings still
                # incomplete) stays in etf_unclassified, unchanged.
                if overview and overview["exposure"].get("holdings_count") == 0:
                    etf_non_applicable += p["market_value"]
                else:
                    etf_unclassified += p["market_value"]
                continue
            for item in overview["exposure"]["country_weightings"]:
                etf_totals[item["name"]] = etf_totals.get(item["name"], 0.0) + p["market_value"] * item["weight_pct"] / 100

    by_country = []
    for name, value in sorted(equity_totals.items(), key=lambda kv: kv[1], reverse=True):
        if value >= _MIN_ROW_VALUE_USD:
            by_country.append({
                "country": name, "value": round(value, 2),
                "pct_of_asset_class_value": round(value / equity_total_value * 100, 1) if equity_total_value else None,
                "asset_class_total_value": round(equity_total_value, 2),
                "methodology": "equity_domicile",
            })
    for name, value in sorted(etf_totals.items(), key=lambda kv: kv[1], reverse=True):
        if value >= _MIN_ROW_VALUE_USD:
            by_country.append({
                "country": name, "value": round(value, 2),
                "pct_of_asset_class_value": round(value / etf_total_value * 100, 1) if etf_total_value else None,
                "asset_class_total_value": round(etf_total_value, 2),
                "methodology": "etf_underlying",
            })

    return {
        "by_country": by_country,
        "equity_domicile_coverage_pct": round((equity_total_value - equity_unclassified) / equity_total_value * 100, 1) if equity_total_value else None,
        "etf_underlying_coverage_pct": round((etf_total_value - etf_unclassified - etf_non_applicable) / etf_total_value * 100, 1) if etf_total_value else None,
        "etf_non_applicable_value": round(etf_non_applicable, 2),
        "note_es": (
            "Las filas marcadas \"equity_domicile\" muestran el país donde cada empresa individual tiene su domicilio fiscal. "
            "Las filas marcadas \"etf_underlying\" muestran la distribución geográfica real de los activos dentro de cada ETF. "
            "Son dos formas distintas de medir geografía — no se combinan en una sola cifra para evitar una falsa equivalencia."
        ),
    }


def compute_concentration(valued: list[dict], top_n: int = 5) -> dict:
    verified = [p for p in valued if p["verifiable"] and p["weight_pct"] is not None]
    ranked = sorted(verified, key=lambda p: p["weight_pct"], reverse=True)
    top_positions = [{"ticker": p["ticker"], "name": p["name"], "weight_pct": p["weight_pct"]} for p in ranked[:top_n]]
    largest = ranked[0]["weight_pct"] if ranked else None
    return {"top_positions": top_positions, "largest_single_position_pct": largest}


def compute_full_exposure(valued: list[dict]) -> dict:
    """Fase 4C: the ONE place that assembles valuation + weights +
    composition + sector/geographic exposure + concentration from an
    already-valued position list. Both get_portfolio_exposure() (today's
    real portfolio) and simulate_addition()'s before/after states call
    this SAME function — there is no second implementation of any of
    these formulas for the simulator, per Diego's explicit requirement.

    Mutates `valued` in place (compute_weights does — same as it always
    has); callers that need an unmutated original must pass a copy."""
    valuation = compute_valuation_summary(valued)
    compute_weights(valued, valuation["total_value_verified"])
    return {
        "valuation": valuation,
        "positions": valued,
        "composition": compute_composition(valued, valuation["total_value_verified"]),
        "sector_exposure": compute_sector_exposure(valued),
        "geographic_exposure": compute_geographic_exposure(valued),
        "concentration": compute_concentration(valued),
    }


# ─── Fase 4C-1: "Antes de invertir" — hypothetical new-money simulation ────

_MIN_SIMULATION_AMOUNT = 0.01
# Generous ceiling matching the same order of magnitude as sync.py's own
# _MAX_REASONABLE_PRICE guard — catches fat-finger/garbage input, not a
# real product limit.
_MAX_SIMULATION_AMOUNT = 1_000_000_000


class InvalidSimulationInputError(Exception):
    """Raised for a bad ticker or amount — always a 422 at the route
    layer. Diego, 2026-11: 'si el ticker es desconocido, inexistente o no
    puede verificarse adecuadamente, no presentar una simulación completa
    como válida' — this is how that refusal is enforced, by construction,
    before any exposure math runs at all."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def _validate_amount(amount) -> float:
    if isinstance(amount, bool) or not isinstance(amount, (int, float)):
        raise InvalidSimulationInputError("invalid_amount")
    if not math.isfinite(amount):
        raise InvalidSimulationInputError("invalid_amount")  # NaN/Infinity — never let either reach the math below
    if amount < _MIN_SIMULATION_AMOUNT:
        raise InvalidSimulationInputError("amount_must_be_positive")
    if amount > _MAX_SIMULATION_AMOUNT:
        raise InvalidSimulationInputError("amount_too_large")
    return round(float(amount), 2)  # monetary precision — never operated on past this point with more than cents


def build_hypothetical_position(ticker: str, amount, portfolio_currency: str) -> dict:
    """The ONE new position the simulation adds — never a share count,
    never a simulated purchase price. `amount` is the portfolio's own
    base currency by definition (Diego, 2026-11: 'El importe hipotético
    siempre estará expresado en la moneda base confirmada del
    portafolio'), so market_value = amount directly, no FX conversion,
    no fractional-share math, no commission assumption.

    Raises InvalidSimulationInputError for anything that isn't a real,
    currently classifiable EQUITY or ETF ticker, or an invalid amount —
    the caller must treat that as a hard stop, never a degraded
    simulation. A ticker that IS a real ETF/equity but is missing sector
    or country data still returns normally here (sector/country stay
    None) — that's a partial-coverage case the exposure math already
    handles honestly, not an invalid-input case."""
    ticker = (ticker or "").strip().upper()
    if not ticker:
        raise InvalidSimulationInputError("ticker_required")
    amount = _validate_amount(amount)
    if not portfolio_currency:
        raise InvalidSimulationInputError("portfolio_currency_unknown")

    asset_class = classify_asset(ticker)
    if asset_class == UNKNOWN:
        raise InvalidSimulationInputError("ticker_not_recognized")

    out = {
        "ticker": ticker,
        "name": None,
        "asset_class": asset_class,
        "shares": None,
        "avg_price": None,
        "cost_basis": amount,  # the hypothetical "cost" IS the amount — there is no separate purchase price
        "market_value": amount,
        "verifiable": True,
        "unverifiable_reason": None,
        "quote_currency": portfolio_currency,
        "fx_rate_applied": 1.0,
        "sector": None,
        "country": None,
        "etf_company": None,  # Fase 5D: ETF issuer/manager name only — never a holding
        "price_fetched_at": time.time(),
        "_etf_overview": None,
        "is_hypothetical": True,
    }

    if asset_class == ETF:
        from app.services.etf.service import NotAnETFError, get_etf_overview
        try:
            overview = get_etf_overview(ticker, use_cache=True, lang="es")
        except NotAnETFError:
            # classify_asset and get_etf_overview disagreeing is a real
            # classification mismatch, not a transient issue — refuse
            # rather than present a fund with no verifiable identity.
            raise InvalidSimulationInputError("ticker_not_recognized")
        except Exception:
            logger.exception("portfolio_exposure.build_hypothetical_position(%s): ETF overview fetch raised unexpectedly", ticker)
            # The ticker itself is a confirmed real ETF (classify_asset
            # already verified it) — a transient fetch failure means
            # partial coverage (no sector/country breakdown for THIS
            # position), not an invalid ticker. compute_sector_exposure/
            # compute_geographic_exposure already fold a None
            # `_etf_overview` into `unclassified_value` honestly.
            return out
        out["_etf_overview"] = overview
        out["name"] = overview["identification"]["name"]
        out["etf_company"] = overview["identification"]["etf_company"]
        return out

    # EQUITY
    profile = equity_profile.get_equity_profile(ticker)
    out["name"] = profile.get("company_name")
    out["country"] = _equity_country_es(profile.get("country"))
    out["sector"] = sector_taxonomy.map_equity_sector_to_canonical(get_sector_group_es(ticker))
    return out


def _merge_hypothetical(valued_copy: list[dict], hypothetical: dict) -> list[dict]:
    """Returns the "after" list: the hypothetical's amount is added to an
    EXISTING VERIFIABLE position with the same ticker (Diego: 'no duplicar
    el ticker'), or appended as a new row otherwise. Never touches any
    other position. Operates on `valued_copy` — the caller is responsible
    for it being a copy, never the original list (see simulate_addition)."""
    for p in valued_copy:
        if p["ticker"] == hypothetical["ticker"] and p["verifiable"]:
            p["market_value"] = round(p["market_value"] + hypothetical["market_value"], 2)
            p["is_hypothetical_addition"] = True
            p["hypothetical_amount_added"] = hypothetical["market_value"]
            return valued_copy
    valued_copy.append(hypothetical)
    return valued_copy


def _row_deltas(before_rows: list[dict], after_rows: list[dict], key_fields: tuple[str, ...], pct_field: str = "pct_of_verified_total") -> list[dict]:
    """Percentage-POINT deltas (never a relative/ratio change — Diego,
    2026-11: 'no confundir contribuciones monetarias con cambios en
    participación porcentual') between two sets of exposure rows, matched
    by `key_fields` (e.g. ("sector",) or ("country", "methodology") so an
    equity-domicile and an ETF-underlying row for the same country name
    are never accidentally matched to each other). A row missing on
    either side is treated as a real 0% there (it's genuinely absent from
    that state), never skipped — a sector that only appears after the
    hypothetical investment must show a before_pct of 0.0, not vanish
    from the comparison."""
    def _key(row: dict) -> tuple:
        return tuple(row[f] for f in key_fields)

    before_map = {_key(r): r.get(pct_field) or 0.0 for r in before_rows}
    after_map = {_key(r): r.get(pct_field) or 0.0 for r in after_rows}
    keys = sorted(set(before_map) | set(after_map), key=lambda k: abs(after_map.get(k, 0.0) - before_map.get(k, 0.0)), reverse=True)

    out = []
    for k in keys:
        before_pct = before_map.get(k, 0.0)
        after_pct = after_map.get(k, 0.0)
        row = dict(zip(key_fields, k))
        row["pct_before"] = round(before_pct, 2)
        row["pct_after"] = round(after_pct, 2)
        row["delta_pct_points"] = round(after_pct - before_pct, 2)
        out.append(row)
    return out


def simulate_addition(valued_real: list[dict], hypothetical: dict) -> dict:
    """The entry point. `valued_real` must be the EXACT same already-
    valued position list the caller would otherwise return as today's
    real exposure (Diego, 2026-11: 'los estados antes y después deben
    compartir exactamente la misma fotografía de datos... no volver a
    consultar los datos de las posiciones existentes') — this function
    never re-fetches a single price, quote, or ETF overview; it only
    recombines numbers already fetched once by the caller.

    Never mutates `valued_real` — both the "before" and "after" states
    are computed on independent deep copies, so the caller's own list
    (and whatever it does with it afterward) is untouched."""
    before_valued = copy.deepcopy(valued_real)
    before = compute_full_exposure(before_valued)

    after_valued = _merge_hypothetical(copy.deepcopy(valued_real), copy.deepcopy(hypothetical))
    after = compute_full_exposure(after_valued)

    sector_deltas = _row_deltas(before["sector_exposure"]["by_sector"], after["sector_exposure"]["by_sector"], ("sector",))
    # Country rows use their own asset-class-subset percentage (see
    # compute_geographic_exposure's docstring) — NOT pct_of_verified_total,
    # which would silently read the wrong field here (it doesn't exist on
    # these rows) and produce a 0.0 delta for every country, every time.
    country_deltas = _row_deltas(before["geographic_exposure"]["by_country"], after["geographic_exposure"]["by_country"], ("country", "methodology"), pct_field="pct_of_asset_class_value")

    return {
        "before": before,
        "after": after,
        "sector_deltas": sector_deltas,
        "country_deltas": country_deltas,
        "amount": hypothetical["market_value"],
        "hypothetical_ticker": hypothetical["ticker"],
        "hypothetical_asset_class": hypothetical["asset_class"],
        "before_had_no_verified_positions": before["valuation"]["total_value_verified"] is None,
    }
