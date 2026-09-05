"""Own copies (not imports) of the main backend's Twilio/Resend calls —
see backend/app/services/sms_service.py and email_service.py for the
originals. Deliberately duplicated with this service's own env vars/
credentials so an alert can go out even if the main backend/Supabase is
fully down; importing across repos would defeat that."""
import logging
import httpx
import config

logger = logging.getLogger("nuvos-sentinel")


async def send_sms(body: str) -> None:
    if not (config.TWILIO_ACCOUNT_SID and config.TWILIO_AUTH_TOKEN and config.TWILIO_FROM_NUMBER and config.ALERT_PHONE_NUMBER):
        logger.warning("send_sms skipped — Twilio/alert-phone not configured")
        return
    url = f"https://api.twilio.com/2010-04-01/Accounts/{config.TWILIO_ACCOUNT_SID}/Messages.json"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            url,
            data={"From": config.TWILIO_FROM_NUMBER, "To": config.ALERT_PHONE_NUMBER, "Body": body},
            auth=(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN),
        )
        if resp.status_code >= 400:
            logger.error("send_sms failed: %s %s", resp.status_code, resp.text)


async def send_whatsapp_kapso(body: str) -> None:
    """Kapso (https://docs.kapso.ai) — a REST wrapper around Meta's official
    WhatsApp Cloud API, same request shapes. WhatsApp requires a
    Meta-APPROVED message TEMPLATE for any unprompted message (an alert
    Diego didn't message first to trigger) — free-form text only works
    within an open 24h conversation window, useless for a 3am outage alert.
    So this always sends via the template endpoint, never plain text.

    Setup required in the Kapso dashboard before this works (see README):
    connect the WhatsApp number, create a template (e.g. name
    KAPSO_TEMPLATE_NAME, body "🚨 Nuvos: {{1}}"), wait for Meta's approval.
    """
    required = (
        config.KAPSO_API_KEY, config.KAPSO_PHONE_NUMBER_ID,
        config.KAPSO_TEMPLATE_NAME, config.ALERT_WHATSAPP_NUMBER,
    )
    if not all(required):
        logger.warning("send_whatsapp_kapso skipped — Kapso/alert-whatsapp-number not configured")
        return
    url = f"https://api.kapso.ai/meta/whatsapp/v24.0/{config.KAPSO_PHONE_NUMBER_ID}/marketing_messages"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            url,
            headers={"X-API-Key": config.KAPSO_API_KEY},
            json={
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": config.ALERT_WHATSAPP_NUMBER,
                "type": "template",
                "template": {
                    "name": config.KAPSO_TEMPLATE_NAME,
                    "language": {"code": config.KAPSO_TEMPLATE_LANG},
                    "components": [
                        {"type": "body", "parameters": [{"type": "text", "text": body[:1000]}]},
                    ],
                },
            },
        )
        if resp.status_code >= 400:
            logger.error("send_whatsapp_kapso failed: %s %s", resp.status_code, resp.text)


async def send_email(subject: str, html: str) -> None:
    if not (config.RESEND_API_KEY and config.ALERT_EMAIL):
        logger.warning("send_email skipped — Resend/alert-email not configured")
        return
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
            json={
                "from": "Nuvos Sentinel <sentinel@nuvosai.com>",
                "to": [config.ALERT_EMAIL],
                "subject": subject,
                "html": html,
            },
        )
        if resp.status_code != 200:
            logger.error("send_email failed: %s %s", resp.status_code, resp.text)


async def send_alert(subject: str, body: str) -> None:
    """Fires every configured channel — WhatsApp/SMS for immediacy, email
    for detail. Neither channel's failure ever raises past this point or
    blocks the other; each is independently optional (see each function's
    own "skipped — not configured" guard)."""
    message = f"{subject}: {body}"[:1500]
    if config.ALERT_WHATSAPP_PROVIDER == "kapso":
        try:
            await send_whatsapp_kapso(message)
        except Exception as e:
            logger.error("send_whatsapp_kapso raised: %s", e)
    else:
        try:
            await send_sms(message)
        except Exception as e:
            logger.error("send_sms raised: %s", e)
    try:
        await send_email(subject, f"<p>{body}</p>")
    except Exception as e:
        logger.error("send_email raised: %s", e)
