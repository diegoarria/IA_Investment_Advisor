from app.services.recap_emails import build_recap_email, RECAP_DAYS


def test_all_seven_recaps_render_in_both_languages_and_segments():
    assert sorted(RECAP_DAYS) == [1, 2, 3, 4, 5, 6, 7]
    for day in RECAP_DAYS:
        for lang in ("es", "en", None):
            for seg in ("new", "active"):
                subject, html = build_recap_email(day, "Diego Arria", lang, "https://nuvosai.com/join?ref=ABC123", seg)
                assert subject and "nuvosai.com" in html
                assert "asesor" not in html.lower() and "advisor" not in html.lower()


def test_referral_link_only_on_referral_days():
    for day in (2, 4, 6):
        assert "ref=ABC123" in build_recap_email(day, "D", "es", "https://nuvosai.com/join?ref=ABC123")[1]
    for day in (1, 3, 5, 7):
        assert "ref=ABC123" not in build_recap_email(day, "D", "es", "https://nuvosai.com/join?ref=ABC123")[1]


def test_day2_shows_movers_only_for_active_users():
    _, html = build_recap_email(2, "D", "es", "x", "active", [("AAPL", 1.5), ("TSLA", -2.25)])
    assert "AAPL" in html and "+1.50%" in html and "-2.25%" in html
    _, html = build_recap_email(2, "D", "es", "x", "new", [("AAPL", 1.5)])
    assert "AAPL" not in html
