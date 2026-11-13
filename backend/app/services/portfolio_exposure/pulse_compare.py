"""
Nuvos Pulse — Fase 6C: el motor de comparación. Responde exclusivamente
"¿qué cambió entre dos fotografías verificables?" — determinista, sin IA,
nunca una segunda consulta de precios, nunca una reconstrucción
retroactiva de cantidades o de composición de ETFs. Cada número usado
aquí ya estaba congelado dentro de los dos snapshots; este módulo nunca
llama a FMP, a `combiner.py`, ni a ningún proveedor.

Precisión (Diego, Fase 6C §5): los deltas de posición usan
`weight_fraction` (precisión completa, Fase 5B.1) directamente. Los
deltas de sector/composición/geografía NO tienen un campo de fracción
separado en el snapshot — en vez de usar el `pct_of_verified_total` ya
redondeado a 2 decimales que `combiner.py` persiste, este módulo
recalcula la fracción exacta dividiendo el `value` en dólares (también
ya congelado, nunca re-consultado) entre el denominador verificado
correspondiente de CADA snapshot por separado — nunca mezclando
denominadores de A y B.

Causalidad (alcance aprobado en Fase 6A.1, reafirmado en 6C §6): solo
Nivel A (cambio observado, en `changes`) y Nivel E (causa no
determinada, en `causality`). Nunca atribuye a compras, ventas o
movimientos de mercado sin una demostración algebraica — que esta fase
deliberadamente no implementa.

Seguridad: `compare_latest_for_portfolio` es el ÚNICO punto de entrada
pensado para usarse con datos de un usuario real — consulta
`portfolio_pulse_snapshots` siempre filtrada por `user_id` Y
`portfolio_id`, nunca acepta un `snapshot_id` arbitrario de un llamador.
`compare_snapshots` (la lógica pura, para pruebas con fixtures sintéticas
explícitas) igual exige que ambas filas compartan `user_id`/`portfolio_id`
— defensa en profundidad, no solo en la capa de consulta.
"""
import logging

from app.services.portfolio_exposure.pulse_thresholds import (
    COMPOSITION_DELTA_MIN_PP,
    CONCENTRATION_DELTA_MIN_PP,
    MAX_COVERAGE_GAP_PP,
    MIN_VALUATION_COVERAGE_PCT,
    PRIMARY_CHANGE_CATEGORY_PRIORITY,
    SECTOR_DELTA_MIN_PP,
)

logger = logging.getLogger(__name__)

_NO_CHANGE_NOTE_ES = "No se detectaron cambios relevantes entre ambas fechas."
_UNDETERMINED_NOTE_ES = (
    "La distribución cambió entre ambas fechas, pero no contamos con información "
    "suficiente para identificar completamente las causas."
)


def _snapshot_summary(row: dict) -> dict:
    return {
        "id": row["id"], "observed_at": row["observed_at"], "period_key": row["period_key"],
        "snapshot_type": row["snapshot_type"], "verification_state": row["verification_state"],
        "valuation_coverage_pct": row["valuation_coverage_pct"],
    }


def _order_chronologically(a: dict, b: dict) -> tuple[dict, dict]:
    """Nunca confía en que el llamador etiquetó correctamente cuál es
    'antes' y cuál es 'después' — lo decide siempre por `observed_at`."""
    return (a, b) if a["observed_at"] <= b["observed_at"] else (b, a)


def _position_index(snapshot: dict) -> dict[str, dict]:
    return {
        p["ticker"]: p
        for p in (snapshot.get("positions") or [])
        if p.get("verifiable") and p.get("weight_fraction") is not None
    }


def _reclassified_tickers(before: dict, after: dict) -> list[str]:
    """Fase 6D §1 — tickers presentes y verificables en AMBOS snapshots
    cuya `asset_class` cambió entre uno y el otro (p. ej. una
    reclasificación de equity a ETF en el proveedor). Un cambio asÍ nunca
    debe presentarse como un movimiento económico real en sector o
    composición — ambas son agregaciones POR asset_class."""
    before_idx, after_idx = _position_index(before), _position_index(after)
    return sorted(t for t in (set(before_idx) & set(after_idx)) if before_idx[t]["asset_class"] != after_idx[t]["asset_class"])


