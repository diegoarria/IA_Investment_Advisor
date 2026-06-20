import httpx
import re
from app.core.config import settings

# ── Logo (JPEG 160px, white background strip) ─────────────────────────────────
# To replace with a hosted URL: set NUVOS_LOGO_SRC = "https://your-cdn/logo.png"
with open(__file__.replace("email_service.py", "_nuvos_logo.b64"), "r") as _f:
    NUVOS_LOGO_SRC = _f.read().strip()


def _render_md(text: str) -> str:
    """Convert AI-generated markdown to inline-safe HTML for email clients."""
    lines = text.split("\n")
    html_parts = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # H1/H2/H3 headings
        h3_match = re.match(r"^###\s+(.*)", stripped)
        h2_match = re.match(r"^##\s+(.*)", stripped)
        h1_match = re.match(r"^#\s+(.*)", stripped)
        if h3_match:
            inner = _inline_md(h3_match.group(1))
            html_parts.append(f'<p style="color:#fff;font-size:14px;font-weight:800;margin:16px 0 6px;letter-spacing:-0.2px">{inner}</p>')
        elif h2_match:
            inner = _inline_md(h2_match.group(1))
            html_parts.append(f'<p style="color:#fff;font-size:15px;font-weight:800;margin:18px 0 8px">{inner}</p>')
        elif h1_match:
            inner = _inline_md(h1_match.group(1))
            html_parts.append(f'<p style="color:#fff;font-size:16px;font-weight:900;margin:20px 0 8px">{inner}</p>')
        elif stripped.startswith("- ") or stripped.startswith("* "):
            inner = _inline_md(stripped[2:])
            html_parts.append(f'<p style="color:#d1d5db;font-size:14px;line-height:1.7;margin:4px 0 4px 12px">• {inner}</p>')
        elif re.match(r"^-{3,}$", stripped):
            html_parts.append('<div style="border-top:1px solid #2a2d3a;margin:16px 0"></div>')
        else:
            inner = _inline_md(stripped)
            html_parts.append(f'<p style="color:#d1d5db;font-size:14px;line-height:1.7;margin:0 0 12px">{inner}</p>')
    return "\n".join(html_parts)


def _inline_md(text: str) -> str:
    """Convert inline markdown (bold, italic, code) to HTML spans."""
    # Bold+italic ***text***
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r'<strong><em>\1</em></strong>', text)
    # Bold **text**
    text = re.sub(r"\*\*(.+?)\*\*", r'<strong style="color:#fff;font-weight:800">\1</strong>', text)
    # Italic *text*
    text = re.sub(r"\*(.+?)\*", r'<em style="color:#e5e7eb">\1</em>', text)
    # Inline code `text`
    text = re.sub(r"`(.+?)`", r'<code style="background:#1e2235;color:#00a85e;padding:2px 5px;border-radius:4px;font-size:12px">\1</code>', text)
    return text


def _nuvos_email_header(tagline: str = "Tu asistente de inversiones") -> str:
    """White strip header with Nuvos AI logo — works on any email client."""
    return f"""
  <!-- ── Logo header (white strip) ── -->
  <div style="background:#ffffff;border-radius:20px 20px 0 0;padding:28px 32px 24px;text-align:center;border-bottom:1px solid #e5e7eb">
    <img src="{NUVOS_LOGO_SRC}" alt="Nuvos AI" width="140" height="auto"
         style="display:block;margin:0 auto;max-width:140px;height:auto">
    <p style="color:#6b7280;font-size:12px;margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">{tagline}</p>
  </div>"""


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
    first = name.split()[0] if name else "Inversor"
    risk_color = {"conservative": "#3b82f6", "moderate": "#22c55e", "aggressive": "#f59e0b"}.get(
        (risk or "").split("_")[0], "#22c55e"
    )
    rendered = _render_md(summary)
    cta_url  = "https://nuvosai.com/home"
    header   = _nuvos_email_header("Resumen Semanal de Inversión")
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    {header}

    <!-- Dark content -->
    <div style="background:#1a1d27;padding:32px">
      <h1 style="color:#fff;font-size:22px;font-weight:900;margin:0 0 6px;line-height:1.3">
        Hola {first}, aquí está tu resumen de esta semana 👋
      </h1>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 28px;line-height:1.6">
        Mercados cerrados. Es momento de reflexionar y prepararse para la próxima semana.
      </p>

      <div style="background:#0f1117;border-radius:16px;padding:24px;border:1px solid #2a2d3a;margin-bottom:24px">
        <p style="color:{risk_color};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 16px">
          ANÁLISIS PERSONALIZADO
        </p>
        {rendered}
      </div>

      <div style="text-align:center;margin-bottom:24px">
        <a href="{cta_url}" style="display:inline-block;background:{risk_color};color:#000;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none">Abrir Nuvos AI →</a>
      </div>

      <div style="border-top:1px solid #2a2d3a;padding-top:18px;text-align:center">
        <p style="color:#4b5563;font-size:11px;margin:0">Nuvos AI — Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


