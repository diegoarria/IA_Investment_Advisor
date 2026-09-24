from urllib.parse import parse_qs, urlparse

from app.services.offers_share_email import build_offers_share_email, whatsapp_url

LINK = "https://nuvosai.com/join?ref=ABC123"


def test_renders_in_both_languages_with_referral_link_and_whatsapp_button():
    for lang in ("es", "en", None):
        subject, html = build_offers_share_email("Diego Arria", lang, LINK)
        assert subject and LINK in html and "https://wa.me/?text=" in html
        assert "nuvosai.com/profile" in html                      # "Referir amigos" destination
        low = html.lower()
        assert "te recomendamos" not in low and "we recommend" not in low and "buen momento" not in low


def test_whatsapp_message_is_prefilled_and_carries_the_link_and_disclaimer():
    for lang, marker in (("es", "Quiero compartirte Nuvos"), ("en", "I want to share Nuvos")):
        url = whatsapp_url(lang, LINK)
        text = parse_qs(urlparse(url).query)["text"][0]
        assert marker in text and LINK in text
        assert ("no proporciona recomendaciones personalizadas" in text) or ("doesn't provide personalized investment recommendations" in text)
        assert len(url) < 4500                                    # well under WhatsApp/URL limits


def test_only_real_offers_are_listed():
    _, html = build_offers_share_email("D", "es", LINK)
    for must in ("30 días de Premium gratis", "3 acciones en tu watchlist", "primera inversión", "14 días", "30 días más"):
        assert must in html
    from app.services.offers_share_email import _COPY
    for lang in ("es", "en"):
        assert not any("%" in f"{t} {d}" for _, t, d, _ in _COPY[lang]["offers"])   # no invented discounts
