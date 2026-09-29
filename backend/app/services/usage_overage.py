"""Uso extra — usage-based overage billing (Diego, 2026-09-29).

Premium includes up to INCLUDED_USD of real LLM cost per calendar month
(settings.premium_price_usd * guard_protection_pct = $9). Past that:

  * opted in  → Arthur keeps the full model; every BLOCK_COST_USD of extra
                cost is one "bloque de uso extra" ($4.99 USD / $89 MXN),
                capped at cap_blocks (default 4). Past the cap → cheaper model.
  * declined / not decided → cheaper model until the month resets.

Arthur ALWAYS answers — this module never blocks a message, it only picks
the model. Blocks accrue during the month and worker.py's
job_bill_usage_overage charges them in one Stripe invoice on the 1st.

Only users who can actually be charged (a Stripe customer with an active
Premium subscription) can opt in; everyone else just sees the meter and the
cheaper model past the included usage. Everything fails open: a lookup
error means "normal", never a wrong charge or a blocked user.
"""
import logging
import math
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_supabase, run_query

logger = logging.getLogger(__name__)

BLOCK_COST_USD = 2.50           # our real LLM cost covered by one block
BLOCK_PRICE = {"usd": 499, "mxn": 8900}   # what the user pays per block (minor units)
DEFAULT_CAP_BLOCKS = 4
ALERT_LEVELS = (70, 90, 100)


def included_usd() -> float:
    return round(settings.premium_price_usd * settings.guard_protection_pct, 2)


