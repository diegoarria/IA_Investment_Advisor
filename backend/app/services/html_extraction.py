"""
HTML main-text extraction — shared utility.

Context: Fase 2, Incremento 6 (see
/Users/diegoarria/.claude/plans/stateful-painting-flurry.md) needs this
same "fetch a page, pull out the real body text, reject bot-block/paywall
shells" logic for two new real-evidence sources (SEC EDGAR filing text,
best-effort public transcript scraping) that `market.py`'s
`/summarize-news` route already implemented for generic news articles.
Extracted here — service layer, not an API route — so both the existing
route and the new quality-engine evidence sources import the SAME
implementation instead of two copies quietly drifting apart. Behavior is
unchanged from the original (verified by the existing route's own tests/
usage): `trafilatura.extract()` first, a meta-description regex fallback,
then a bot-block keyword reject.
"""

from __future__ import annotations

import re

_BOT_BLOCK_MARKERS = (
    "enable javascript", "please enable js", "verify you are human",
    "access denied", "are you a robot", "checking your browser",
    "attention required", "cloudflare", "subscribe to continue",
    "subscribe now to read", "sign in to continue",
)


def extract_main_text(html: str, max_chars: int = 6000) -> str:
    """Extract the main body text from raw HTML, filtering out bot-block/
    paywall interstitials. Returns "" (never a fabricated summary) when
    nothing usable was found or the page looks like a block/paywall shell
    — the caller must treat "" as "no real evidence available here", not
    retry with a guess."""
    import trafilatura

    extracted = trafilatura.extract(
        html, include_comments=False, include_tables=False, favor_precision=True
    )
    text = (extracted or "").strip()

    if len(text) < 80:
        m = re.search(r'(?:og:description|name="description")[^>]*content="([^"]{40,})"', html, re.IGNORECASE)
        if not m:
            m = re.search(r'content="([^"]{40,})"[^>]*(?:og:description|name="description")', html, re.IGNORECASE)
        if m:
            text = m.group(1).strip()

    lowered = text.lower()
    if len(text) < 80 or any(marker in lowered for marker in _BOT_BLOCK_MARKERS):
        return ""

    return re.sub(r"\s+", " ", text).strip()[:max_chars]
