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
                    "from": "Nuvos AI <resumen@nuvosai.com>",
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


# ── Monthly Report ────────────────────────────────────────────────────────────

def build_monthly_report_html(name: str, report: dict, month: str) -> str:
    perf        = report.get("performance", {})
    metrics     = report.get("metrics", {})
    positions   = report.get("top_positions", [])[:5]
    items       = report.get("action_items", [])
    ret_pct     = perf.get("total_return_pct", metrics.get("total_return_pct", 0)) or 0
    gain_color  = "#22c55e" if ret_pct >= 0 else "#ef4444"
    ret_sign    = "+" if ret_pct >= 0 else ""
    total_val   = metrics.get("total_value",    perf.get("total_value",    0)) or 0
    unreal_gain = metrics.get("unrealized_gain", perf.get("unrealized_gain", 0)) or 0
    best        = perf.get("best_performer") or {}
    gain_unreal_color = "#22c55e" if (unreal_gain or 0) >= 0 else "#ef4444"

    def fmt_usd(v):
        try:
            v = float(v)
            if abs(v) >= 1_000_000:
                return f"${v/1_000_000:.1f}M"
            if abs(v) >= 1_000:
                return f"${v/1_000:.1f}K"
            return f"${v:,.0f}"
        except Exception:
            return "—"

    # ── Pre-build variable sections (avoids nested f-string issues) ──────────

    vs_sp500     = perf.get("vs_sp500", metrics.get("vs_sp500", ""))
    vs_sp500_html = (
        f'<p style="color:#6b7280;font-size:13px;margin:0 0 20px">{vs_sp500}</p>'
        if vs_sp500 else '<div style="margin-bottom:20px"></div>'
    )

    best_html = ""
    if best.get("ticker"):
        best_html = (
            '<div>'
            '<p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Mejor posición</p>'
            f'<p style="color:#22c55e;font-size:18px;font-weight:800;margin:0">'
            f'{best.get("ticker","—")} +{best.get("gain_pct",0):.1f}%</p>'
            '</div>'
        )

    exec_summary = report.get("executive_summary", "")
    exec_html = ""
    if exec_summary:
        exec_html = (
            '<div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:24px;margin-bottom:20px">'
            '<p style="color:#00a85e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">Resumen Ejecutivo</p>'
            f'<p style="color:#d1d5db;font-size:15px;line-height:1.7;margin:0">{exec_summary}</p>'
            '</div>'
        )

    pos_rows = ""
    for p in positions:
        g      = p.get("gain_pct", 0) or 0
        g_col  = "#22c55e" if g >= 0 else "#ef4444"
        g_sign = "+" if g >= 0 else ""
        pos_rows += (
            "<tr>"
            f'<td style="padding:10px 12px;color:#fff;font-weight:600;font-size:13px">{p.get("ticker","")}</td>'
            f'<td style="padding:10px 12px;color:#9ca3af;font-size:13px">{p.get("name","")[:22]}</td>'
            f'<td style="padding:10px 12px;color:#fff;font-size:13px;text-align:right">{fmt_usd(p.get("value",0))}</td>'
            f'<td style="padding:10px 12px;color:{g_col};font-weight:700;font-size:13px;text-align:right">{g_sign}{g:.1f}%</td>'
            "</tr>"
        )
    positions_html = ""
    if pos_rows:
        positions_html = (
            '<div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">'
            '<div style="padding:16px 20px;border-bottom:1px solid #2a2d3a">'
            '<p style="color:#00a85e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">Principales Posiciones</p>'
            '</div>'
            '<table style="width:100%;border-collapse:collapse">'
            '<thead><tr style="background:#0f1117">'
            '<th style="padding:8px 12px;color:#6b7280;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:1px">Ticker</th>'
            '<th style="padding:8px 12px;color:#6b7280;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:1px">Empresa</th>'
            '<th style="padding:8px 12px;color:#6b7280;font-size:11px;font-weight:600;text-align:right;text-transform:uppercase;letter-spacing:1px">Valor</th>'
            '<th style="padding:8px 12px;color:#6b7280;font-size:11px;font-weight:600;text-align:right;text-transform:uppercase;letter-spacing:1px">Retorno</th>'
            f'</tr></thead><tbody>{pos_rows}</tbody></table></div>'
        )

    mentor_note = report.get("mentor_note", "")
    mentor_html = ""
    if mentor_note:
        mentor_html = (
            '<div style="background:linear-gradient(135deg,#0f1117,#1a1d27);border:1px solid #00a85e33;'
            'border-left:3px solid #00a85e;border-radius:0 16px 16px 0;padding:24px;margin-bottom:20px">'
            '<p style="color:#00a85e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">Nota de tu Mentor</p>'
            f'<p style="color:#d1d5db;font-size:15px;line-height:1.7;margin:0;font-style:italic">"{mentor_note}"</p>'
            '</div>'
        )

    icons       = ["①", "②", "③"]
    action_html = ""
    for i, item in enumerate(items[:3]):
        icon = icons[i] if i < len(icons) else "•"
        action_html += (
            '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">'
            f'<span style="color:#00a85e;font-weight:800;font-size:16px;line-height:1.4;min-width:20px">{icon}</span>'
            f'<p style="margin:0;color:#d1d5db;font-size:14px;line-height:1.6">{item}</p>'
            '</div>'
        )
    actions_html = ""
    if action_html:
        actions_html = (
            '<div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:24px;margin-bottom:20px">'
            '<p style="color:#00a85e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 16px">Acciones para el Próximo Mes</p>'
            f'{action_html}'
            '</div>'
        )

    risk_assess = report.get("risk_assessment", "")
    learning    = report.get("learning_insight", "")
    risk_html   = ""
    if risk_assess:
        risk_html = (
            '<div style="flex:1;min-width:240px;background:#1a1d27;border:1px solid #f59e0b33;border-radius:16px;padding:20px">'
            '<p style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 10px">Evaluación de Riesgo</p>'
            f'<p style="color:#d1d5db;font-size:13px;line-height:1.6;margin:0">{risk_assess}</p>'
            '</div>'
        )
    learning_html = ""
    if learning:
        learning_html = (
            '<div style="flex:1;min-width:240px;background:#1a1d27;border:1px solid #8b5cf633;border-radius:16px;padding:20px">'
            '<p style="color:#a78bfa;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 10px">Insight del Mes</p>'
            f'<p style="color:#d1d5db;font-size:13px;line-height:1.6;margin:0">{learning}</p>'
            '</div>'
        )
    risk_learning_html = ""
    if risk_html or learning_html:
        risk_learning_html = (
            f'<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">'
            f'{risk_html}{learning_html}'
            '</div>'
        )

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reporte Mensual — {month}</title>
</head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:620px;margin:0 auto;padding:32px 16px">

  <!-- Header -->
  <div style="text-align:center;margin-bottom:28px">
    <div style="display:inline-block;background:linear-gradient(135deg,#00a85e22,#3b82f622);border:1px solid #00a85e44;border-radius:16px;padding:12px 24px;margin-bottom:16px">
      <span style="color:#00a85e;font-weight:800;font-size:13px;letter-spacing:2px;text-transform:uppercase">Nuvos AI · Reporte Mensual</span>
    </div>
    <h1 style="color:#fff;font-size:28px;font-weight:900;margin:0 0 6px">{month}</h1>
    <p style="color:#6b7280;font-size:15px;margin:0">Hola <strong style="color:#d1d5db">{name}</strong>, aquí está el análisis completo de tu portafolio</p>
  </div>

  <!-- Performance hero -->
  <div style="background:linear-gradient(135deg,#1a1d27,#1e2235);border:1px solid #2a2d3a;border-radius:20px;padding:28px;margin-bottom:20px;text-align:center">
    <p style="color:#9ca3af;font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px">Retorno del mes</p>
    <div style="font-size:48px;font-weight:900;color:{gain_color};margin:0 0 4px">{ret_sign}{ret_pct:.2f}%</div>
    {vs_sp500_html}
    <div style="display:flex;justify-content:center;gap:32px;flex-wrap:wrap">
      <div>
        <p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Valor total</p>
        <p style="color:#fff;font-size:18px;font-weight:800;margin:0">{fmt_usd(total_val)}</p>
      </div>
      <div>
        <p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Ganancia no realizada</p>
        <p style="color:{gain_unreal_color};font-size:18px;font-weight:800;margin:0">{fmt_usd(unreal_gain)}</p>
      </div>
      {best_html}
    </div>
  </div>

  {exec_html}
  {positions_html}
  {mentor_html}
  {actions_html}
  {risk_learning_html}

  <!-- Footer -->
  <div style="border-top:1px solid #2a2d3a;padding-top:24px;text-align:center">
    <p style="color:#6b7280;font-size:12px;margin:0 0 8px">
      <strong style="color:#9ca3af">Nuvos AI</strong> — Solo educativo. No constituye asesoramiento financiero profesional.
    </p>
    <p style="color:#4b5563;font-size:11px;margin:0">
      Generado automáticamente a partir de los datos de tu portafolio en la app.
    </p>
  </div>

