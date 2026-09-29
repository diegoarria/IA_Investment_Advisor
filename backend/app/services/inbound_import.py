"""Importación automática por correo (Diego, 2026-09-29): GBM and Actinver
have no API, but they email trade confirmations and monthly statements.
Each user gets a private forwarding address (<alias>@INBOUND_EMAIL_DOMAIN);
they set a mail rule ONCE ("forward everything from GBM/Actinver here") and
from then on:

  1. the inbound-email webhook (routes/imports.py) receives the message,
  2. Haiku reads the body + PDF attachments and extracts either trades
     (BUY/SELL confirmations) or a full positions statement,
  3. a statement is reconciled against the user's current Nuvos portfolio
     into the operations that would make them match,
  4. Arthur STARTS a conversation ("Recibí tu confirmación de GBM: compra de
     10 AMZN a $X — ¿la registro?") with one-tap chips, and a push.

Nothing is written to the portfolio until the user taps "Registrar" — the
write goes through the exact same helpers Arthur's natural-language
transactions use (sync.add_buy_lot / apply_sell_fifo /
apply_portfolio_positions). Never converts currencies.
"""
import asyncio
import hashlib
import json
import logging
import re
import secrets
import string
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"
_ALIAS_CHARS = string.ascii_lowercase + string.digits


def inbound_domain() -> str:
    return getattr(settings, "inbound_email_domain", "") or "import.nuvosai.com"


# ── Aliases ────────────────────────────────────────────────────────────────

async def get_or_create_alias(user_id: str) -> str:
    db = get_supabase()
    res = await run_query(db.table("inbound_email_aliases").select("alias").eq("user_id", user_id).limit(1))
    if res.data:
        return f"{res.data[0]['alias']}@{inbound_domain()}"
    for _ in range(5):
        alias = "n" + "".join(secrets.choice(_ALIAS_CHARS) for _ in range(9))
        try:
            await run_query(db.table("inbound_email_aliases").insert({"user_id": user_id, "alias": alias}))
            return f"{alias}@{inbound_domain()}"
        except Exception as e:  # alias collision (unique) — try another
            logger.info("alias collision/insert retry for %s: %s", user_id, e)
    raise RuntimeError("could not allocate an import alias")


async def user_for_recipients(recipients: list[str]) -> str | None:
    aliases = []
    for r in recipients:
        m = re.search(r"([a-z0-9._+-]+)@([a-z0-9.-]+)", (r or "").lower())
        if m and m.group(2) == inbound_domain().lower():
            aliases.append(m.group(1).split("+")[0])
    if not aliases:
        return None
    res = await run_query(get_supabase().table("inbound_email_aliases").select("user_id").in_("alias", aliases).limit(1))
    return res.data[0]["user_id"] if res.data else None


# ── Extraction ─────────────────────────────────────────────────────────────

_SYSTEM = (
    "Eres un experto en leer correos de casas de bolsa y brokers (GBM+, Actinver, Kuspit, Bursanet, "
    "Interactive Brokers, Schwab, Fidelity, Hapi, Flink, etc.). Extraes operaciones y posiciones con "
    "precisión y NUNCA inventas datos: si un número no aparece, pones null."
)

_PROMPT = """Lee este correo (y sus adjuntos si los hay) y clasifícalo:
- "trades": confirmación de una o más operaciones de compra/venta ejecutadas.
- "statement": estado de cuenta con las posiciones actuales.
- "none": cualquier otra cosa (publicidad, avisos, confirmaciones de reenvío, etc.).

Responde SOLO con JSON (sin markdown):
{"kind":"trades|statement|none","broker":"GBM","currency":"MXN|USD",
 "trades":[{"action":"BUY|SELL","ticker":"AMZN","name":"Amazon","quantity":10,"price":3500.5,"date":"2026-09-28"}],
 "positions":[{"ticker":"AMZN","name":"Amazon","shares":10,"avg_price":3200.0}]}

Reglas:
- ticker en MAYÚSCULAS; emisoras de la BMV pueden llevar serie (AMXL, WALMEX*); SIC de EEUU usa el ticker de EEUU (AMZN, AAPL).
- Formato mexicano: 1.234,56 → 1234.56 cuando aplique.
- price = precio por título ejecutado (no el monto total). date en formato YYYY-MM-DD.
- Incluye TODAS las operaciones/posiciones visibles; omite efectivo, reportos y fondos de liquidez diaria.

CORREO:
De: {sender}
Asunto: {subject}

{body}"""