async def generate_and_send_weekly_summary(user_id: str, email: str, name: str, risk: str, chat_snippets: list[str]) -> bool:
    from app.services import ai_service
    import logging
    logger = logging.getLogger(__name__)

    is_premium = bool(chat_snippets)
    context = "\n".join(f"- {s}" for s in chat_snippets[:10]) if chat_snippets else ""

    if is_premium:
        intro = f"""Eres Nuvos, mentor y educador de inversiones de {name}, con perfil {risk}.
Esta semana tuvieron las siguientes conversaciones de inversión:
{context}

Escribe un resumen semanal PERSONALIZADO de máximo 220 palabras que incluya:"""
    else:
        intro = f"""Eres Nuvos, mentor y educador de inversiones para {name}, inversor con perfil {risk}.

Escribe un resumen semanal GENERAL de los mercados de máximo 150 palabras que incluya:"""

    prompt = f"""{intro}
1. Qué pasó en los mercados esta semana (menciona S&P 500, tasas o eventos relevantes de la semana actual)
2. Cómo aplica eso al perfil {risk} de {name}
3. Una reflexión o acción concreta para la próxima semana
4. Una frase motivacional corta al final

Tono: cálido, profesional, directo. Como un mentor que se preocupa por el progreso del usuario."""

    try:
        summary = ""
        async for chunk in ai_service.chat_stream(
            message=prompt, conversation_history=[], profile=None, mentor=None,
        ):
            summary += chunk

        html = build_weekly_summary_html(name, summary, risk)
        ok = await send_email(email, f"Tu resumen semanal de inversión, {name} 📈", html)
        if not ok:
            logger.error("send_email returned False for %s (%s)", email, user_id)
        return ok
    except Exception as e:
        logger.error("generate_and_send_weekly_summary failed for %s: %s", email, e)
        return False


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


# ─────────────────────────────────────────────────────────────────────────────
# Enhanced Weekly Summary Email  (with portfolio performance data)
# ─────────────────────────────────────────────────────────────────────────────

def _pct_color(v: float | None) -> str:
    return "#22c55e" if (v or 0) >= 0 else "#ef4444"


def _pct_emoji_html(v: float | None) -> str:
    if v is None:
        return "—"
    if v >= 2.0:
        return "🚀"
    if v >= 0.0:
        return "🟢"
    if v >= -2.0:
        return "🔴"
    return "📉"


def _build_market_wrap_table(
    sp500_perf: float | None,
    nasdaq_perf: float | None,
    user_perf: float | None = None,
    top_ticker: str | None = None,
    top_perf: float | None = None,
) -> str:
    """Visual Market Wrap table: S&P 500 | NASDAQ | Tu Portafolio (optional) | Top Activo (optional)."""

    def cell(label: str, value: float | None, highlight: bool = False) -> str:
        fmt_val = f"{value:+.2f}%" if value is not None else "—"
        color   = _pct_color(value) if value is not None else "#6b7280"
        emoji   = _pct_emoji_html(value)
        bg      = "background:rgba(0,168,94,0.08);" if highlight else ""
        return (
            f'<td style="padding:16px 10px;text-align:center;{bg}">'
            f'<p style="color:#6b7280;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin:0 0 6px">{label}</p>'
            f'<p style="color:{color};font-size:20px;font-weight:900;margin:0 0 2px">{fmt_val}</p>'
            f'<p style="font-size:16px;margin:0">{emoji}</p>'
            f'</td>'
        )

    cols = [
        cell("S&amp;P 500", sp500_perf),
        cell("NASDAQ",    nasdaq_perf),
    ]
    if user_perf is not None:
        cols.append(cell("Tu portafolio", user_perf, highlight=True))
    if top_ticker and top_perf is not None:
        cols.append(cell(f"Top: {top_ticker}", top_perf))

    dividers = "".join(
        f'<td style="width:1px;padding:0;background:#2a2d3a"></td>{c}' if i > 0 else c
        for i, c in enumerate(cols)
    )
    return (
        '<div style="border:1px solid #2a2d3a;border-radius:14px;overflow:hidden;margin-bottom:20px">'
        '<div style="background:#111318;padding:10px 18px;border-bottom:1px solid #2a2d3a">'
        '<p style="color:#6b7280;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">📊 MARKET WRAP — RENDIMIENTO SEMANAL</p>'
        '</div>'
        '<table style="width:100%;border-collapse:collapse;background:#1a1d27">'
        f'<tr>{dividers}</tr>'
        '</table>'
        '</div>'
    )


