from app.services.launch_emails import build_launch_email


def test_all_launch_emails_render_with_referral_link_in_both_languages():
    for n in (1, 2, 3):
        for lang in ("es", "en", None):
            subject, html = build_launch_email(n, "Diego Arria", lang, "https://nuvosai.com/join?ref=ABC123")
            assert subject and "ref=ABC123" in html and "14" in html
            assert "asesor" not in html.lower() and "advisor" not in html.lower()


def test_launch_email_renders_without_a_name():
    _, html = build_launch_email(1, None, "es", "https://nuvosai.com/join?ref=X")
    assert "Hola" not in html
