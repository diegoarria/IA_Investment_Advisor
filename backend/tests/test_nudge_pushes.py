from datetime import date

from app.services import nudge_pushes as n

# Mon 2026-09-28 .. Sun 2026-10-04
MON, TUE, WED, THU, FRI, SAT, SUN = (date(2026, 9, 28 + i) if i < 3 else date(2026, 10, i - 2) for i in range(7))


def test_rotation_by_weekday_and_none_on_weekends():
    assert [n.nudge_kind_for(d) for d in (MON, TUE, WED, THU, FRI)] == ["invest", "paper", "follow", "concept", "invest"]
    assert n.nudge_kind_for(SAT) is None and n.nudge_kind_for(SUN) is None


def test_every_nudge_renders_in_both_languages_and_never_recommends():
    banned = ("comprar", "compra ", "buy ", "vende", "sell ", "recomend", "recommend", "buen momento", "good time")
    for kind in ("invest", "paper", "follow", "concept"):
        for lang in ("es", "en"):
            title, body, data = n.build_nudge(kind, lang, "Diego", THU)
            assert title and body and data["screen"] in ("portfolio", "paper", "watchlist", "chat")
            text = f"{title} {body}".lower()
            assert not any(b in text for b in banned), (kind, lang, text)


def test_invest_nudge_is_conditional_and_names_nothing():
    _, body, data = n.build_nudge("invest", "es", "Diego", MON)
    assert body.startswith("Si ya decidiste invertir")
    assert data == {"screen": "portfolio"}


def test_follow_promo_only_until_oct_3():
    assert "7 días" in n.build_nudge("follow", "es", "D", date(2026, 10, 1))[1]
    assert "7 días" in n.build_nudge("follow", "es", "D", date(2026, 10, 3))[1]
    assert "7 días" not in n.build_nudge("follow", "es", "D", date(2026, 10, 8))[1]


def test_concept_is_stable_within_a_week_and_rotates_across_weeks():
    a = n.build_nudge("concept", "es", "D", date(2026, 9, 28))[1]
    b = n.build_nudge("concept", "es", "D", date(2026, 10, 1))[1]   # same ISO week
    c = n.build_nudge("concept", "es", "D", date(2026, 10, 5))[1]   # next week
    assert a == b and a != c
    assert "P/E" in " ".join(f"{t} {d}" for t, d in n.CONCEPTS["es"])  # acronym casing survives


def test_positions_detection_handles_both_storage_shapes():
    assert n._has_positions({"positions": [{"ticker": "AAPL"}]})
    assert n._has_positions([{"ticker": "AAPL"}])
    assert not n._has_positions({"positions": []})
    assert not n._has_positions(None)
