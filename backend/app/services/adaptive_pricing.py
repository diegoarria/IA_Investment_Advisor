"""Stripe Adaptive Pricing helpers shared by billing.py and upsells.py.

With Adaptive Pricing every product is anchored on its MXN Stripe price (this
account settles only in MXN — multi-currency settlement isn't available in
Mexico — and Adaptive Pricing requires the price currency to be a settlement
currency); Stripe presents the customer's local currency at checkout.

Only products that HAVE an MXN price are eligible. Anything else (Deep
Research, the broker call) stays on the legacy USD flow.
"""
from app.core.config import settings

# (offer, key) -> settings attribute holding the MXN Stripe price id
_MXN_PRICE_ATTR = {
    ("premium", "monthly"):     "stripe_price_id_monthly_mxn",
    ("premium", "yearly"):      "stripe_price_id_yearly_mxn",
    ("family_plan", "monthly"): "stripe_price_family_monthly_mxn",
    ("family_plan", "yearly"):  "stripe_price_family_yearly_mxn",
    ("session", "free"):        "stripe_price_session_free_mxn",
    ("session", "premium"):     "stripe_price_session_premium_mxn",
    ("session", "bundle"):      "stripe_price_session_bundle_mxn",
}

SUBSCRIPTION_OFFERS = frozenset({"premium", "family_plan"})


def enabled(cfg=settings) -> bool:
    return bool(getattr(cfg, "checkout_adaptive_pricing", False))


def mxn_price_id(offer: str, key: str, cfg=settings) -> str:
    attr = _MXN_PRICE_ATTR.get((offer, key))
    return getattr(cfg, attr, "") if attr else ""


def available(offer: str, key: str, cfg=settings) -> bool:
    """Adaptive checkout is offered for this product only if the feature is on
    AND its MXN price is configured."""
    return enabled(cfg) and bool(mxn_price_id(offer, key, cfg))