def build_enhanced_weekly_html(
    name: str,
    is_premium: bool,
    user_perf: float | None,
    sp500_perf: float | None,
    nasdaq_perf: float | None,
    top_ticker: str | None,
    top_perf: float | None,
    sector: str | None,
    ai_summary: str,
    risk: str = "moderate",
) -> str:
    first  = name.split()[0] if name else "Inversor"
    header = _nuvos_email_header("Resumen Semanal de Inversión")

    def fmt(v, sign=True):
        if v is None:
            return "—"
        prefix = "+" if sign and v > 0 else ""
        return f"{prefix}{v:.2f}%"

    beats      = (user_perf is not None and sp500_perf is not None and user_perf > sp500_perf)
    perf_color = _pct_color(user_perf)

    # ── 1. Market Wrap comparison table (always shown) ─────────────────────────
    market_wrap = _build_market_wrap_table(
        sp500_perf, nasdaq_perf,
        user_perf  if is_premium else None,
        top_ticker if is_premium else None,
        top_perf   if is_premium else None,
    )

    # ── 2. Performance hero for premium ───────────────────────────────────────
    perf_hero = ""
    if is_premium and user_perf is not None:
        vs_label  = "🏆 Superaste al S&P 500 esta semana" if beats else "📊 Debajo del S&P 500 esta semana"
        perf_hero = f"""
      <div style="text-align:center;padding:8px 0 20px">
        <div style="font-size:44px;font-weight:900;color:{perf_color};letter-spacing:-1px">{fmt(user_perf)}</div>
        <p style="color:#6b7280;font-size:13px;margin:4px 0 0">{vs_label}</p>
      </div>"""
    elif not is_premium:
        perf_hero = """
      <div style="margin-bottom:4px;padding:10px 14px;background:rgba(0,168,94,0.07);border:1px solid rgba(0,168,94,0.2);border-radius:10px;text-align:center">
        <p style="color:#00a85e;font-size:12px;margin:0;font-weight:600">🔒 Activa <strong>Premium</strong> para ver el rendimiento real de tu portafolio</p>
      </div>"""

    # ── 3. AI analysis (behavioral context) ───────────────────────────────────
    rendered    = _render_md(ai_summary)
    sector_note = f'<p style="color:#9ca3af;font-size:12px;margin:16px 0 0">📍 Sector destacado esta semana: <strong style="color:#d1d5db">{sector}</strong></p>' if sector else ""

    # ── 4. Personalized CTA per risk profile ──────────────────────────────────
    _cta_base = "https://nuvosai.com"
    cta_config = {
        "conservative": {
            "text":  "Revisar mis dividendos →",
            "color": "#3b82f6",
            "url":   f"{_cta_base}/portfolio",
            "note":  "💡 Esta semana: revisa la cobertura de dividendos de tus posiciones.",
        },
        "moderate": {
            "text":  "Ver mi análisis semanal →",
            "color": "#00a85e",
            "url":   f"{_cta_base}/home",
            "note":  "💡 Esta semana: evalúa el balance entre crecimiento y valor en tu portafolio.",
        },
        "aggressive": {
            "text":  "Explorar señales técnicas →",
            "color": "#f59e0b",
            "url":   f"{_cta_base}/portfolio",
            "note":  "💡 Esta semana: identifica activos con alta beta que puedan superar al índice.",
        },
    }
    cta = cta_config.get(risk, cta_config["moderate"])

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    {header}

    <div style="background:#1a1d27;padding:32px">
      <h1 style="color:#fff;font-size:22px;font-weight:900;margin:0 0 6px">Hola {first}, ¿cómo fue tu semana? 👋</h1>
      <p style="color:#9ca3af;font-size:13px;margin:0 0 20px">La semana cerró. Es momento de reflexionar y prepararse para el lunes.</p>

      {market_wrap}
      {perf_hero}

      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:14px;padding:24px;margin-bottom:20px">
        <p style="color:#00a85e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 16px">ANÁLISIS DE LA SEMANA</p>
        {rendered}
        {sector_note}
      </div>

      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:12px;padding:14px 18px;margin-bottom:20px">
        <p style="color:#9ca3af;font-size:13px;margin:0">{cta["note"]}</p>
      </div>

      <div style="text-align:center;margin-bottom:20px">
        <a href="{cta["url"]}" style="display:inline-block;background:{cta["color"]};color:#000;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none">{cta["text"]}</a>
      </div>

      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#4b5563;font-size:11px;margin:0">Nuvos AI — Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