def _html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html or "")
    text = re.sub(r"(?i)<br\s*/?>|</p>|</tr>|</div>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    return re.sub(r"[ \t]+", " ", text).strip()


async def extract(sender: str, subject: str, text: str, html: str, attachments: list[dict], user_id: str | None) -> dict:
    body = (text or "").strip() or _html_to_text(html)
    body = body[:12000]
    content: list[dict] = []
    for a in attachments[:3]:
        ctype = (a.get("content_type") or "").lower()
        data = a.get("content") or ""
        if not data:
            continue
        if "pdf" in ctype or (a.get("filename") or "").lower().endswith(".pdf"):
            content.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}})
        elif ctype.startswith("image/"):
            content.append({"type": "image", "source": {"type": "base64", "media_type": ctype, "data": data}})
    content.append({"type": "text", "text": _PROMPT.replace("{sender}", sender or "").replace("{subject}", subject or "").replace("{body}", body)})

    import anthropic
    from app.services.ai_service import check_daily_spend_cap
    check_daily_spend_cap()

    def _call():
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        return client.beta.messages.create(
            model=_MODEL, max_tokens=2500, system=_SYSTEM, betas=["pdfs-2024-09-25"],
            messages=[{"role": "user", "content": content}],
        )

    msg = await asyncio.wait_for(asyncio.to_thread(_call), timeout=90)
    try:
        from app.services.llm_usage import log_llm_usage
        asyncio.create_task(log_llm_usage(user_id, "inbound_email_import", _MODEL, msg.usage))
    except Exception:
        pass
    raw = next((b.text for b in msg.content if getattr(b, "type", "") == "text"), "")
    m = re.search(r"\{.*\}", raw, re.S)
    data = json.loads(m.group(0)) if m else {}
    return normalize(data)


def normalize(data: dict) -> dict:
    def num(v):
        try:
            return float(v) if v is not None and str(v).strip() != "" else None
        except (TypeError, ValueError):
            return None

    kind = data.get("kind") if data.get("kind") in ("trades", "statement") else "none"
    trades = []
    for t in data.get("trades") or []:
        ticker = str(t.get("ticker") or "").strip().upper()
        action = str(t.get("action") or "").upper()
        q, p = num(t.get("quantity")), num(t.get("price"))
        if ticker and action in ("BUY", "SELL") and q and q > 0 and p and p > 0:
            date = str(t.get("date") or "")[:10] or datetime.now(timezone.utc).date().isoformat()
            trades.append({"action": action, "ticker": ticker, "name": t.get("name"), "quantity": q, "price": p, "date": date})
    positions = []
    for p in data.get("positions") or []:
        ticker = str(p.get("ticker") or "").strip().upper()
        shares = num(p.get("shares"))
        if ticker and shares is not None and shares >= 0:
            positions.append({"ticker": ticker, "name": p.get("name"), "shares": shares, "avg_price": num(p.get("avg_price")) or 0.0})
    if kind == "trades" and not trades:
        kind = "none"
    if kind == "statement" and not positions:
        kind = "none"
    return {"kind": kind, "broker": (data.get("broker") or "").strip() or None,
            "currency": (str(data.get("currency") or "").upper() or None),
            "trades": trades, "positions": positions}


# ── Reconciliation / apply ──────────────────────────────────────────────────

async def _portfolios(user_id: str) -> list[dict]:
    res = await run_query(
        get_supabase().table("user_portfolio").select("portfolio_id, portfolio_name, positions, updated_at").eq("user_id", user_id)
    )
    return res.data or []


