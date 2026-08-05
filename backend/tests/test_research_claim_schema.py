"""
Tests — app.services.research.claim_schema (Fase 3, Incremento 1).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import pytest

from app.services.research.claim_schema import (
    EvidenceTaggedClaim,
    InvalidClaimError,
    min_confidence,
    claims_to_dicts,
    claims_from_dicts,
)


class TestEvidenceTaggedClaimValidation:
    def test_valid_fact_with_source(self):
        claim = EvidenceTaggedClaim(
            text="Revenue grew 12% YoY.", kind="fact",
            source="SEC 10-K FY2025, MD&A", source_date="2025-12-31", confidence="high",
        )
        assert claim.kind == "fact"

    def test_fact_without_source_raises(self):
        with pytest.raises(InvalidClaimError):
            EvidenceTaggedClaim(text="Revenue grew 12% YoY.", kind="fact", source=None)

    def test_inference_without_source_is_allowed(self):
        # inferences point at the claims/data they're derived from, which
        # may be represented as a synthetic "Nuvos: derivado de X" string —
        # but source itself is not hard-required for this kind.
        claim = EvidenceTaggedClaim(text="Margins look structurally improving.", kind="inference")
        assert claim.source is None

    def test_invalid_kind_raises(self):
        with pytest.raises(InvalidClaimError):
            EvidenceTaggedClaim(text="x", kind="rumor")

    def test_invalid_confidence_raises(self):
        with pytest.raises(InvalidClaimError):
            EvidenceTaggedClaim(text="x", kind="ai_opinion", confidence="certain")

    def test_empty_text_raises(self):
        with pytest.raises(InvalidClaimError):
            EvidenceTaggedClaim(text="   ", kind="ai_opinion")

    def test_default_confidence_is_medium(self):
        claim = EvidenceTaggedClaim(text="x", kind="ai_opinion")
        assert claim.confidence == "medium"


class TestMinConfidence:
    def test_returns_the_lowest_confidence_present(self):
        claims = [
            EvidenceTaggedClaim(text="a", kind="fact", source="10-K", confidence="high"),
            EvidenceTaggedClaim(text="b", kind="fact", source="10-K", confidence="low"),
            EvidenceTaggedClaim(text="c", kind="fact", source="10-K", confidence="medium"),
        ]
        assert min_confidence(claims) == "low"

    def test_empty_list_returns_low(self):
        # No sources to ground a derived claim in -> the safest possible
        # default, never a silent "medium".
        assert min_confidence([]) == "low"

    def test_single_high_confidence_claim(self):
        claims = [EvidenceTaggedClaim(text="a", kind="fact", source="10-K", confidence="high")]
        assert min_confidence(claims) == "high"

    def test_a_derived_claim_must_not_exceed_this_bound(self):
        """Direct test of the hard invariant described in the module
        docstring: an inference derived from a low-confidence fact must
        itself be constructed with at most low confidence."""
        facts = [
            EvidenceTaggedClaim(text="Segment X grew.", kind="fact", source="scraped excerpt", confidence="low"),
        ]
        bound = min_confidence(facts)
        inference = EvidenceTaggedClaim(text="Growth is likely durable.", kind="inference", confidence=bound)
        assert inference.confidence == "low"


class TestSerialization:
    def test_round_trip(self):
        claims = [
            EvidenceTaggedClaim(text="a", kind="fact", source="10-K", source_date="2025-12-31", confidence="high"),
            EvidenceTaggedClaim(text="b", kind="ai_opinion", confidence="low"),
        ]
        dicts = claims_to_dicts(claims)
        restored = claims_from_dicts(dicts)
        assert restored == claims

    def test_to_dict_shape(self):
        claim = EvidenceTaggedClaim(text="a", kind="fact", source="10-K", source_date="2025-12-31", confidence="high")
        d = claim.to_dict()
        assert d == {
            "text": "a", "kind": "fact", "source": "10-K",
            "source_date": "2025-12-31", "confidence": "high",
        }

    def test_from_dict_defaults_confidence_to_medium(self):
        claim = EvidenceTaggedClaim.from_dict({"text": "a", "kind": "ai_opinion"})
        assert claim.confidence == "medium"