# ─────────────────────────────────────────────────────────────────────────────
# Earnings Results Email
# ─────────────────────────────────────────────────────────────────────────────

def build_earnings_results_html(
    name: str,
    ticker: str,
    eps_real: float | None,
    eps_est: float | None,
    rev_real_b: float | None,
    rev_est_b: float | None,
    change_pct: float | None,
) -> str:
    first    = name.split()[0] if name else "Inversor"
    header   = _nuvos_email_header(f"Alerta de Resultados — {ticker}")
    beat_eps = (eps_real is not None and eps_est is not None and eps_real >= eps_est)
    beat_rev = (rev_real_b is not None and rev_est_b is not None and rev_real_b >= rev_est_b)

    def fmt_eps(v):
        return f"${v:.2f}" if v is not None else "N/D"
    def fmt_rev(v):
        return f"${v:.2f}B" if v is not None else "N/D"

    eps_color  = "#22c55e" if beat_eps else "#ef4444"
    rev_color  = "#22c55e" if beat_rev else "#ef4444"
    eps_label  = "✅ Superó estimados" if beat_eps else "❌ Debajo de estimados"
    rev_label  = "✅ Superó estimados" if beat_rev else "❌ Debajo de estimados"

    if change_pct is not None:
        ch_color  = "#22c55e" if change_pct >= 0 else "#ef4444"
        ch_prefix = "+" if change_pct >= 0 else ""
        change_str = f'<span style="color:{ch_color};font-weight:900;font-size:28px">{ch_prefix}{change_pct:.2f}%</span>'
    else:
        change_str = '<span style="color:#6b7280;font-size:28px">—</span>'

    cta_url = f"https://nuvosai.com/home"
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    {header}

    <div style="background:#1a1d27;padding:32px">
      <div style="display:inline-block;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:6px 14px;margin-bottom:16px">
        <span style="color:#f59e0b;font-weight:700;font-size:11px;letter-spacing:1.5px;text-transform:uppercase">⚠️ Earnings Report</span>
      </div>
      <h1 style="color:#fff;font-size:22px;font-weight:900;margin:0 0 6px">Hola {first}, <strong style="color:#f59e0b">{ticker}</strong> acaba de reportar resultados</h1>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 24px">Tu posición puede verse afectada. Aquí está el desglose completo.</p>

      <!-- Results table -->
      <div style="border:1px solid #2a2d3a;border-radius:14px;overflow:hidden;margin-bottom:16px">
        <div style="background:#111318;padding:12px 18px;border-bottom:1px solid #2a2d3a">
          <p style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">Resultados Trimestrales</p>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#1a1d27">
          <thead><tr style="background:#111318">
            <th style="padding:10px 16px;color:#6b7280;font-size:11px;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600">Métrica</th>
            <th style="padding:10px 16px;color:#6b7280;font-size:11px;text-align:right;text-transform:uppercase;letter-spacing:1px;font-weight:600">Real</th>
            <th style="padding:10px 16px;color:#6b7280;font-size:11px;text-align:right;text-transform:uppercase;letter-spacing:1px;font-weight:600">Estimado</th>
            <th style="padding:10px 16px;color:#6b7280;font-size:11px;text-align:right;text-transform:uppercase;letter-spacing:1px;font-weight:600">Resultado</th>
          </tr></thead>
          <tbody>
            <tr style="border-top:1px solid #2a2d3a">
              <td style="padding:14px 16px;color:#d1d5db;font-size:14px;font-weight:700">EPS</td>
              <td style="padding:14px 16px;color:{eps_color};font-size:16px;font-weight:900;text-align:right">{fmt_eps(eps_real)}</td>
              <td style="padding:14px 16px;color:#6b7280;font-size:14px;text-align:right">{fmt_eps(eps_est)}</td>
              <td style="padding:14px 16px;color:{eps_color};font-size:12px;text-align:right;font-weight:700">{eps_label}</td>
            </tr>
            <tr style="border-top:1px solid #2a2d3a">
              <td style="padding:14px 16px;color:#d1d5db;font-size:14px;font-weight:700">Ingresos</td>
              <td style="padding:14px 16px;color:{rev_color};font-size:16px;font-weight:900;text-align:right">{fmt_rev(rev_real_b)}</td>
              <td style="padding:14px 16px;color:#6b7280;font-size:14px;text-align:right">{fmt_rev(rev_est_b)}</td>
              <td style="padding:14px 16px;color:{rev_color};font-size:12px;text-align:right;font-weight:700">{rev_label}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Price impact -->
      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:14px;padding:20px;margin-bottom:20px;text-align:center">
        <p style="color:#9ca3af;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1.5px">Impacto en precio (hoy)</p>
        {change_str}
        <p style="color:#6b7280;font-size:12px;margin:8px 0 0;line-height:1.5">La volatilidad post-earnings suele mantenerse 48 horas. Monitorea con atención.</p>
      </div>

      <div style="text-align:center;margin-bottom:20px">
        <a href="{cta_url}" style="display:inline-block;background:#f59e0b;color:#000;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none">Ver análisis técnico de Nuvos →</a>
      </div>

      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#4b5563;font-size:11px;margin:0">Nuvos AI — Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