def comparability_gate(before: dict, after: dict) -> dict:
    """Fase 6C §3 — el gate determinista. Nunca asume que dos snapshots
    'full' son automáticamente comparables en TODAS las dimensiones:
    cobertura de valoración, sectorial y geográfica se evalúan por
    separado, cada una puede suprimirse de forma independiente sin
    ocultar las demás."""
    if before["user_id"] != after["user_id"] or before["portfolio_id"] != after["portfolio_id"]:
        return {"status": "not_comparable", "reason": "different_user_or_portfolio", "warnings": []}
    if before["id"] == after["id"]:
        return {"status": "not_comparable", "reason": "same_snapshot", "warnings": []}
    if before["snapshot_type"] == after["snapshot_type"] and before["period_key"] == after["period_key"]:
        # Dos intentos del MISMO slot mensual -- nunca dos períodos independientes.
        return {"status": "not_comparable", "reason": "same_period", "warnings": []}
    if before["base_currency"] != after["base_currency"]:
        return {"status": "not_comparable", "reason": "currency_mismatch", "warnings": []}
    if before["methodology_version"] != after["methodology_version"]:
        return {"status": "not_comparable", "reason": "methodology_mismatch", "warnings": []}
    if before["verification_state"] == "failed" or after["verification_state"] == "failed":
        return {"status": "not_comparable", "reason": "unverifiable_snapshot", "warnings": []}

    cov_before, cov_after = before["valuation_coverage_pct"], after["valuation_coverage_pct"]
    if cov_before is None or cov_after is None or cov_before < MIN_VALUATION_COVERAGE_PCT or cov_after < MIN_VALUATION_COVERAGE_PCT:
        return {"status": "not_comparable", "reason": "insufficient_coverage", "warnings": []}

    warnings = []

    sector_before = (before.get("sector_exposure") or {}).get("coverage_pct")
    sector_after = (after.get("sector_exposure") or {}).get("coverage_pct")
    if sector_before is None or sector_after is None:
        warnings.append({"dimension": "sectors", "reason": "sector_coverage_unavailable"})
    elif abs(sector_after - sector_before) > MAX_COVERAGE_GAP_PP:
        warnings.append({"dimension": "sectors", "reason": "sector_coverage_gap", "detail": {"before": sector_before, "after": sector_after}})

    geo_before = before.get("geographic_exposure") or {}
    geo_after = after.get("geographic_exposure") or {}
    for methodology, field in (("equity_domicile", "equity_domicile_coverage_pct"), ("etf_underlying", "etf_underlying_coverage_pct")):
        cb, ca = geo_before.get(field), geo_after.get(field)
        if cb is None or ca is None:
            warnings.append({"dimension": f"geography_{methodology}", "reason": "geography_coverage_unavailable"})
        elif abs(ca - cb) > MAX_COVERAGE_GAP_PP:
            warnings.append({"dimension": f"geography_{methodology}", "reason": "geography_coverage_gap", "detail": {"before": cb, "after": ca}})

    reclassified = _reclassified_tickers(before, after)
    if reclassified:
        # Fase 6D §1: una reclasificación de activo (equity<->ETF) corrompe
        # tanto la agregación sectorial como la de composición acciones/ETF
        # -- ambas son sumas POR asset_class. Se suprimen ambas, nunca
        # presentadas como un movimiento económico real; posiciones y
        # geografía siguen operativas (geografía ya separa por methodology,
        # no por asset_class crudo, así que no hereda el mismo problema).
        warnings.append({"dimension": "sectors", "reason": "asset_reclassified", "detail": {"tickers": reclassified}})
        warnings.append({"dimension": "composition", "reason": "asset_reclassified", "detail": {"tickers": reclassified}})

    return {"status": "partial" if warnings else "comparable", "reason": None, "warnings": warnings}


