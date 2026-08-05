"""
Evidence Sources — Fase 2, Incremento 6 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md).

Composes the three real evidence primitives built/extended this
increment — SEC EDGAR real filing text (`sec_edgar_service.
fetch_filing_text_sections`), Perplexity search with real citation URLs
(`perplexity_service.search_web_with_citations`), and generic HTML text
extraction (`html_extraction.extract_main_text`) — into the higher-level
"gather real evidence for ticker X on topic Y" function the Moat (Parte
B), Management (Parte D), and Catalysts (Parte G) engines will call in
Incrementos 7-9. No new data source is invented in this module — it is
pure orchestration of the three primitives above.

Every piece of evidence returned is either REAL (a real filing excerpt, a
real search result with a real citation URL, a real scraped page excerpt)
or explicitly absent (None/empty) — this module never fabricates content
to fill a gap. Consistent with the same standard already established
throughout this codebase (capital_allocation_engine.ACQUISITIONS_NOTE,
earnings_quality_engine.ACQUISITIONS_GROWTH_NOTE, and the explicit
guardrail research_service.py already had against claiming to have read a
filing verbatim).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

_SCRAPE_TIMEOUT = 12
_SCRAPE_USER_AGENT = "Mozilla/5.0 (compatible; NuvosAI/1.0; +https://nuvosai.app)"
_MAX_EXCERPTS_PER_BUNDLE = 3
_EXCERPT_MAX_CHARS = 1500


@dataclass
class ScrapedExcerpt:
    url: str
    title: Optional[str]
    excerpt: str


@dataclass
class EvidenceBundle:
    ticker: str
    topic: str
    filing_evidence: dict = field(default_factory=dict)
    search_answer: str = ""
    search_citations: list[dict] = field(default_factory=list)
    scraped_excerpts: list[ScrapedExcerpt] = field(default_factory=list)

    @property
    def has_any_real_evidence(self) -> bool:
        """False only when EVERY source came back empty — the signal a
        caller (e.g. the Moat Engine) should use to say "no encontramos
        evidencia pública real para este factor" instead of presenting an
        empty bundle as if it were simply "low intensity"."""
        return bool(self.filing_evidence or self.search_answer or self.scraped_excerpts)


def gather_filing_evidence(ticker: str, form_type: str = "10-K") -> dict:
    """Real 10-K/10-Q text (Business, Risk Factors, MD&A). Thin wrapper
    around `sec_edgar_service.fetch_filing_text_sections` — kept here so
    every evidence-gathering caller goes through this module instead of
    reaching into `sec_edgar_service` directly, matching the "one place
    for this logic" pattern already used for
    `quality_engine.build_quality_score_from_analysis`."""
    from app.services.sec_edgar_service import fetch_filing_text_sections
    return fetch_filing_text_sections(ticker, form_type=form_type) or {}


def search_public_commentary(ticker: str, company_name: str, topic: str, lang: str = "es") -> dict:
    """Real Perplexity search with real citation URLs for a specific
    qualitative topic (e.g. "moat y ventaja competitiva", "track record de
    guidance del management", "riesgos competitivos recientes"). Never
    claims to have read a full transcript/letter verbatim — only reports
    what a real web search actually found, with real, followable links."""
    from app.services.perplexity_service import search_web_with_citations
    query = (
        f"{company_name} ({ticker}) — {topic}. Cita fuentes verificables y declaraciones reales de management "
        f"cuando existan (earnings calls, entrevistas, comunicados)."
    )
    system_prompt = (
        "Eres un analista de research. Responde en español, de forma concisa y factual, citando SOLO "
        "información real que encuentres — nunca inventes citas ni cifras. Máximo 300 palabras."
        if lang != "en" else
        "You are a research analyst. Respond in English, concisely and factually, citing ONLY real "
        "information you find — never invent quotes or figures. Max 300 words."
    )
    return search_web_with_citations(query, system_prompt=system_prompt)


def scrape_public_excerpt(url: str) -> Optional[str]:
    """Best-effort real text extraction from a public page (e.g. a free-
    preview transcript page, an investor-relations page, a news article
    Perplexity's search surfaced). Returns None — never fabricated — if
    the page is inaccessible, paywalled, or too short to be real usable
    content; `html_extraction.extract_main_text`'s bot-block/paywall
    detection already handles the "looks like content but isn't" case."""
    import requests
    from app.services.html_extraction import extract_main_text
    try:
        r = requests.get(url, timeout=_SCRAPE_TIMEOUT, headers={"User-Agent": _SCRAPE_USER_AGENT})
        if r.status_code != 200:
            return None
        text = extract_main_text(r.text)
        return text or None
    except Exception as e:
        logger.info("scrape_public_excerpt(%s) failed: %s", url, e)
        return None


def format_evidence_bundle_for_prompt(bundle: "EvidenceBundle") -> str:
    """Renders an `EvidenceBundle` into plain text for an AI deep-dive
    prompt — real filing excerpts, real search answer with real citation
    URLs, real scraped excerpts. Truncated per-field so one very long
    section can't blow out the prompt budget. Shared by every Incremento
    7-9 deep dive (Moat, Management, Catalysts) so the "how do we present
    evidence to the model" logic lives in exactly one place — promoted
    here (Incremento 8) from `moat_engine._format_evidence_bundle`, which
    becomes a thin alias."""
    lines: list[str] = []
    filing = bundle.filing_evidence or {}
    if filing.get("business"):
        lines.append(f"[10-K, sección Business, real, fuente: {filing.get('source_url')}]\n{filing['business'][:2000]}")
    if filing.get("risk_factors"):
        lines.append(f"[10-K, sección Risk Factors, real]\n{filing['risk_factors'][:2000]}")
    if filing.get("mda"):
        lines.append(f"[10-K, sección MD&A, real]\n{filing['mda'][:1500]}")
    if bundle.search_answer:
        lines.append(f"[Búsqueda web real con fuentes citadas]\n{bundle.search_answer}")
    for excerpt in bundle.scraped_excerpts:
        lines.append(f"[Extracto real de {excerpt.url}{f' ({excerpt.title})' if excerpt.title else ''}]\n{excerpt.excerpt[:1000]}")
    return "\n\n".join(lines)


def gather_evidence_bundle(ticker: str, company_name: str, topic: str, lang: str = "es") -> EvidenceBundle:
    """The single entry point Incrementos 7-9 (Moat/Management/Catalysts)
    call: combines real 10-K text + a real cited web search + best-effort
    excerpts scraped from up to `_MAX_EXCERPTS_PER_BUNDLE` of the search's
    own real citation URLs, into one evidence bundle. Every individual
    source degrades independently (a failed SEC fetch doesn't block the
    Perplexity search, a failed scrape just isn't included) — same
    philosophy as `nif_service._safe`'s per-call independence."""
    filing_evidence = gather_filing_evidence(ticker)
    search = search_public_commentary(ticker, company_name, topic, lang)

    scraped_excerpts: list[ScrapedExcerpt] = []
    for citation in (search.get("citations") or [])[:_MAX_EXCERPTS_PER_BUNDLE]:
        url = citation.get("url")
        if not url:
            continue
        text = scrape_public_excerpt(url)
        if text:
            scraped_excerpts.append(ScrapedExcerpt(
                url=url, title=citation.get("title"), excerpt=text[:_EXCERPT_MAX_CHARS],
            ))

    return EvidenceBundle(
        ticker=ticker.upper(), topic=topic,
        filing_evidence=filing_evidence,
        search_answer=search.get("answer", ""),
        search_citations=search.get("citations") or [],
        scraped_excerpts=scraped_excerpts,
    )