def current_period(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")


def next_reset_iso(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(y, m, 1, tzinfo=timezone.utc).isoformat()


def blocks_for(month_cost: float, cap: int) -> int:
    extra = month_cost - included_usd()
    if extra <= 0:
        return 0
    return min(cap, math.ceil(round(extra / BLOCK_COST_USD, 6)))


async def get_row(user_id: str, period: str | None = None) -> dict | None:
    try:
        res = await run_query(
            get_supabase().table("usage_overage").select("*")
            .eq("user_id", user_id).eq("period", period or current_period()).limit(1)
        )
        return (res.data or [None])[0]
    except Exception as e:  # table missing / Supabase hiccup → treat as no choice made
        logger.warning("usage_overage.get_row failed for %s: %s", user_id, e)
        return None


async def upsert_row(user_id: str, fields: dict, period: str | None = None) -> None:
    await run_query(
        get_supabase().table("usage_overage").upsert({
            "user_id": user_id,
            "period": period or current_period(),
            **fields,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="user_id,period")
    )


def can_be_charged(profile) -> bool:
    """A real, chargeable Premium subscriber (not trial / comp / Duo guest)."""
    if profile is None:
        return False
    tier = getattr(profile, "subscription_tier", None) or (profile.get("subscription_tier") if isinstance(profile, dict) else None)
    customer = getattr(profile, "stripe_customer_id", None) or (profile.get("stripe_customer_id") if isinstance(profile, dict) else None)
    source = getattr(profile, "subscription_source", None) or (profile.get("subscription_source") if isinstance(profile, dict) else None)
    return tier in ("premium", "pro") and bool(customer) and source == "stripe"


@dataclass
class UsageSummary:
    period: str
    month_cost_usd: float
    included_usd: float
    pct_used: int                 # of the included usage, can exceed 100
    reached_included: bool
    opted_in: bool
    declined: bool
    decided: bool
    cap_blocks: int
    blocks_used: int
    block_price: int              # minor units, in `currency`
    currency: str
    extra_charge: int             # blocks_used * block_price (minor units)
    can_opt_in: bool
    mode: str                     # "included" | "overage" | "economy"
    resets_at: str

    def to_dict(self) -> dict:
        return asdict(self)


def _currency(profile) -> str:
    cur = getattr(profile, "currency", None) if profile is not None and not isinstance(profile, dict) else (profile or {}).get("currency")
    country = getattr(profile, "country", None) if profile is not None and not isinstance(profile, dict) else (profile or {}).get("country")
    return "mxn" if (str(cur or "").lower() == "mxn" or str(country or "").upper() in ("MX", "MEXICO", "MÉXICO")) else "usd"


async def billing_fields(user_id: str) -> dict:
    """The profile columns this module needs — read directly because the
    UserProfile model deliberately doesn't expose stripe_customer_id."""
    try:
        res = await run_query(
            get_supabase().table("user_profiles")
            .select("subscription_tier,subscription_source,stripe_customer_id,currency,country,preferred_language")
            .eq("user_id", user_id).limit(1)
        )
        return (res.data or [{}])[0] or {}
    except Exception as e:
        logger.warning("usage_overage.billing_fields failed for %s: %s", user_id, e)
        return {}


async def summary(user_id: str, profile=None) -> UsageSummary:
    """`profile` is accepted for call-site convenience but billing decisions
    always use the real billing columns (billing_fields)."""
    profile = await billing_fields(user_id)
    from app.services import cost_guard
    try:
        month_cost, _ = await cost_guard.spend_for(user_id)
    except Exception as e:
        logger.warning("usage_overage.summary spend lookup failed for %s: %s", user_id, e)
        month_cost = 0.0
    row = await get_row(user_id) or {}
    cap = int(row.get("cap_blocks") or DEFAULT_CAP_BLOCKS)
    opted_in = bool(row.get("opted_in"))
    declined = bool(row.get("declined"))
    inc = included_usd()
    reached = month_cost >= inc
    blocks = blocks_for(month_cost, cap) if opted_in else 0
    currency = _currency(profile)
    price = BLOCK_PRICE[currency]
    if not reached:
        mode = "included"
    elif opted_in and blocks_for(month_cost, 10_000) <= cap:
        mode = "overage"
    else:
        mode = "economy"
    return UsageSummary(
        period=current_period(),
        month_cost_usd=round(month_cost, 4),
        included_usd=inc,
        pct_used=int(round(month_cost / inc * 100)) if inc > 0 else 0,
        reached_included=reached,
        opted_in=opted_in,
        declined=declined,
        decided=opted_in or declined,
        cap_blocks=cap,
        blocks_used=blocks,
        block_price=price,
        currency=currency,
        extra_charge=blocks * price,
        can_opt_in=can_be_charged(profile),
        mode=mode,
        resets_at=next_reset_iso(),
    )


async def use_economy_model(user_id: str, profile) -> bool:
    """True when Arthur should answer with the cheaper model: past the
    included usage and not (or no longer) covered by opted-in uso extra."""
    try:
        s = await summary(user_id, profile)
        return s.mode == "economy"
    except Exception as e:
        logger.warning("usage_overage.use_economy_model failed open for %s: %s", user_id, e)
        return False


async def set_choice(user_id: str, profile, opt_in: bool, cap_blocks: int | None = None) -> UsageSummary:
    fields: dict = {"opted_in": bool(opt_in), "declined": not opt_in}
    if cap_blocks is not None:
        fields["cap_blocks"] = max(1, min(20, int(cap_blocks)))
    if opt_in and not can_be_charged(await billing_fields(user_id)):
        raise ValueError("not_chargeable")
    await upsert_row(user_id, fields)
    return await summary(user_id, profile)


async def maybe_notify(user_id: str, profile) -> None:
    """Push at 70% / 90% / 100% of the included usage, once per level per
    month. Fire-and-forget from the chat route; never raises."""
    try:
        s = await summary(user_id, profile)
        level = max([lv for lv in ALERT_LEVELS if s.pct_used >= lv], default=0)
        if level == 0:
            return
        row = await get_row(user_id) or {}
        if int(row.get("notified_level") or 0) >= level:
            return
        await upsert_row(user_id, {"notified_level": level,
                                   "opted_in": bool(row.get("opted_in")),
                                   "declined": bool(row.get("declined")),
                                   "cap_blocks": int(row.get("cap_blocks") or DEFAULT_CAP_BLOCKS)})
        en = ((await billing_fields(user_id)).get("preferred_language") or "es") == "en"
        if level < 100:
            title = f"You've used {level}% of your plan" if en else f"Usaste {level}% de tu plan"
            body = ("Arthur keeps working normally. See your usage in Profile." if en
                    else "Arthur sigue funcionando normal. Revisa tu uso en tu Perfil.")
        else:
            title = "You reached your plan's included usage" if en else "Llegaste al uso incluido en tu plan"
            body = ("Arthur keeps answering. Turn on extra usage or keep going in economy mode until your month resets." if en
                    else "Arthur sigue contestando. Activa uso extra o sigue en modo económico hasta que se reinicie tu mes.")
        from app.services.notification_engine import send_push
        await send_push(user_id, "account", title, body, {"type": "usage_alert", "screen": "profile", "level": level}, get_supabase())
    except Exception as e:
        logger.warning("usage_overage.maybe_notify failed for %s: %s", user_id, e)


_MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
              "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


async def _period_cost(user_id: str, period: str) -> float:
    y, m = int(period[:4]), int(period[5:7])
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + 1, 1, 1, tzinfo=timezone.utc) if m == 12 else datetime(y, m + 1, 1, tzinfo=timezone.utc)
    res = await run_query(
        get_supabase().table("llm_usage_log").select("cost_usd")
        .eq("user_id", user_id).gte("created_at", start.isoformat()).lt("created_at", end.isoformat())
    )
    return sum(float(r.get("cost_usd") or 0) for r in (res.data or []))


async def bill_period(period: str) -> dict:
    """Charge every opted-in user's uso extra for a CLOSED month in one
    Stripe invoice each. Idempotent: rows with invoiced_at set are skipped,
    and Stripe idempotency keys are per (user, period). Returns counts."""
    import stripe
    from app.core.stripe_retry import stripe_call

    if not settings.stripe_secret_key:
        logger.warning("bill_period: Stripe not configured — skipping %s", period)
        return {"billed": 0, "skipped": 0, "failed": 0}
    stripe.api_key = settings.stripe_secret_key

    res = await run_query(
        get_supabase().table("usage_overage").select("*")
        .eq("period", period).eq("opted_in", True).is_("invoiced_at", "null")
    )
    billed = skipped = failed = 0
    for row in res.data or []:
        uid = row["user_id"]
        try:
            fields = await billing_fields(uid)
            customer = fields.get("stripe_customer_id")
            cost = await _period_cost(uid, period)
            blocks = blocks_for(cost, int(row.get("cap_blocks") or DEFAULT_CAP_BLOCKS))
            if blocks <= 0 or not customer:
                await upsert_row(uid, {"opted_in": True, "blocks_billed": 0,
                                       "invoiced_at": datetime.now(timezone.utc).isoformat()}, period)
                skipped += 1
                continue
            cust = await stripe_call(stripe.Customer.retrieve, customer)
            currency = (cust.get("currency") or _currency(fields)).lower()
            if currency not in BLOCK_PRICE:
                currency = "usd"
            amount = blocks * BLOCK_PRICE[currency]
            month_name = _MONTHS_ES[int(period[5:7]) - 1]
            desc = f"Nuvos · Uso extra de Arthur — {blocks} bloque{'s' if blocks != 1 else ''} ({month_name} {period[:4]})"
            await stripe_call(
                stripe.InvoiceItem.create,
                customer=customer, amount=amount, currency=currency, description=desc,
                metadata={"type": "usage_overage", "user_id": uid, "period": period, "blocks": blocks},
                idempotency_key=f"overage-item-{uid}-{period}",
            )
            invoice = await stripe_call(
                stripe.Invoice.create,
                customer=customer, collection_method="charge_automatically", auto_advance=True,
                pending_invoice_items_behavior="include", description=desc,
                metadata={"type": "usage_overage", "user_id": uid, "period": period},
                idempotency_key=f"overage-invoice-{uid}-{period}",
            )
            try:
                await stripe_call(stripe.Invoice.finalize_invoice, invoice["id"])
                await stripe_call(stripe.Invoice.pay, invoice["id"])
            except Exception as pay_err:
                # Finalized-but-unpaid invoices are retried by Stripe's own
                # dunning (Smart Retries) — still recorded as billed here.
                logger.warning("bill_period: invoice %s for %s not paid immediately: %s", invoice["id"], uid, pay_err)
            await upsert_row(uid, {"opted_in": True, "blocks_billed": blocks,
                                   "invoiced_at": datetime.now(timezone.utc).isoformat(),
                                   "stripe_invoice_id": invoice["id"]}, period)
            billed += 1
        except Exception as e:
            failed += 1
            logger.error("bill_period: failed for %s (%s): %s", uid, period, e)
    logger.info("bill_period %s: billed=%d skipped=%d failed=%d", period, billed, skipped, failed)
    return {"billed": billed, "skipped": skipped, "failed": failed}
