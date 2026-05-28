import httpx
from app.core.config import settings


async def send_email(to: str, subject: str, html: str) -> bool:
    if not getattr(settings, "resend_api_key", ""):
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": "Nuvos AI <resumen@nuvosai.app>",
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
        return res.status_code == 200
    except Exception:
        return False


def build_weekly_summary_html(name: str, summary: str, risk: str) -> str:
    risk_color = {"conservative": "#3b82f6", "moderate": "#22c55e", "aggressive": "#f59e0b"}.get(
        risk.split("_")[0], "#22c55e"
    )
    paragraphs = "".join(f"<p style='margin:0 0 12px'>{p}</p>" for p in summary.split("\n") if p.strip())
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px">
    <div style="background:#1a1d27;border-radius:20px;padding:32px;border:1px solid #2a2d3a">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <div style="width:44px;height:44px;background:{risk_color}22;border-radius:12px;display:flex;align-items:center;justify-content:center">
          <span style="font-size:22px">📈</span>
        </div>
        <div>
          <div style="color:#fff;font-size:18px;font-weight:700">Nuvos AI</div>
          <div style="color:#6b7280;font-size:13px">Resumen Semanal de Inversión</div>
        </div>
      </div>

      <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0 0 8px">
        Hola {name}, aquí está tu resumen de esta semana 👋
      </h1>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 24px">
        Mercados cerrados. Es momento de reflexionar y prepararse para la próxima semana.
      </p>

      <div style="background:#0f1117;border-radius:14px;padding:20px;border:1px solid #2a2d3a;margin-bottom:20px">
        <div style="color:{risk_color};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px">
          ANÁLISIS PERSONALIZADO
        </div>
        <div style="color:#d1d5db;font-size:15px;line-height:1.7">
          {paragraphs}
        </div>
      </div>

      <div style="border-top:1px solid #2a2d3a;padding-top:20px;margin-top:8px">
        <p style="color:#6b7280;font-size:12px;margin:0;text-align:center">
          Nuvos AI — Solo educativo. No constituye asesoramiento financiero profesional.<br>
          <a href="#" style="color:{risk_color}">Abrir la app</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>"""


async def generate_and_send_weekly_summary(user_id: str, email: str, name: str, risk: str, chat_snippets: list[str]):
    from app.services import ai_service

    is_premium = bool(chat_snippets)
    context = "\n".join(f"- {s}" for s in chat_snippets[:10]) if chat_snippets else ""

    if is_premium:
        intro = f"""Eres el asesor financiero personal de {name}, con perfil {risk}.
Esta semana tuvieron las siguientes conversaciones de inversión:
{context}

Escribe un resumen semanal PERSONALIZADO de máximo 220 palabras que incluya:"""
    else:
        intro = f"""Eres un asesor financiero para {name}, inversor con perfil {risk}.

Escribe un resumen semanal GENERAL de los mercados de máximo 150 palabras que incluya:"""

    prompt = f"""{intro}
1. Qué pasó en los mercados esta semana (menciona S&P 500, tasas o eventos relevantes de la semana actual)
2. Cómo aplica eso al perfil {risk} de {name}
3. Una reflexión o acción concreta para la próxima semana
4. Una frase motivacional corta al final

Tono: cálido, profesional, directo. Como un mentor que se preocupa por el progreso del usuario."""

    summary = ""
    async for chunk in ai_service.chat_stream(
        message=prompt, conversation_history=[], profile=None, mentor=None,
    ):
        summary += chunk

    html = build_weekly_summary_html(name, summary, risk)
    await send_email(email, f"Tu resumen semanal de inversión, {name} 📈", html)
