"""
Document Intelligence Engine — Fase 3, Incremento 2 (Parte A — see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Collects and STRUCTURES primary-source text for a ticker — never just a
summary. The brief is explicit: "No quiero únicamente resúmenes. Quiero
conocimiento reutilizable" — so this module does zero AI narration. It
fetches real text, structures it, tags each real find as an
`EvidenceTaggedClaim`, and persists the whole thing as one knowledge
snapshot other Fase 3 engines (Business/Competitive/Industry/Management
Intelligence, Incrementos 3-5) read directly instead of re-fetching SEC
EDGAR themselves.

Two already-real sources are composed, neither reimplemented here:
1. SEC EDGAR filing text (`sec_edgar_service.fetch_filing_text_sections`)
   — the most recent 10-K (full Item-segmented sections: business, risk
   factors, MD&A) and 10-Q (risk factors + MD&A at their own Item numbers
   — extended in this increment to support 10-Q's different Item
   numbering, see `sec_edgar_service._SECTION_PATTERNS_10Q`).
2. `evidence_sources.gather_evidence_bundle` — covers everything that
   ISN'T an SEC filing: press releases, shareholder letters, investor day,
   earnings call commentary, interviews. Already built (Fase 2, Incremento
   6); this module is simply its first Fase 3 caller.

DEF 14A (proxy) / 8-K (press releases as filed) are NOT fetched by this
increment's default flow — `sec_edgar_service.fetch_filing_text_sections`
now supports them (raw-text fallback, no Item-segmentation), but wiring
them in is deferred to whichever later increment (Management Intelligence,
Timeline) actually needs proxy/8-K text specifically, so this increment
stays scoped to what Business Understanding (Incremento 3) needs first.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.research.claim_schema import EvidenceTaggedClaim


@dataclass
class DocumentIntelligenceResult:
    ticker: str
    filing_10k: Optional[dict]       # {business, risk_factors, mda, filing_date, source_url} or None
    filing_10q: Optional[dict]       # {risk_factors, mda, filing_date, source_url} or None
    evidence_bundle: Optional[dict]  # {search_answer, search_citations, scraped_excerpts} or None
    claims: list[EvidenceTaggedClaim] = field(default_factory=list)

    @property
    def has_any_signal(self) -> bool:
        return bool(self.filing_10k or self.filing_10q or (self.evidence_bundle and self.evidence_bundle.get("has_any_real_evidence")))

    @property
    def most_recent_filing_date(self) -> Optional[str]:
        """The 10-Q (quarterly) is always more recent than the 10-K
        (annual) when both exist — used as this snapshot's
        `source_period` when saved to the knowledge store."""
        if self.filing_10q and self.filing_10q.get("filing_date"):
            return self.filing_10q["filing_date"]
        if self.filing_10k and self.filing_10k.get("filing_date"):
            return self.filing_10k["filing_date"]
        return None

    def to_snapshot_content(self) -> dict:
        """The shape persisted to `company_knowledge_snapshots.content` —
        full real sections (reusable by other engines) plus the claims
        list every snapshot carries."""
        return {
            "filing_10k": self.filing_10k,
            "filing_10q": self.filing_10q,
            "evidence_bundle": self.evidence_bundle,
            "claims": [c.to_dict() for c in self.claims],
        }


def _build_claims(
    filing_10k: Optional[dict], filing_10q: Optional[dict], evidence_bundle: Optional[dict],
) -> list[EvidenceTaggedClaim]:
    """One fact claim per real, distinct source actually found — never a
    claim about content that wasn't retrieved. This is deliberately about
    AVAILABILITY/PROVENANCE ("we have real Business-section text from the
    10-K filed on X"), not an interpretation of what the text says — that
    interpretation is Business/Competitive/Industry/Management
    Intelligence's job (Incrementos 3-5), reading this snapshot."""
    claims: list[EvidenceTaggedClaim] = []

    if filing_10k:
        source_url = filing_10k.get("source_url")
        filing_date = filing_10k.get("filing_date")
        for section_key, label in (("business", "Business"), ("risk_factors", "Risk Factors"), ("mda", "MD&A")):
            if filing_10k.get(section_key):
                claims.append(EvidenceTaggedClaim(
                    text=f"Texto real de la sección {label} del 10-K más reciente está disponible.",
                    kind="fact", source=f"SEC 10-K, {label} — {source_url}", source_date=filing_date, confidence="high",
                ))

    if filing_10q:
        source_url = filing_10q.get("source_url")
        filing_date = filing_10q.get("filing_date")
        for section_key, label in (("risk_factors", "Risk Factors"), ("mda", "MD&A")):
            if filing_10q.get(section_key):
                claims.append(EvidenceTaggedClaim(
                    text=f"Texto real de la sección {label} del 10-Q más reciente está disponible.",
                    kind="fact", source=f"SEC 10-Q, {label} — {source_url}", source_date=filing_date, confidence="high",
                ))

    if evidence_bundle and evidence_bundle.get("has_any_real_evidence"):
        n_excerpts = len(evidence_bundle.get("scraped_excerpts") or [])
        has_search = bool(evidence_bundle.get("search_answer"))
        if has_search or n_excerpts:
            claims.append(EvidenceTaggedClaim(
                text=(
                    "Se encontró evidencia pública adicional real (búsqueda web con fuentes citadas"
                    + (f" y {n_excerpts} extracto(s) real(es) de páginas públicas" if n_excerpts else "")
                    + ") sobre comunicados de prensa, cartas a accionistas o earnings calls recientes."
                ),
                kind="fact", source="Perplexity, búsqueda web con citas reales", source_date=None, confidence="medium",
            ))

    return claims


async def compute_document_intelligence(
    ticker: str, company_name: str, lang: str = "es",
) -> DocumentIntelligenceResult:
    """The single entry point. Zero AI — pure collection and structuring.
    Every sub-fetch degrades independently (a missing 10-Q, e.g. for a
    foreign private issuer that files 6-K instead, must never block the
    10-K or the evidence bundle from still being returned)."""
    import asyncio
    from app.services.sec_edgar_service import fetch_filing_text_sections
    from app.services.quality.evidence_sources import gather_evidence_bundle

    filing_10k, filing_10q, bundle = await asyncio.gather(
        asyncio.to_thread(fetch_filing_text_sections, ticker, "10-K"),
        asyncio.to_thread(fetch_filing_text_sections, ticker, "10-Q"),
        asyncio.to_thread(
            gather_evidence_bundle, ticker, company_name,
            "comunicados de prensa recientes, carta a accionistas, earnings calls y presentaciones para inversionistas",
            lang,
        ),
        return_exceptions=True,
    )
    filing_10k = filing_10k if isinstance(filing_10k, dict) else None
    filing_10q = filing_10q if isinstance(filing_10q, dict) else None

    evidence_bundle_dict: Optional[dict] = None
    if not isinstance(bundle, Exception) and bundle is not None:
        evidence_bundle_dict = {
            "search_answer": bundle.search_answer,
            "search_citations": bundle.search_citations,
            "scraped_excerpts": [
                {"url": e.url, "title": e.title, "excerpt": e.excerpt} for e in bundle.scraped_excerpts
            ],
            "has_any_real_evidence": bundle.has_any_real_evidence,
        }

    claims = _build_claims(filing_10k, filing_10q, evidence_bundle_dict)

    return DocumentIntelligenceResult(
        ticker=ticker.upper(), filing_10k=filing_10k, filing_10q=filing_10q,
        evidence_bundle=evidence_bundle_dict, claims=claims,
    )


async def compute_and_save_document_intelligence(
    ticker: str, company_name: str, lang: str = "es",
) -> DocumentIntelligenceResult:
    """Convenience wrapper: computes and persists in one call, for callers
    (e.g. a future orchestrator or route) that don't need the intermediate
    result for anything else. Always saves — even a `has_any_signal=False`
    result is worth recording as "we looked and found nothing," consistent
    with `knowledge_store.save_snapshot` never being conditional on
    content richness elsewhere in this package."""
    from app.services.research.knowledge_store import save_snapshot

    result = await compute_document_intelligence(ticker, company_name, lang)
    await save_snapshot(
        ticker, "document_intel", result.to_snapshot_content(),
        source_period=result.most_recent_filing_date,
    )
    return result