def compute_position_changes(before: dict, after: dict) -> list[dict]:
    """Fase 6C §4A/§5 — delta en puntos porcentuales a partir de
    `weight_fraction` (precisión completa), nunca del `weight_pct`
    redondeado. Una posición ausente en `after` nunca se etiqueta como
    vendida — solo 'ya no está en el universo verificado', que puede
    deberse a una venta real, a un problema de cobertura, o a cualquier
    otra causa que este motor no demuestra."""
    before_idx, after_idx = _position_index(before), _position_index(after)
    tickers = sorted(set(before_idx) | set(after_idx))
    out = []
    for ticker in tickers:
        p_before, p_after = before_idx.get(ticker), after_idx.get(ticker)
        frac_before = p_before["weight_fraction"] if p_before else None
        frac_after = p_after["weight_fraction"] if p_after else None
        if p_before and p_after:
            status = "existing"
        elif p_after:
            status = "new"
        else:
            status = "no_longer_verified"
        classification_changed = bool(p_before and p_after and p_before.get("asset_class") != p_after.get("asset_class"))
        delta_pp = (frac_after - frac_before) * 100 if (frac_before is not None and frac_after is not None) else None
        out.append({
            "ticker": ticker,
            "name": (p_after or p_before or {}).get("name"),
            "weight_before_pct": round(frac_before * 100, 4) if frac_before is not None else None,
            "weight_after_pct": round(frac_after * 100, 4) if frac_after is not None else None,
            "delta_pp": round(delta_pp, 4) if delta_pp is not None else None,
            "status": status,
            "classification_changed": classification_changed,
        })
    out.sort(key=lambda r: abs(r["delta_pp"]) if r["delta_pp"] is not None else -1, reverse=True)
    return out


def _dollar_fraction_rows(by_rows: list[dict], total_value_verified: float | None, key_field: str) -> dict[str, float]:
    """Recomputa la fracción EXACTA de cada fila a partir de su valor en
    dólares ya congelado, dividido por el denominador verificado de ESE
    mismo snapshot — nunca el `pct_of_verified_total` pre-redondeado que
    `combiner.py` ya persiste para mostrarse en la UI."""
    if not total_value_verified:
        return {}
    return {row[key_field]: (row.get("value") or 0.0) / total_value_verified for row in (by_rows or [])}


def compute_sector_changes(before: dict, after: dict, suppressed: bool) -> list[dict] | None:
    if suppressed:
        return None
    before_sectors = (before.get("sector_exposure") or {}).get("by_sector") or []
    after_sectors = (after.get("sector_exposure") or {}).get("by_sector") or []
    frac_before = _dollar_fraction_rows(before_sectors, before.get("total_value_verified"), "sector")
    frac_after = _dollar_fraction_rows(after_sectors, after.get("total_value_verified"), "sector")
    names = sorted(set(frac_before) | set(frac_after))
    out = []
    for name in names:
        fb, fa = frac_before.get(name, 0.0), frac_after.get(name, 0.0)
        out.append({
            "sector": name,
            "before_pct": round(fb * 100, 4),
            "after_pct": round(fa * 100, 4),
            "delta_pp": round((fa - fb) * 100, 4),
        })
    out.sort(key=lambda r: abs(r["delta_pp"]), reverse=True)
    return out


