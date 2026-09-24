from datetime import datetime, timedelta, timezone

from app.services import session_upsell as u

NOW = datetime(2026, 10, 2, 17, 0, tzinfo=timezone.utc)  # a Friday


def _prof(uid="u1", age_days=30, paid=0):
    return {"user_id": uid, "created_at": (NOW - timedelta(days=age_days)).isoformat(), "paid_1on1_sessions": paid}


def test_account_must_be_at_least_7_days_old():
    assert u.is_eligible(_prof(age_days=7), set(), {}, NOW)
    assert not u.is_eligible(_prof(age_days=6), set(), {}, NOW)
    assert not u.is_eligible({"user_id": "u1", "created_at": None}, set(), {}, NOW)


def test_buyers_and_holders_of_paid_credit_are_excluded():
    assert not u.is_eligible(_prof(), {"u1"}, {}, NOW)
    assert not u.is_eligible(_prof(paid=1), set(), {}, NOW)


def test_frequency_gap_and_lifetime_cap():
    recent = {"u1": [NOW - timedelta(days=7)]}
    assert not u.is_eligible(_prof(), set(), recent, NOW)              # sent a week ago
    two_weeks = {"u1": [NOW - timedelta(days=14)]}
    assert u.is_eligible(_prof(), set(), two_weeks, NOW)               # a Friday-to-Friday gap is fine
    capped = {"u1": [NOW - timedelta(days=d) for d in (70, 56, 42)]}
    assert not u.is_eligible(_prof(), set(), capped, NOW)              # 3 sends ever


def test_copy_renders_in_both_languages_and_links_go_to_the_web_app():
    for lang in ("es", "en", None):
        for free in (False, True):
            title, body, data = u.build_upsell_push(lang, free)
            assert title and body
            assert data == ({"screen": "profile"} if free else {"screen": "products_session"})
            subject, html = u.build_upsell_email("Diego Arria", lang, free)
            assert subject and "https://nuvosai.com/" in html
            low = f"{title} {body} {html}".lower()
            assert "$" not in html                                     # no price hard-coded in the email
            assert not any(b in low for b in ("te recomendamos", "we recommend", "buen momento", "good time to"))
    assert "products?open=session" in u.build_upsell_email("D", "es", False)[1]
    assert "https://nuvosai.com/profile" in u.build_upsell_email("D", "es", True)[1]