# ─────────────────────────────────────────────────────────────────────────────
# Birthday Email
# ─────────────────────────────────────────────────────────────────────────────

def build_birthday_html(name: str) -> str:
    first   = name.split()[0] if name else "Inversor"
    header  = _nuvos_email_header("Un regalo especial para ti 🎁")
    cta_url = "https://nuvosai.com/premium-success?source=birthday"
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    {header}

    <div style="background:#1a1d27;padding:32px;text-align:center">
      <div style="font-size:56px;margin-bottom:16px">🎂</div>
      <h1 style="color:#fff;font-size:28px;font-weight:900;margin:0 0 10px">¡Feliz cumpleaños, {first}!</h1>
      <p style="color:#9ca3af;font-size:15px;margin:0 0 28px;line-height:1.7">De parte de todo el equipo de Nuvos AI,<br>te deseamos un día lleno de éxitos personales y financieros.</p>

      <div style="background:linear-gradient(135deg,#0f2a1a,#111318);border:1px solid rgba(0,168,94,0.35);border-radius:16px;padding:28px;margin-bottom:24px">
        <div style="font-size:32px;margin-bottom:12px">🎁</div>
        <p style="color:#00a85e;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px">TU REGALO DE CUMPLEAÑOS</p>
        <p style="color:#fff;font-size:22px;font-weight:900;margin:0 0 10px">7 días de acceso Premium</p>
        <p style="color:#9ca3af;font-size:14px;margin:0 0 22px;line-height:1.7">Sin costo. Sin tarjeta de crédito.<br>Portafolio en tiempo real, análisis de earnings, IA personalizada y más.</p>
        <a href="{cta_url}" style="display:inline-block;background:#00a85e;color:#000;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none">🎁 Activar mi regalo Premium</a>
      </div>

      <p style="color:#6b7280;font-size:14px;margin:0 0 0;line-height:1.7">¡A disfrutar! 🥂<br><strong style="color:#d1d5db">El equipo de Nuvos AI</strong></p>

      <div style="border-top:1px solid #2a2d3a;padding-top:16px;margin-top:24px">
        <p style="color:#4b5563;font-size:11px;margin:0">Nuvos AI — Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


# ─────────────────────────────────────────────────────────────────────────────
# Re-engagement Email (7+ days inactive)
# ─────────────────────────────────────────────────────────────────────────────