def _shares_by_ticker(parsed: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for p in parsed.get("positions") or []:
        t = str(p.get("ticker") or "").upper()
        out[t] = out.get(t, 0.0) + float(p.get("shares") or 0)
    return out


async def _last_price(ticker: str) -> float | None:
    try:
        from app.core.finnhub import fh_quote
        q = await asyncio.to_thread(fh_quote, ticker)
        price = (q or {}).get("c")
        return float(price) if price else None
    except Exception:
        return None


async def operations_for(payload: dict, parsed_portfolio: dict) -> list[dict]:
    """Operations that apply this import to one portfolio. Trades map 1:1;
    a statement becomes the BUY/SELL deltas that make Nuvos match it."""
    if payload.get("kind") == "trades":
        return [dict(t) for t in payload["trades"]]
    if payload.get("kind") != "statement":
        return []
    today = datetime.now(timezone.utc).date().isoformat()
    current = _shares_by_ticker(parsed_portfolio)
    stated = {p["ticker"]: p for p in payload["positions"]}
    ops: list[dict] = []
    for ticker, p in stated.items():
        delta = round(p["shares"] - current.get(ticker, 0.0), 6)
        if delta > 1e-6:
            price = p.get("avg_price") or await _last_price(ticker)
            if price:
                ops.append({"action": "BUY", "ticker": ticker, "name": p.get("name"), "quantity": delta, "price": price, "date": today})
        elif delta < -1e-6:
            price = await _last_price(ticker) or p.get("avg_price")
            if price:
                ops.append({"action": "SELL", "ticker": ticker, "name": p.get("name"), "quantity": -delta, "price": price, "date": today})
    # A broker API sync only knows ITS OWN holdings — never "sell" a ticker
    # the user holds at another broker just because this one doesn't list it.
    for ticker, shares in ([] if payload.get("partial") else current.items()):
        if ticker not in stated and shares > 1e-6:
            price = await _last_price(ticker)
            if price:
                ops.append({"action": "SELL", "ticker": ticker, "name": None, "quantity": shares, "price": price, "date": today})
    return ops


async def apply_import(user_id: str, import_id: str, portfolio_id: str | None = None) -> dict:
    from app.api.routes.sync import _parse_portfolio, add_buy_lot, apply_sell_fifo, apply_portfolio_positions

    db = get_supabase()
    res = await run_query(db.table("inbound_imports").select("*").eq("id", import_id).eq("user_id", user_id).limit(1))
    if not res.data:
        return {"ok": False, "reason": "not_found"}
    row = res.data[0]
    if row["status"] == "applied":
        return {"ok": True, "already": True}
    payload = row.get("payload") or {}

    portfolios = await _portfolios(user_id)
    if portfolio_id:
        target = next((p for p in portfolios if p["portfolio_id"] == portfolio_id), None)
    else:
        target = portfolios[0] if len(portfolios) == 1 else None
    if len(portfolios) > 1 and target is None:
        return {"ok": False, "reason": "choose_portfolio",
                "portfolios": [{"portfolio_id": p["portfolio_id"], "portfolio_name": p.get("portfolio_name")} for p in portfolios]}
    if target:
        parsed = _parse_portfolio(target["positions"])
        pid, name, base_updated_at = target["portfolio_id"], target.get("portfolio_name") or "Mi portafolio", target.get("updated_at")
    else:
        parsed = {"currency": payload.get("currency") or "USD", "positions": [], "closed_positions": [], "inception_date": None}
        pid, name, base_updated_at = "default", "Mi portafolio", None

    if payload.get("currency") and parsed["currency"] and payload["currency"] != (parsed["currency"] or "").upper():
        return {"ok": False, "reason": "currency_mismatch", "portfolio_currency": parsed["currency"], "import_currency": payload["currency"]}

    ops = await operations_for(payload, parsed)
    positions, closed = parsed["positions"], parsed["closed_positions"]
    applied, skipped = [], []
    for op in ops:
        try:
            if op["action"] == "BUY":
                positions = add_buy_lot(positions, op["ticker"], op["quantity"], op["price"], op["date"])
            else:
                positions, closed, _pl = apply_sell_fifo(positions, closed, op["ticker"], op["quantity"], op["price"], op["date"])
            applied.append(op)
        except ValueError:
            skipped.append(op)
    if applied:
        await apply_portfolio_positions(
            user_id, pid, positions, currency=parsed["currency"], portfolio_name=name,
            closed_positions=closed, inception_date=parsed["inception_date"], base_updated_at=base_updated_at,
        )
    await run_query(db.table("inbound_imports").update({
        "status": "applied", "applied_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", import_id))
    return {"ok": True, "applied": applied, "skipped": skipped, "portfolio_name": name}


async def dismiss_import(user_id: str, import_id: str) -> None:
    await run_query(get_supabase().table("inbound_imports").update({"status": "dismissed"}).eq("id", import_id).eq("user_id", user_id))


# ── Arthur conversation ────────────────────────────────────────────────────

def _fmt_op(op: dict, currency: str | None) -> str:
    verb = "Compra" if op["action"] == "BUY" else "Venta"
    q = op["quantity"]
    qs = f"{q:,.0f}" if abs(q - round(q)) < 1e-6 else f"{q:,.4f}"
    cur = f" {currency}" if currency else ""
    return f"• **{verb}** de {qs} {op['ticker']} a ${op['price']:,.2f}{cur} ({op['date']})"


async def announce(user_id: str, import_id: str, payload: dict, push: bool = True) -> str | None:
    """Arthur starts the conversation + push for a parsed import."""
    from app.services import arthur_proactive
    from app.services.notification_engine import send_push

    broker = payload.get("broker") or "tu casa de bolsa"
    portfolios = await _portfolios(user_id)
    from app.api.routes.sync import _parse_portfolio
    parsed = _parse_portfolio(portfolios[0]["positions"]) if len(portfolios) == 1 else {"positions": [], "closed_positions": [], "currency": None, "inception_date": None}
    ops = await operations_for(payload, parsed) if len(portfolios) <= 1 else (payload.get("trades") or [])

    if payload["kind"] == "trades":
        title = f"Registré tu operación de {broker}" if len(ops) == 1 else f"Recibí {len(ops)} operaciones de {broker}"
        intro = f"Me llegó tu confirmación de **{broker}**. Esto es lo que vi:"
    else:
        title = f"Recibí tu estado de cuenta de {broker}"
        intro = (f"Me llegó tu estado de cuenta de **{broker}** y lo comparé con tu portafolio en Nuvos." if ops
                 else f"Me llegó tu estado de cuenta de **{broker}** y coincide con tu portafolio en Nuvos. Todo está al día ✅")

    lines = [_fmt_op(op, payload.get("currency")) for op in ops[:12]]
    more = f"\n…y {len(ops) - 12} más." if len(ops) > 12 else ""
    if ops:
        ask = ("\n\n¿Lo registro en tu portafolio para que tus análisis y alertas usen tus posiciones reales? "
               "Nada se modifica hasta que me confirmes.")
        message = f"{intro}\n\n" + "\n".join(lines) + more + ask
    else:
        message = intro

    actions: list[dict] = []
    if ops:
        if len(portfolios) > 1:
            for p in portfolios[:4]:
                actions.append({"type": "import_apply", "label": f"Registrar en {p.get('portfolio_name') or 'Mi portafolio'}",
                                "data": {"import_id": import_id, "portfolio_id": p["portfolio_id"]}})
        else:
            actions.append({"type": "import_apply", "label": "Sí, regístralo", "data": {"import_id": import_id}})
        actions.append({"type": "import_dismiss", "label": "No registrar", "data": {"import_id": import_id}})

    sid = await arthur_proactive.create_thread(user_id, "import_email", title, message, actions)
    if push:
        try:
            body = ("Toca para revisarla y registrarla con un toque." if ops else "Tu portafolio está al día.")
            await send_push(user_id, "import_email", title, body,
                            {"screen": "chat", "arthur_session_id": sid or "", "import_id": import_id}, get_supabase())
        except Exception as e:
            logger.warning("inbound_import.announce push failed for %s: %s", user_id, e)
    return sid


async def announce_forwarding_verification(user_id: str, subject: str, text: str, html: str) -> None:
    """Gmail/Outlook send a confirmation email to a new forwarding address —
    surface its link/code to the user through Arthur so the setup finishes."""
    from app.services import arthur_proactive
    body = (text or "") + " " + _html_to_text(html)
    link = re.search(r"https://[^\s\"'<>]*(mail-settings\.google\.com|mail\.google\.com)[^\s\"'<>]*", body)
    code = re.search(r"(?:código de confirmación|confirmation code)[^\d]{0,20}(\d{6,10})", body, re.I)
    parts = ["Tu correo me pidió confirmar el reenvío automático — ¡ya casi quedó conectado! 🙌"]
    if link:
        parts.append(f"Abre este enlace para confirmarlo:\n{link.group(0)}")
    if code:
        parts.append(f"O usa este código de confirmación en la configuración de tu correo: **{code.group(1)}**")
    parts.append("En cuanto lo confirmes, cada confirmación de operación y estado de cuenta de tu casa de bolsa llegará a Nuvos y yo te aviso para registrarlo.")
    await arthur_proactive.create_thread(user_id, "import_email", "Confirma el reenvío de tu correo", "\n\n".join(parts), [])
    try:
        from app.services.notification_engine import send_push
        await send_push(user_id, "import_email", "Confirma el reenvío de tu correo",
                        "Un paso más para que Nuvos se actualice solo.", {"screen": "chat"}, get_supabase())
    except Exception:
        pass


def _is_forwarding_verification(sender: str, subject: str) -> bool:
    s = (sender or "").lower() + " " + (subject or "").lower()
    return ("forwarding-noreply@google.com" in s or "confirmación de reenvío" in s or "forwarding confirmation" in s
            or ("reenvío" in s and "gmail" in s))


async def handle_inbound(sender: str, recipients: list[str], subject: str, text: str, html: str,
                         attachments: list[dict], message_id: str | None) -> dict:
    user_id = await user_for_recipients(recipients)
    if not user_id:
        return {"ok": False, "reason": "unknown_recipient"}

    if _is_forwarding_verification(sender, subject):
        await announce_forwarding_verification(user_id, subject, text, html)
        return {"ok": True, "kind": "forwarding_verification"}

    dedup = hashlib.md5((message_id or f"{sender}|{subject}|{(text or html or '')[:500]}").encode()).hexdigest()
    db = get_supabase()
    try:
        ins = await run_query(db.table("inbound_imports").insert({
            "user_id": user_id, "source": "email", "sender": (sender or "")[:200], "subject": (subject or "")[:300],
            "status": "processing", "dedup_key": dedup,
        }))
        import_id = ins.data[0]["id"]
    except Exception:
        return {"ok": True, "duplicate": True}

    try:
        payload = await extract(sender, subject, text, html, attachments, user_id)
    except Exception as e:
        logger.error("inbound_import.extract failed for %s: %s", user_id, e)
        await run_query(db.table("inbound_imports").update({"status": "failed", "error": str(e)[:500]}).eq("id", import_id))
        return {"ok": False, "reason": "extract_failed"}

    status = "parsed" if payload["kind"] != "none" else "nothing"
    await run_query(db.table("inbound_imports").update({"status": status, "kind": payload["kind"], "payload": payload}).eq("id", import_id))
    if payload["kind"] != "none":
        await announce(user_id, import_id, payload)
    return {"ok": True, "kind": payload["kind"], "import_id": import_id}


async def handle_shared(user_id: str, attachments: list[dict]) -> dict:
    """Share-sheet import (mobile): a screenshot/PDF shared from the broker's
    app straight to Nuvos goes through the same extraction + reconciliation
    + Arthur conversation as a forwarded email (no push — the user is in
    the app and is taken straight into the conversation)."""
    db = get_supabase()
    ins = await run_query(db.table("inbound_imports").insert({
        "user_id": user_id, "source": "share", "subject": "Archivo compartido", "status": "processing",
    }))
    import_id = ins.data[0]["id"]
    try:
        payload = await extract("", "Captura o estado de cuenta compartido desde la app de la casa de bolsa", "", "", attachments, user_id)
    except Exception as e:
        logger.error("inbound_import.handle_shared extract failed for %s: %s", user_id, e)
        await run_query(db.table("inbound_imports").update({"status": "failed", "error": str(e)[:500]}).eq("id", import_id))
        return {"ok": False, "reason": "extract_failed"}
    status = "parsed" if payload["kind"] != "none" else "nothing"
    await run_query(db.table("inbound_imports").update({"status": status, "kind": payload["kind"], "payload": payload}).eq("id", import_id))
    if payload["kind"] == "none":
        return {"ok": True, "kind": "none"}
    sid = await announce(user_id, import_id, payload, push=False)
    return {"ok": True, "kind": payload["kind"], "import_id": import_id, "session_id": sid}


async def reconcile_broker_holdings(user_id: str, broker: str, positions: list[dict]) -> str | None:
    """Daily API-broker sync (Plaid/IOL): if the broker's holdings differ from
    the user's Nuvos portfolio, Arthur starts a conversation to update it
    with one tap. Only tickers the broker reports are touched (partial), and
    the same difference is never announced twice (dedup on the operations)."""
    from app.api.routes.sync import _parse_portfolio
    portfolios = await _portfolios(user_id)
    if len(portfolios) > 1 or not positions:
        return None  # ambiguous target / nothing reported — never guess
    parsed = _parse_portfolio(portfolios[0]["positions"]) if portfolios else {"positions": [], "closed_positions": [], "currency": "USD", "inception_date": None}
    currency = (positions[0].get("currency") or "USD").upper()
    if parsed.get("currency") and currency != (parsed["currency"] or "").upper():
        return None
    payload = {"kind": "statement", "broker": broker, "currency": currency, "partial": True, "trades": [],
               "positions": [{"ticker": p["ticker"], "name": p.get("name"), "shares": float(p.get("shares") or 0),
                              "avg_price": float(p.get("avgPrice") or 0)} for p in positions]}
    ops = await operations_for(payload, parsed)
    if not ops:
        return None
    dedup = hashlib.md5(json.dumps(sorted((o["action"], o["ticker"], round(o["quantity"], 4)) for o in ops)).encode()).hexdigest()
    db = get_supabase()
    try:
        ins = await run_query(db.table("inbound_imports").insert({
            "user_id": user_id, "source": "broker_sync", "sender": broker, "subject": f"Sincronización {broker}",
            "kind": "statement", "payload": payload, "status": "parsed", "dedup_key": f"sync-{dedup}",
        }))
    except Exception:
        return None  # already announced this exact difference
    return await announce(user_id, ins.data[0]["id"], payload)
