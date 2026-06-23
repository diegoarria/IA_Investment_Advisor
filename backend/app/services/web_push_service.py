"""
Web Push notifications using the standard W3C Push API + VAPID.
Works in any modern browser (Chrome, Firefox, Edge, Safari 16.4+).

VAPID keys must be set in env:
  VAPID_PRIVATE_KEY — base64url EC private key
  VAPID_PUBLIC_KEY  — base64url EC public key (also served to the browser)

Generate once with:
  python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print('PRIV:', v.private_key_urlsafe); print('PUB:', v.public_key_urlsafe)"
"""
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _get_keys() -> tuple[str, str, str]:
    from app.core.config import settings
    return settings.vapid_private_key, settings.vapid_public_key, settings.vapid_claim_email


def is_configured() -> bool:
    priv, pub, _ = _get_keys()
    return bool(priv and pub)


async def send_web_push(
    subscription: dict[str, Any],
    title: str,
    body: str,
    data: dict | None = None,
    icon: str = "/logo.png",
) -> bool:
    """
    Send a push to a single browser subscription dict:
      {"endpoint": "...", "keys": {"p256dh": "...", "auth": "..."}}
    Returns True on success, False on error (expired/invalid subscription returns False).
    """
    if not is_configured():
        logger.warning("Web push not configured — set VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY")
        return False

    priv_key, _, claim_email = _get_keys()

    payload = json.dumps({
        "title": title,
        "body": body,
        "icon": icon,
        "data": data or {},
    })

    import asyncio
    import concurrent.futures

    def _send_sync():
        try:
            from pywebpush import webpush, WebPushException
            webpush(
                subscription_info=subscription,
                data=payload,
                vapid_private_key=priv_key,
                vapid_claims={"sub": claim_email},
                content_encoding="aes128gcm",
            )
            return True
        except Exception as e:
            if hasattr(e, "response") and e.response is not None:
                status = e.response.status_code
                if status in (404, 410):
                    # Subscription expired — caller should remove it
                    logger.info("Web push subscription gone (HTTP %d) — should be removed", status)
                    return None  # signal: subscription gone
            logger.warning("Web push failed: %s", e)
            return False

    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        result = await loop.run_in_executor(ex, _send_sync)
    return result


async def send_web_push_to_user(user_id: str, title: str, body: str, data: dict | None = None) -> int:
    """
    Fetch all web push subscriptions for a user from DB and fan-out.
    Returns number of successful sends. Cleans up expired subscriptions automatically.
    """
    if not is_configured():
        return 0

    from app.core.database import get_supabase, run_query
    db = get_supabase()

    try:
        res = await run_query(
            db.table("web_push_subscriptions")
            .select("id, subscription")
            .eq("user_id", user_id)
        )
        rows = res.data or []
    except Exception as e:
        logger.warning("Failed to fetch web push subscriptions for %s: %s", user_id, e)
        return 0

    if not rows:
        return 0

    sent = 0
    expired_ids = []

    for row in rows:
        sub = row.get("subscription")
        if not sub:
            continue
        result = await send_web_push(sub, title, body, data)
        if result is True:
            sent += 1
        elif result is None:
            # Subscription gone — mark for cleanup
            expired_ids.append(row["id"])

    if expired_ids:
        try:
            await run_query(
                db.table("web_push_subscriptions")
                .delete()
                .in_("id", expired_ids)
            )
        except Exception as e:
            logger.warning("Failed to clean up expired subscriptions: %s", e)

    return sent
