"""Anonymous peer benchmarking — "estás por encima del 62% de inversionistas
con tu perfil de riesgo". Never exposes another user's data: the requesting
user's own live metric is compared against a precomputed, anonymous cohort
distribution (no user_id attached, refreshed weekly by job_compute_benchmarks
in worker.py) via a simple percentile-rank lookup.

Premium-exclusive, same as the rest of the Investor Progress Engine this
reuses data from — it reinforces the same "leaving Nuvos means losing a
demonstrated history" positioning, and keeps the input population (premium
users with a portfolio) consistent with what job_compute_benchmarks samples.
"""
import bisect

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user_id
from app.api.routes.upsells import _effective_tier
from app.core.database import get_supabase, run_query
from app.services import investor_progress_service

router = APIRouter(prefix="/benchmark", tags=["benchmark"])

_MIN_SAMPLE = 5

_COHORT_LABEL = {"conservative": "conservador", "moderate": "moderado", "aggressive": "agresivo"}
_METRIC_LABEL = {
    "cumulative_return_pct": "Retorno acumulado",
    "consecutive_months_contributing": "Constancia (meses seguidos aportando)",
}


def _cohort_for(risk_tolerance: str | None) -> str:
    r = (risk_tolerance or "moderate").lower()
    if "conserv" in r:
        return "conservative"
    if "agres" in r or "aggres" in r:
        return "aggressive"
    return "moderate"


def _percentile_rank(value: float, sorted_values: list[float]) -> int:
    """% of the anonymous cohort distribution this value beats or ties."""
    if not sorted_values:
        return 0
    idx = bisect.bisect_left(sorted_values, value)
    return round(idx / len(sorted_values) * 100)


@router.get("/me")
async def get_my_benchmark(user_id: str = Depends(get_current_user_id)):
    db = get_supabase()

    prof_res = await run_query(
        db.table("user_profiles")
        .select("risk_tolerance,subscription_tier,trial_started_at")
        .eq("user_id", user_id)
        .limit(1)
    )
    profile = prof_res.data[0] if prof_res.data else {}
    tier = _effective_tier(profile.get("subscription_tier", "free"), profile.get("trial_started_at"))
    if tier != "premium":
        raise HTTPException(status_code=403, detail="Comparar tu progreso con otros inversionistas es exclusivo de Premium")

    cohort = _cohort_for(profile.get("risk_tolerance"))
    summary = await investor_progress_service.compute_progress_summary(user_id)

    stats_res = await run_query(
        db.table("benchmark_cohort_stats")
        .select("metric_key,values,sample_size,computed_at")
        .eq("cohort_key", cohort)
    )
    stats_by_metric = {r["metric_key"]: r for r in (stats_res.data or [])}

    results = []
    for metric_key, label in _METRIC_LABEL.items():
        if metric_key not in summary:
            continue
        row = stats_by_metric.get(metric_key)
        if not row or row["sample_size"] < _MIN_SAMPLE:
            continue
        your_value = summary[metric_key]
        results.append({
            "metric": metric_key,
            "label": label,
            "your_value": your_value,
            "percentile": _percentile_rank(your_value, row["values"]),
            "cohort_size": row["sample_size"],
            "computed_at": row["computed_at"],
        })

    return {
        "cohort": cohort,
        "cohort_label": _COHORT_LABEL[cohort],
        "results": results,
    }
