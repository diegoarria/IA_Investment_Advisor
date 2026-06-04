import os
import httpx

TWILIO_SID   = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM  = os.getenv("TWILIO_FROM_NUMBER", "")


async def send_sms(to: str, body: str) -> None:
    if not TWILIO_SID or not TWILIO_TOKEN or not TWILIO_FROM:
        raise RuntimeError("Servicio SMS no configurado (credenciales Twilio ausentes)")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
            data={"From": TWILIO_FROM, "To": to, "Body": body},
            auth=(TWILIO_SID, TWILIO_TOKEN),
            timeout=10,
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"Error SMS ({resp.status_code}): {resp.text}")
