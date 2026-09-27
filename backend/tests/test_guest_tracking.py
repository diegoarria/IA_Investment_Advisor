import asyncio
from unittest.mock import patch

from app.services import guest_tracking_service as g


def test_parse_user_agent_common_cases():
    assert g.parse_user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1") == \
        {"device": "celular", "browser": "Safari", "os": "iOS"}
    assert g.parse_user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36") == \
        {"device": "computadora", "browser": "Chrome", "os": "Windows"}
    assert g.parse_user_agent("Googlebot/2.1")["device"] == "bot"
    assert g.parse_user_agent(None) == {"device": None, "browser": None, "os": None}


def test_source_label():
    assert g._source_label({"utm_source": "tiktok", "utm_campaign": "sept"}) == "tiktok / sept"
    assert g._source_label({"referrer": "https://www.google.com/search?q=x"}) == "google.com"
    assert g._source_label({"referrer": "https://nuvosai.com/"}) == "Directo"
    assert g._source_label({}) == "Directo"


def test_geo_from_headers_decodes_city():
    geo = g.geo_from_headers({"x-nuvos-geo-country": "MX", "x-nuvos-geo-city": "San%20Pedro%20Garza%20Garc%C3%ADa"})
    assert geo == {"country": "MX", "region": None, "city": "San Pedro Garza García"}


def test_tracking_never_raises_and_skips_bots():
    with patch.object(g, "get_supabase", side_effect=RuntimeError("db down")):
        asyncio.run(g.track_visit("abc", "/", None, {}, "Mozilla/5.0 (iPhone) Mobile", {}))
        asyncio.run(g.record_chat("abc", "hola"))
    with patch.object(g, "get_supabase") as db:
        asyncio.run(g.track_visit("abc", "/", None, {}, "Googlebot/2.1", {}))
        db.assert_not_called()