def build_reengagement_html(name: str, movers: list[dict]) -> str:
    first   = name.split()[0] if name else "Inversor"
    header  = _nuvos_email_header("Te hemos echado de menos")
    cta_url = "https://nuvosai.com/home"

    movers_html = ""
    for m in movers[:3]:
        ticker = m.get("ticker", "")
        pct    = m.get("change_pct", 0)
        color  = "#22c55e" if pct >= 0 else "#ef4444"
        sign   = "+" if pct >= 0 else ""
        emoji  = "🚀" if pct >= 0 else "📉"
        movers_html += f'<tr style="border-top:1px solid #2a2d3a"><td style="padding:14px 18px"><span style="font-size:16px">{emoji}</span> <strong style="color:#d1d5db;font-size:14px">{ticker}</strong></td><td style="padding:14px 18px;text-align:right;color:{color};font-size:15px;font-weight:800">{sign}{pct:.2f}%</td></tr>'

    if not movers_html:
        movers_html = '<tr><td colspan="2" style="padding:16px;text-align:center;color:#6b7280;font-size:13px">Tus activos están en movimiento esta semana.</td></tr>'

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    {header}

    <div style="background:#1a1d27;padding:32px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:48px;margin-bottom:12px">📊</div>
        <h1 style="color:#fff;font-size:22px;font-weight:900;margin:0 0 8px">¡Tu portafolio te extraña, {first}!</h1>
        <p style="color:#9ca3af;font-size:14px;margin:0;line-height:1.6">El mercado ha tenido movimientos interesantes esta semana.<br>Tus activos han superado sus medias móviles de 50 días.</p>
      </div>

      <div style="border:1px solid #2a2d3a;border-radius:14px;overflow:hidden;margin-bottom:20px">
        <div style="background:#111318;padding:12px 18px;border-bottom:1px solid #2a2d3a">
          <p style="color:#00a85e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">Movimientos recientes</p>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#1a1d27">
          {movers_html}
        </table>
      </div>

      <p style="color:#9ca3af;font-size:14px;margin:0 0 20px;text-align:center;line-height:1.7">No dejes que las oportunidades pasen desapercibidas.</p>

      <div style="text-align:center;margin-bottom:20px">
        <a href="{cta_url}" style="display:inline-block;background:#00a85e;color:#000;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none">Revisar mi portafolio →</a>
      </div>

      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#4b5563;font-size:11px;margin:0">Nuvos AI — Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


# ─────────────────────────────────────────────────────────────────────────────
# Educational Email (biweekly)
# ─────────────────────────────────────────────────────────────────────────────

def build_educational_email_html(name: str, concept: str, explanation: str, example: str) -> str:
    first   = name.split()[0] if name else "Inversor"
    header  = _nuvos_email_header("Academia Nuvos · Concepto Quincenal")
    cta_url = "https://nuvosai.com/academy"
    paragraphs = "".join(
        f"<p style='margin:0 0 14px;color:#d1d5db;font-size:14px;line-height:1.75'>{p.strip()}</p>"
        for p in explanation.split("\n") if p.strip()
    )
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    {header}

    <div style="background:#1a1d27;padding:32px">
      <h1 style="color:#fff;font-size:22px;font-weight:900;margin:0 0 6px">Hola {first}, ¿conoces este concepto? 📚</h1>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 24px">Cada dos semanas te compartimos una idea clave que todo inversor debería dominar.</p>

      <div style="background:linear-gradient(135deg,#140e28,#1a1d27);border:1px solid rgba(139,92,246,0.3);border-radius:14px;padding:24px;margin-bottom:16px">
        <p style="color:#8b5cf6;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px">CONCEPTO DE LA QUINCENA</p>
        <h2 style="color:#fff;font-size:22px;font-weight:900;margin:0 0 20px;line-height:1.3">{concept}</h2>
        {paragraphs}
      </div>

      <div style="background:#111318;border:1px solid rgba(245,158,11,0.25);border-radius:14px;padding:20px;margin-bottom:20px">
        <p style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 10px">💡 EJEMPLO PRÁCTICO</p>
        <p style="color:#d1d5db;font-size:14px;margin:0;line-height:1.7">{example}</p>
      </div>

      <div style="text-align:center;margin-bottom:20px">
        <a href="{cta_url}" style="display:inline-block;background:#8b5cf6;color:#fff;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none">Ir a la Academia Nuvos →</a>
      </div>

      <div style="border-top:1px solid #2a2d3a;padding-top:16px;text-align:center">
        <p style="color:#4b5563;font-size:11px;margin:0">Nuvos AI — Solo educativo. No constituye asesoramiento financiero profesional.</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""
