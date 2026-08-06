"""
Benchmark Engine — Fase 3, Incremento 11 (Parte N — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md). The LAST
increment of Fase 3, by design: this engine only has real signal once
there are actually-evaluated rows in `research_hypothesis_outcomes`
(migration 063), which the Thesis Tracker (Parte H, Incremento 8) only
started populating a few increments ago. Building the aggregation logic
before that would have been scaffolding with nothing real to aggregate.

"Medir continuamente la calidad de la IA... la IA debe aprender de sus
resultados históricos." Built honestly: this codebase has no model
fine-tuning/retraining infrastructure, and claiming one would exist here
would violate the same "never fabricate a capability" standard used
everywhere else in Fase 1-3. What IS real and buildable: aggregate,
queryable accuracy statistics (overall, by industry, by sector, by claim
type) that OTHER engines can consult to calibrate their own confidence —
`get_industry_reliability_note` is the integration hook for that, not
wired into any prompt yet (that would be scope creep into Incrementos 5/7
territory) but ready for a future increment to call.

Two-layer design, same split as `nif_service`/every Fase 2 engine:
1. `aggregate_benchmark_report` — pure function over already-fetched rows,
   fully unit-testable with synthetic data, zero I/O.
2. `compute_benchmark_report` — thin fetch (`research_hypothesis_outcomes`,
   all rows) + call into (1).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

_EVALUATED_OUTCOMES = ("confirmed", "refuted")  # "inconclusive" excluded from accuracy_pct — neither a hit nor a miss


@dataclass
class GroupAccuracy:
    key: str  # industry name, sector name, or claim_type
    evaluated_count: int
    confirmed_count: int
    refuted_count: int
    inconclusive_count: int
    accuracy_pct: Optional[float]  # confirmed / (confirmed + refuted); None if nothing decisive yet


@dataclass
class BenchmarkReport:
    total_rows: int
    pending_count: int  # outcome IS NULL — real predictions not yet evaluable
    total_evaluated: int
    total_confirmed: int
    total_refuted: int
    total_inconclusive: int
    accuracy_pct: Optional[float]
    by_industry: list[GroupAccuracy] = field(default_factory=list)
    by_sector: list[GroupAccuracy] = field(default_factory=list)
    by_claim_type: list[GroupAccuracy] = field(default_factory=list)
    weakest_industries: list[str] = field(default_factory=list)  # lowest accuracy_pct, min sample size enforced
    strongest_industries: list[str] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return self.total_evaluated > 0


def _accuracy_pct(confirmed: int, refuted: int) -> Optional[float]:
    decisive = confirmed + refuted
    if decisive == 0:
        return None
    return round(confirmed / decisive * 100, 1)


def _group_by(rows: list[dict], key_field: str, min_sample: int) -> list[GroupAccuracy]:
    buckets: dict[str, list[dict]] = {}
    for r in rows:
        key = r.get(key_field)
        if not key:
            continue
        buckets.setdefault(key, []).append(r)

    groups: list[GroupAccuracy] = []
    for key, group_rows in buckets.items():
        confirmed = sum(1 for r in group_rows if r.get("outcome") == "confirmed")
        refuted = sum(1 for r in group_rows if r.get("outcome") == "refuted")
        inconclusive = sum(1 for r in group_rows if r.get("outcome") == "inconclusive")
        evaluated = confirmed + refuted + inconclusive
        if evaluated < min_sample:
            continue
        groups.append(GroupAccuracy(
            key=key, evaluated_count=evaluated, confirmed_count=confirmed,
            refuted_count=refuted, inconclusive_count=inconclusive,
            accuracy_pct=_accuracy_pct(confirmed, refuted),
        ))
    return sorted(groups, key=lambda g: g.evaluated_count, reverse=True)


def aggregate_benchmark_report(rows: list[dict], min_sample_for_ranking: int = 3) -> BenchmarkReport:
    """Pure function — no I/O, fully deterministic. `rows` are raw
    `research_hypothesis_outcomes` dicts. `min_sample_for_ranking` guards
    `weakest_industries`/`strongest_industries` against a single lucky/
    unlucky call producing a misleading 0%/100% "industry" ranking —
    an industry needs at least this many EVALUATED rows to be ranked at
    all, though it still shows up in `by_industry`'s full breakdown below
    that threshold... actually it does not, by design: a 1-of-1 result is
    not a real signal about "this industry," it's a real signal about
    "this one company," and conflating the two would misrepresent
    genuinely thin data as a trend."""
    evaluated_rows = [r for r in rows if r.get("outcome") in _EVALUATED_OUTCOMES or r.get("outcome") == "inconclusive"]
    pending = [r for r in rows if r.get("outcome") is None]

    confirmed = sum(1 for r in rows if r.get("outcome") == "confirmed")
    refuted = sum(1 for r in rows if r.get("outcome") == "refuted")
    inconclusive = sum(1 for r in rows if r.get("outcome") == "inconclusive")

    by_industry = _group_by(rows, "industry", min_sample_for_ranking)
    by_sector = _group_by(rows, "sector", min_sample_for_ranking)
    by_claim_type = _group_by(rows, "claim_type", min_sample=1)  # claim_type is a small, fixed vocabulary — no thin-sample risk

    ranked_industries = [g for g in by_industry if g.accuracy_pct is not None]
    ranked_industries_sorted = sorted(ranked_industries, key=lambda g: g.accuracy_pct)
    weakest = [g.key for g in ranked_industries_sorted[:3]]
    strongest = [g.key for g in reversed(ranked_industries_sorted[-3:])] if ranked_industries_sorted else []

    return BenchmarkReport(
        total_rows=len(rows), pending_count=len(pending), total_evaluated=len(evaluated_rows),
        total_confirmed=confirmed, total_refuted=refuted, total_inconclusive=inconclusive,
        accuracy_pct=_accuracy_pct(confirmed, refuted),
        by_industry=by_industry, by_sector=by_sector, by_claim_type=by_claim_type,
        weakest_industries=weakest, strongest_industries=strongest,
    )


async def _fetch_all_outcomes() -> list[dict]:
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    res = await run_query(db.table("research_hypothesis_outcomes").select("*"))
    return res.data or []


async def compute_benchmark_report(min_sample_for_ranking: int = 3) -> BenchmarkReport:
    """The single entry point. Fetches every row (this table is small by
    construction — one row per individually-tracked hypothesis, not per
    request) and aggregates."""
    rows = await _fetch_all_outcomes()
    return aggregate_benchmark_report(rows, min_sample_for_ranking=min_sample_for_ranking)


async def get_industry_reliability_note(industry: str, min_sample: int = 3, low_accuracy_threshold: float = 50.0) -> Optional[str]:
    """Integration hook for future engines (e.g. Thesis Engine,
    Incremento 7) to consult: a real, honest caveat when Nuvos's own past
    hypotheses in this industry have been wrong more often than right.
    Returns None — not a fabricated caveat — when there isn't enough real
    evaluated history for this industry yet, or when the industry's
    accuracy is at/above the threshold. NOT wired into any prompt in this
    increment; that integration is left for a later increment to avoid
    scope creep into engines already shipped."""
    report = await compute_benchmark_report(min_sample_for_ranking=min_sample)
    group = next((g for g in report.by_industry if g.key == industry), None)
    if not group or group.accuracy_pct is None or group.accuracy_pct >= low_accuracy_threshold:
        return None
    return (
        f"Nota de confiabilidad: en la industria '{industry}', las hipótesis pasadas de Nuvos se confirmaron "
        f"solo el {group.accuracy_pct}% de las veces ({group.confirmed_count} de {group.confirmed_count + group.refuted_count} "
        f"evaluadas) — trata las conclusiones para esta industria con cautela adicional."
    )
