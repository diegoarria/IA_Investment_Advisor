"""Regional Stripe price selection (Mexico -> MXN prices).

Why: many Mexican cards (debit especially) decline USD charges. Stripe's
Adaptive Pricing doesn't apply to the embedded Payment Element flow (it isn't
supported on the Payment Intents API), so Mexican users are simply offered
separate MXN Stripe prices.

Detection is deliberately conservative and uses only what the profile already
stores: `country == "MX"` or a +52 phone number. Any product whose MXN price ID
isn't configured falls back to the USD price — never a failure.
"""
from app.core.config import settings


def is_mexico(country: str | None, phone_number: str | None = None) -> bool:
    c = (country or "").strip().lower()
    if c in ("mx", "mex", "mexico", "méxico"):
        return True
    return (phone_number or "").strip().replace(" ", "").startswith("+52")


def subscription_price_id(plan: str, mexico: bool, cfg=settings) -> str:
    """Premium individual price for `plan` ("monthly" | "yearly"). `cfg` is the
    caller's settings object (routes patch their own module-level `settings`
    in tests); missing MXN attributes count as "not configured"."""
    yearly = plan == "yearly"
    usd = cfg.stripe_price_id_yearly if yearly else cfg.stripe_price_id_monthly
    mxn = getattr(cfg, "stripe_price_id_yearly_mxn" if yearly else "stripe_price_id_monthly_mxn", "")
    return mxn if (mexico and mxn) else usd


def upsell_price_id(offer: str, key: str, usd_price_id: str, mexico: bool, cfg=settings) -> str:
    """MXN price for the offers that have one, else the USD id passed in."""
    if not mexico:
        return usd_price_id
    g = lambda name: getattr(cfg, name, "")  # noqa: E731
    mxn = {
        ("family_plan", "monthly"): g("stripe_price_family_monthly_mxn"),
        ("family_plan", "yearly"):  g("stripe_price_family_yearly_mxn"),
        ("session", "free"):        g("stripe_price_session_free_mxn"),
        ("session", "premium"):     g("stripe_price_session_premium_mxn"),
        ("session", "bundle"):      g("stripe_price_session_bundle_mxn"),
    }.get((offer, key), "")
    return mxn or usd_price_id