def compute_composition_changes(before: dict, after: dict) -> dict | None:
    """Fase 6C §4C — misma metodología de valorización que
    `portfolio_exposure` ya aplica; aquí solo se re-presenta a partir de
    los valores en dólares ya congelados en cada snapshot."""
    comp_before, comp_after = before.get("composition") or {}, after.get("composition") or {}
    total_before, total_after = before.get("total_value_verified"), after.get("total_value_verified")
    if not total_before or not total_after:
        return None
    equity_before = (comp_before.get("equity_value") or 0.0) / total_before
    equity_after = (comp_after.get("equity_value") or 0.0) / total_after
    etf_before = (comp_before.get("etf_value") or 0.0) / total_before
    etf_after = (comp_after.get("etf_value") or 0.0) / total_after
    return {
        "equity_before_pct": round(equity_before * 100, 4), "equity_after_pct": round(equity_after * 100, 4),
        "equity_delta_pp": round((equity_after - equity_before) * 100, 4),
        "etf_before_pct": round(etf_before * 100, 4), "etf_after_pct": round(etf_after * 100, 4),
        "etf_delta_pp": round((etf_after - etf_before) * 100, 4),
    }


def compute_geography_changes(before: dict, after: dict, suppressed: dict[str, bool]) -> dict:
    """Fase 6C §4D — domicilio de acciones y exposición subyacente de
    ETFs se calculan y se suprimen de forma COMPLETAMENTE independiente;
    nunca se mezclan como si midieran lo mismo."""
    result: dict[str, list[dict] | None] = {}
    for methodology in ("equity_domicile", "etf_underlying"):
        if suppressed.get(methodology):
            result[methodology] = None
            continue
        before_rows = [r for r in (before.get("geographic_exposure") or {}).get("by_country") or [] if r.get("methodology") == methodology]
        after_rows = [r for r in (after.get("geographic_exposure") or {}).get("by_country") or [] if r.get("methodology") == methodology]
        denom_before = before_rows[0]["asset_class_total_value"] if before_rows else None
        denom_after = after_rows[0]["asset_class_total_value"] if after_rows else None
        frac_before = _dollar_fraction_rows(before_rows, denom_before, "country")
        frac_after = _dollar_fraction_rows(after_rows, denom_after, "country")
        names = sorted(set(frac_before) | set(frac_after))
        rows = []
        for name in names:
            fb, fa = frac_before.get(name, 0.0), frac_after.get(name, 0.0)
            rows.append({"country": name, "before_pct": round(fb * 100, 4), "after_pct": round(fa * 100, 4), "delta_pp": round((fa - fb) * 100, 4)})
        rows.sort(key=lambda r: abs(r["delta_pp"]), reverse=True)
        result[methodology] = rows
    return result


def select_primary_change(changes: dict) -> dict | None:
    """Fase 6C §7 — candidato único y determinista para el futuro
    Resumen. Nunca modifica `primaryInsight.ts` (eso es Fase 6D); esto
    solo calcula el candidato, con umbrales centralizados en
    `pulse_thresholds.py`. Desempate por orden de categoría fijo, nunca
    por orden de inserción."""
    candidates = []

    if changes.get("sectors"):
        top = changes["sectors"][0]  # ya viene ordenado por |delta| descendente
        if abs(top["delta_pp"]) >= SECTOR_DELTA_MIN_PP:
            candidates.append({"category": "sector", "label": top["sector"], "before_pct": top["before_pct"], "after_pct": top["after_pct"], "delta_pp": top["delta_pp"]})

    composition = changes.get("composition")
    if composition:
        equity_mag, etf_mag = abs(composition["equity_delta_pp"]), abs(composition["etf_delta_pp"])
        if max(equity_mag, etf_mag) >= COMPOSITION_DELTA_MIN_PP:
            label = "etf" if etf_mag >= equity_mag else "equity"
            candidates.append({
                "category": "composition", "label": label,
                "before_pct": composition[f"{label}_before_pct"], "after_pct": composition[f"{label}_after_pct"],
                "delta_pp": composition[f"{label}_delta_pp"],
            })

    existing_positions = [p for p in changes.get("positions", []) if p["status"] == "existing" and p["delta_pp"] is not None]
    if existing_positions:
        top = max(existing_positions, key=lambda p: abs(p["delta_pp"]))
        if abs(top["delta_pp"]) >= CONCENTRATION_DELTA_MIN_PP:
            candidates.append({"category": "concentration", "label": top["ticker"], "before_pct": top["weight_before_pct"], "after_pct": top["weight_after_pct"], "delta_pp": top["delta_pp"]})

    if not candidates:
        return None

    by_category = {c["category"]: c for c in candidates}
    eligible_in_order = [by_category[cat] for cat in PRIMARY_CHANGE_CATEGORY_PRIORITY if cat in by_category]
    return max(eligible_in_order, key=lambda c: abs(c["delta_pp"]))


