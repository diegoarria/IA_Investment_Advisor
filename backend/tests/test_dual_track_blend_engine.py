from app.services.valuation.dual_track_blend_engine import blend_tracks


def test_matches_real_meta_case():
    """Real numbers validated this session: earnings track ~$845
    confidence 80, FCF track ~$711 confidence 58 -> ~58%/42% weights,
    blended ~$788."""
    r = blend_tracks(
        earnings_track_value=844.67, earnings_confidence=80.0,
        fcf_track_value=710.85, fcf_confidence=58.0,
    )
    assert r is not None
    assert abs(r.earnings_track_weight_pct - 58.0) < 0.5
    assert abs(r.fcf_track_weight_pct - 42.0) < 0.5
    assert abs(r.blended_fair_value - 788.0) < 2.0


def test_equal_confidence_gives_50_50():
    r = blend_tracks(earnings_track_value=100.0, earnings_confidence=50.0,
                      fcf_track_value=200.0, fcf_confidence=50.0)
    assert r is not None
    assert r.earnings_track_weight_pct == 50.0
    assert r.fcf_track_weight_pct == 50.0
    assert r.blended_fair_value == 150.0


def test_none_when_both_confidences_missing():
    assert blend_tracks(earnings_track_value=100.0, earnings_confidence=0.0,
                         fcf_track_value=200.0, fcf_confidence=0.0) is None


def test_higher_confidence_track_dominates_the_blend():
    r = blend_tracks(earnings_track_value=100.0, earnings_confidence=90.0,
                      fcf_track_value=500.0, fcf_confidence=10.0)
    assert r is not None
    # Diego, 2026-09-04 — floor raised 15%->30% (see _MIN_TRACK_WEIGHT_
    # FLOOR_PCT's own comment), so the low-confidence track now gets more
    # room than before; still must stay well short of a 50/50 blend
    # (300.0) since 90 vs 10 is a real, large confidence gap.
    assert r.blended_fair_value <= 200.0
    assert r.blended_fair_value < 250.0  # much closer to the high-confidence earnings value than to 50/50
