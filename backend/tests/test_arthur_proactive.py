"""Arthur proactivo (2026-09-29): pushes about the user's own money start a
conversation; market-wide/marketing pushes don't; daily cap respected."""
import asyncio

from app.services import arthur_proactive as ap


def run(c):
    return asyncio.run(c)


def test_category_filter():
    assert ap.is_proactive_category("smart_alert_thesis_change")
    assert ap.is_proactive_category("earnings_aapl")
    assert ap.is_proactive_category("price_mover_NVDA")
    assert ap.is_proactive_category("sunday_portfolio_review")
    assert not ap.is_proactive_category("market_open")
    assert not ap.is_proactive_category("morning_brief")
    assert not ap.is_proactive_category("premium_winback")
    assert not ap.is_proactive_category("")


def test_starts_thread_with_followups(monkeypatch):
    created = {}

    async def threads_today(uid):
        return 0

    async def lang(uid):
        return "es"

    async def compose(uid, title, body, data, lang):
        return "Mensaje de Arthur", ["¿Qué significa?", "Escenarios"]

    async def create_thread(uid, category, title, message, actions=None, session_id=None):
        created.update(uid=uid, category=category, message=message, actions=actions)
        return "arthur-1"

    monkeypatch.setattr(ap, "_threads_today", threads_today)
    monkeypatch.setattr(ap, "_lang", lang)
    monkeypatch.setattr(ap, "_compose", compose)
    monkeypatch.setattr(ap, "create_thread", create_thread)
    sid = run(ap.maybe_start_for_push("u1", "earnings_msft", "MSFT reportó", "Creció 12%", {"ticker": "MSFT"}))
    assert sid == "arthur-1"
    assert created["message"] == "Mensaje de Arthur"
    assert [a["data"]["message"] for a in created["actions"]] == ["¿Qué significa?", "Escenarios"]


def test_skips_non_proactive_and_daily_cap(monkeypatch):
    async def threads_today(uid):
        return ap.MAX_THREADS_PER_DAY

    monkeypatch.setattr(ap, "_threads_today", threads_today)
    assert run(ap.maybe_start_for_push("u1", "market_open", "t", "b", {})) is None
    assert run(ap.maybe_start_for_push("u1", "earnings_msft", "t", "b", {})) is None


def test_fallback_message_is_never_empty():
    msg, followups = ap._fallback("Título", "Cuerpo", "es")
    assert "Título" in msg and "Cuerpo" in msg and len(followups) == 2