def _build_causality(primary_change: dict | None, changes: dict) -> dict:
    has_any_change = bool(primary_change) or any(
        abs(p["delta_pp"]) > 0 for p in changes.get("positions", []) if p.get("delta_pp") is not None
    )
    if not has_any_change:
        return {"level": "no_change", "note_es": _NO_CHANGE_NOTE_ES}
    return {"level": "undetermined", "note_es": _UNDETERMINED_NOTE_ES}


def compare_snapshots(a: dict, b: dict) -> dict:
    """Lógica pura (sin DB). `a`/`b` son dos filas YA obtenidas de
    `portfolio_pulse_snapshots` (con su payload JSONB ya deserializado) —
    nunca se consulta nada aquí dentro. Determina el orden cronológico
    internamente; el llamador no necesita saber cuál es 'antes'."""
    before, after = _order_chronologically(a, b)
    gate = comparability_gate(before, after)

    if gate["status"] == "not_comparable":
        return {"available": False, "reason": gate["reason"]}

    suppressed_dims = {w["dimension"] for w in gate["warnings"]}
    changes = {
        "positions": compute_position_changes(before, after),
        "sectors": compute_sector_changes(before, after, suppressed="sectors" in suppressed_dims),
        "composition": None if "composition" in suppressed_dims else compute_composition_changes(before, after),
        "geography": compute_geography_changes(before, after, suppressed={
            "equity_domicile": "geography_equity_domicile" in suppressed_dims,
            "etf_underlying": "geography_etf_underlying" in suppressed_dims,
        }),
    }
    primary_change = select_primary_change(changes)
    causality = _build_causality(primary_change, changes)

    return {
        "available": True,
        "snapshot_before": _snapshot_summary(before),
        "snapshot_after": _snapshot_summary(after),
        "comparability": gate,
        "changes": changes,
        "primary_change": primary_change,
        "causality": causality,
    }


async def _fetch_current_snapshots(user_id: str, portfolio_id: str, snapshot_type: str) -> list[dict]:
    from app.core.database import get_supabase, run_query
    db = get_supabase()
    res = await run_query(
        db.table("portfolio_pulse_snapshots")
        .select("*")
        .eq("user_id", user_id).eq("portfolio_id", portfolio_id)
        .eq("snapshot_type", snapshot_type).eq("is_current", True)
        .order("observed_at", desc=True)
    )
    return res.data or []


async def compare_latest_for_portfolio(user_id: str, portfolio_id: str, snapshot_type: str = "month_end") -> dict:
    """El único punto de entrada seguro para datos reales — la consulta
    SIEMPRE está filtrada por `user_id` Y `portfolio_id`; nunca acepta un
    `snapshot_id` de un llamador, por lo que nunca puede comparar/leer el
    snapshot de otro usuario mediante un id arbitrario.

    Localiza el snapshot vigente más reciente y el vigente más reciente
    de un PERÍODO distinto (nunca dos intentos del mismo mes como si
    fueran independientes). Si no hay al menos dos períodos vigentes
    distintos, devuelve `insufficient_history` — nunca fabrica una
    fotografía anterior."""
    rows = await _fetch_current_snapshots(user_id, portfolio_id, snapshot_type)
    if len(rows) < 2:
        return {"available": False, "reason": "insufficient_history"}

    after = rows[0]
    before = next((r for r in rows[1:] if r["period_key"] != after["period_key"]), None)
    if before is None:
        return {"available": False, "reason": "insufficient_history"}

    return compare_snapshots(before, after)
