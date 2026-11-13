"""
Nuvos Plus — Fase 4A: "lo que debes entender" for Patrimonio Vivo. Same
discipline as app.services.etf.insights and app.services.etf.comparison —
every observation is a plain, descriptive restatement of a real, already-
computed number, never a verdict, never a risk score, never a
recommendation, never a claim about an ETF's individual holdings.

Max 5 observations, priority order below, each skipped (not padded) when
its underlying data doesn't support it.
"""

_TOP_HOLDINGS_THRESHOLD_PCT = 40.0   # top 3 positions combined >= this -> worth naming
_DOMINANT_SECTOR_THRESHOLD_PCT = 30.0
_SINGLE_POSITION_THRESHOLD_PCT = 20.0
_COVERAGE_GAP_THRESHOLD_PCT = 90.0   # below this coverage, worth calling out explicitly


def _label(position: dict) -> str:
    return position.get("name") or position["ticker"]


def _top_holdings_observation(valued: list[dict]) -> dict | None:
    ranked = sorted((p for p in valued if p["verifiable"] and p["weight_pct"] is not None), key=lambda p: p["weight_pct"], reverse=True)
    top3 = ranked[:3]
    combined = round(sum(p["weight_pct"] for p in top3), 1)
    if len(top3) < 2 or combined < _TOP_HOLDINGS_THRESHOLD_PCT:
        return None
    names = [_label(p) for p in top3]
    joined = ", ".join(names[:-1]) + f" y {names[-1]}"
    text = f"{joined} representan conjuntamente el {combined:.0f}% del valor verificado de tu portafolio."
    return {"category": "top_holdings", "text": text, "supporting_data": {"tickers": [p["ticker"] for p in top3], "combined_pct": combined}}


def _dominant_sector_observation(sector_exposure: dict, valued: list[dict]) -> dict | None:
    """Diego, 2026-11 (educational-value refinement): must show not just
    THAT a sector dominates but WHERE it comes from — each real
    contributing position's own share, expressed in percentage POINTS of
    the whole portfolio (not a % of the sector, which would read as a
    second, confusable scale) — plus the sector coverage/limitations
    figure in supporting_data so it's inspectable, never just asserted."""
    rows = sector_exposure.get("by_sector") or []
    if not rows:
        return None
    top = rows[0]
    if top["pct_of_verified_total"] is None or top["pct_of_verified_total"] < _DOMINANT_SECTOR_THRESHOLD_PCT:
        return None

    verified_total = sum(p["market_value"] for p in valued if p["verifiable"]) or 0.0
    if verified_total <= 0:
        return None

    contributors = []  # (position, dollar value contributed to this sector)
    for p in valued:
        if not p["verifiable"]:
            continue
        if p["asset_class"] == "equity" and p.get("sector") == top["sector"]:
            contributors.append((p, p["market_value"]))
        elif p["asset_class"] == "etf" and p.get("_etf_overview"):
            for item in p["_etf_overview"]["exposure"]["sector_weightings"]:
                if item["name"] == top["sector"]:
                    contributors.append((p, p["market_value"] * item["weight_pct"] / 100))
    contributors.sort(key=lambda c: c[1], reverse=True)

    contributor_rows = [
        {"ticker": p["ticker"], "name": p.get("name"), "contribution_pct_points": round(value / verified_total * 100, 1)}
        for p, value in contributors
    ]
    top3 = contributor_rows[:3]
    parts = [f"{c['ticker']} aporta {c['contribution_pct_points']:.1f} puntos porcentuales" for c in top3]
    joined = ("; ".join(parts[:-1]) + f"; y {parts[-1]}") if len(parts) > 1 else (parts[0] if parts else None)
    text = f"El sector {top['sector']} representa el {top['pct_of_verified_total']:.0f}% de tu portafolio"
    text += f": {joined}." if joined else "."

    return {
        "category": "dominant_sector",
        "text": text,
        "supporting_data": {
            "sector": top["sector"],
            "total_pct_of_portfolio": top["pct_of_verified_total"],
            "contributors": contributor_rows,
            "sector_coverage_pct": sector_exposure.get("coverage_pct"),
            "unclassified_value": sector_exposure.get("unclassified_value"),
        },
    }


def _single_position_concentration_observation(concentration: dict) -> dict | None:
    top_positions = concentration.get("top_positions") or []
    if not top_positions:
        return None
    top = top_positions[0]
    if top["weight_pct"] is None or top["weight_pct"] < _SINGLE_POSITION_THRESHOLD_PCT:
        return None
    text = f"Tu posición más grande, {top['ticker']}, representa el {top['weight_pct']:.0f}% del valor verificado de tu portafolio."
    return {"category": "single_position_concentration", "text": text, "supporting_data": {"ticker": top["ticker"], "weight_pct": top["weight_pct"]}}


def _coverage_gap_observation(valuation: dict, sector_exposure: dict) -> dict | None:
    val_cov = valuation.get("valuation_coverage_pct")
    sec_cov = sector_exposure.get("coverage_pct")
    gaps = []
    if val_cov is not None and val_cov < _COVERAGE_GAP_THRESHOLD_PCT:
        gaps.append(f"no pudimos verificar el valor de mercado del {100 - val_cov:.0f}% de tu portafolio")
    if sec_cov is not None and sec_cov < _COVERAGE_GAP_THRESHOLD_PCT:
        gaps.append(f"no tenemos datos sectoriales suficientes para el {100 - sec_cov:.0f}% del valor verificado")
    if not gaps:
        return None
    text = "Cobertura incompleta: " + "; ".join(gaps) + "."
    return {"category": "coverage_gap", "text": text, "supporting_data": {"valuation_coverage_pct": val_cov, "sector_coverage_pct": sec_cov}}


def build_insights(valued: list[dict], sector_exposure: dict, concentration: dict, valuation: dict) -> list[dict]:
    """Priority order, Diego 2026-11 (Mi distribución visual refinement):
    concentration of capital first (top holdings, then the single largest
    position), sector exposure with its real contributing positions
    second, coverage limitations last. Deliberately does NOT restate
    `composition` (equity % / ETF %) — that's already shown verbatim in
    the Resumen cards above this panel; repeating it here added no new
    information, which is exactly what this panel must never do."""
    candidates = [
        _top_holdings_observation(valued),
        _single_position_concentration_observation(concentration),
        _dominant_sector_observation(sector_exposure, valued),
        _coverage_gap_observation(valuation, sector_exposure),
    ]
    return [c for c in candidates if c is not None][:5]