</div>
</body>
</html>"""


async def generate_and_send_monthly_report(user_id: str, email: str, name: str) -> bool:
    """Fetch portfolio, compute performance, generate AI report and email it."""
    import asyncio
    from app.core.database import get_supabase, run_query
    from app.api.routes.market import _get_user_profile
    from app.api.routes.report import _compute_performance
    from app.services import ai_service
    from datetime import datetime

    db = get_supabase()

    # Fetch portfolio
    try:
        row = await run_query(db.table("user_portfolio").select("positions").eq("user_id", user_id))
        if not row.data:
            return False
        raw = row.data[0]["positions"]
        if isinstance(raw, list):
            positions = raw
        elif isinstance(raw, dict) and "_v" in raw:
            positions = raw.get("positions", [])
        else:
            positions = []
        if not positions:
            return False
    except Exception:
        return False

    # Build portfolio list expected by _compute_performance
    portfolio = [
        {
            "ticker":        p.get("ticker", ""),
            "name":          p.get("name", p.get("ticker", "")),
            "shares":        p.get("shares", 0),
            "avg_cost":      p.get("avgPrice", p.get("avg_price", p.get("avg_cost", 0))),
            "current_price": p.get("currentPrice", p.get("current_price", 0)),
        }
        for p in positions if p.get("ticker")
    ]

    try:
        performance = await asyncio.to_thread(_compute_performance, portfolio)
        profile     = _get_user_profile(user_id)
        report      = await ai_service.generate_monthly_report(portfolio, performance, profile)
    except Exception:
        return False

    # Enrich with computed numbers
    report["performance"] = {
        **report.get("performance", {}),
        "total_return_pct": performance["total_return_pct"],
        "total_value":      performance["total_value"],
        "unrealized_gain":  performance["unrealized_gain"],
        "best_performer":   performance["best_performer"],
        "worst_performer":  performance["worst_performer"],
    }
    report["metrics"] = {
        **report.get("metrics", {}),
        "total_value":    performance["total_value"],
        "unrealized_gain": performance["unrealized_gain"],
    }
    report["top_positions"] = performance["positions"]

    month = datetime.now().strftime("%B %Y").capitalize()
    html  = build_monthly_report_html(name, report, month)
    first = name.split()[0] if name else "Inversor"
    return await send_email(
        email,
        f"📊 Tu reporte mensual de {month}, {first}",
        html,
    )
