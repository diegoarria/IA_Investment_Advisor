"""
Email templates — dark theme, mobile-responsive.
Complements the existing email_service.py templates.
"""


def personalized_daily_email(name: str, market_data: dict, news: list, portfolio_day: dict | None = None) -> str:
    """Daily close email personalized per user — includes their portfolio day performance."""
    from app.services.email_service import _nuvos_email_header
    indices = market_data.get("indices", {})
    first   = name.split()[0] if name else "Inversor"
    header  = _nuvos_email_header("Cierre del mercado")

    def _idx_row(label: str) -> str:
        d     = indices.get(label, {})
        pct   = d.get("change_pct")
        price = d.get("price")
        if pct is None:
            return ""
        color = "#22c55e" if pct >= 0 else "#ef4444"
        sign  = "+" if pct >= 0 else ""
        return (
            f'<tr style="border-bottom:1px solid #2a2d3a">'
            f'<td style="padding:10px 16px;color:#d1d5db;font-size:14px">{label}</td>'
            f'<td style="padding:10px 16px;color:#9ca3af;font-size:13px;text-align:right">${price:,.2f}</td>'
            f'<td style="padding:10px 16px;font-weight:700;font-size:14px;text-align:right;color:{color}">'
            f'{sign}{pct:.2f}%</td></tr>'
        ) if price else ""

    idx_rows = _idx_row("S&P 500") + _idx_row("NASDAQ") + _idx_row("DOW")

    best      = market_data.get("best_sector", "—")
    worst     = market_data.get("worst_sector", "—")
    sectors   = market_data.get("sectors", {})
    best_pct  = sectors.get(best,  0) if best  != "—" else 0
    worst_pct = sectors.get(worst, 0) if worst != "—" else 0

    # ── Portfolio hero section ─────────────────────────────────────────────────
    portfolio_section = ""
    if portfolio_day and portfolio_day.get("positions"):
        day_pct  = portfolio_day.get("day_pct",     0) or 0
        day_usd  = portfolio_day.get("day_dollars",  0) or 0
        total    = portfolio_day.get("total_value",  0) or 0
        top_t    = portfolio_day.get("top_ticker")
        top_p    = portfolio_day.get("top_pct")
        hero_color = "#22c55e" if day_pct >= 0 else "#ef4444"
        hero_sign  = "+" if day_pct >= 0 else ""
        usd_sign   = "+" if day_usd >= 0 else ""
        top_note   = (
            f'<p style="color:#9ca3af;font-size:12px;margin:6px 0 0">🏆 Mejor posición: '
            f'<strong style="color:#d1d5db">{top_t}</strong> '
            f'<span style="color:#22c55e">{("+" if top_p >= 0 else "")}{top_p:.2f}%</span></p>'
        ) if top_t and top_p is not None else ""

        pos_rows = ""
        for p in sorted(portfolio_day["positions"], key=lambda x: x.get("day_pct", 0), reverse=True)[:6]:
            pct   = p.get("day_pct", 0) or 0
            usd   = p.get("day_dollars", 0) or 0
            val   = p.get("total_value", 0) or 0
            color = "#22c55e" if pct >= 0 else "#ef4444"
            sign  = "+" if pct >= 0 else ""
            pos_rows += (
                f'<tr style="border-top:1px solid #2a2d3a">'
                f'<td style="padding:9px 14px;color:#d1d5db;font-size:13px;font-weight:700">{p["ticker"]}</td>'
                f'<td style="padding:9px 14px;text-align:right;color:{color};font-weight:700;font-size:13px">{sign}{pct:.2f}%</td>'
                f'<td style="padding:9px 14px;text-align:right;color:{color};font-size:12px">{sign}${abs(usd):.2f}</td>'
                f'<td style="padding:9px 14px;text-align:right;color:#6b7280;font-size:12px">${val:,.2f}</td>'
                f'</tr>'
            )

        portfolio_section = f"""
  <div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">
    <div style="padding:14px 16px;border-bottom:1px solid #2a2d3a;background:#111318">
      <p style="color:#22c55e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">💼 Tu portafolio hoy</p>
    </div>
    <div style="padding:20px;text-align:center;border-bottom:1px solid #2a2d3a">
      <div style="font-size:36px;font-weight:900;color:{hero_color}">{hero_sign}{day_pct:.2f}%</div>
      <p style="color:{hero_color};font-size:14px;font-weight:700;margin:4px 0 0">{usd_sign}${abs(day_usd):.2f} hoy · Total ${total:,.2f}</p>
      {top_note}
    </div>
    <table style="width:100%;border-collapse:collapse;background:#1a1d27">
      <tr style="background:#111318">
        <th style="padding:8px 14px;text-align:left;color:#6b7280;font-size:10px;font-weight:700;letter-spacing:1px">ACTIVO</th>
        <th style="padding:8px 14px;text-align:right;color:#6b7280;font-size:10px;font-weight:700;letter-spacing:1px">HOY %</th>
        <th style="padding:8px 14px;text-align:right;color:#6b7280;font-size:10px;font-weight:700;letter-spacing:1px">HOY $</th>
        <th style="padding:8px 14px;text-align:right;color:#6b7280;font-size:10px;font-weight:700;letter-spacing:1px">VALOR</th>
      </tr>
      {pos_rows}
    </table>
  </div>"""

    news_html = ""
    for item in news[:3]:
        news_html += (
            f'<div style="padding:12px 0;border-bottom:1px solid #2a2d3a">'
            f'<p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">{item.get("publisher","")}</p>'
            f'<p style="color:#d1d5db;font-size:13px;font-weight:600;margin:0;line-height:1.4">{item.get("title","")}</p>'
            f'</div>'
        )
    news_section = (
        f'<div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:20px;margin-bottom:20px">'
        f'<p style="color:#22c55e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">📰 Noticias del día</p>'
        f'{news_html}</div>'
    ) if news_html else ""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="border-radius:20px;overflow:hidden;border:1px solid #2a2d3a">

    {header}

    <div style="background:#1a1d27;padding:28px">
      <h1 style="color:#fff;font-size:20px;font-weight:900;margin:0 0 4px">Hola {first}, así cerraron los mercados hoy 📊</h1>
      <p style="color:#9ca3af;font-size:13px;margin:0 0 24px">Actualización automática al cierre · Nuvos AI</p>

      {portfolio_section}

      <div style="background:#111318;border:1px solid #2a2d3a;border-radius:14px;overflow:hidden;margin-bottom:20px">
        <div style="padding:10px 16px;border-bottom:1px solid #2a2d3a">
          <p style="color:#6b7280;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">Índices principales</p>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#0f1117">
            <th style="padding:8px 16px;color:#6b7280;font-size:10px;text-align:left;text-transform:uppercase">Índice</th>
            <th style="padding:8px 16px;color:#6b7280;font-size:10px;text-align:right;text-transform:uppercase">Precio</th>
            <th style="padding:8px 16px;color:#6b7280;font-size:10px;text-align:right;text-transform:uppercase">Cambio</th>
          </tr></thead>
          <tbody>{idx_rows}</tbody>
        </table>
      </div>

      <div style="display:flex;gap:12px;margin-bottom:20px">
        <div style="flex:1;background:#111318;border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:16px">
          <p style="color:#22c55e;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 4px">Mejor sector</p>
          <p style="color:#fff;font-size:16px;font-weight:800;margin:0">{best}</p>
          <p style="color:#22c55e;font-size:13px;font-weight:700;margin:4px 0 0">+{best_pct:.1f}%</p>
        </div>
        <div style="flex:1;background:#111318;border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px">
          <p style="color:#ef4444;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 4px">Peor sector</p>
          <p style="color:#fff;font-size:16px;font-weight:800;margin:0">{worst}</p>
          <p style="color:#ef4444;font-size:13px;font-weight:700;margin:4px 0 0">{worst_pct:.1f}%</p>
        </div>
      </div>

      {news_section}

      <div style="text-align:center;margin-bottom:8px">
        <a href="https://nuvosai.com/portfolio" style="display:inline-block;background:#22c55e;color:#000;font-weight:800;font-size:14px;padding:12px 28px;border-radius:12px;text-decoration:none">Ver mi portafolio →</a>
      </div>

      <div style="border-top:1px solid #2a2d3a;padding-top:16px;margin-top:20px;text-align:center">
        <p style="color:#4b5563;font-size:11px;margin:0">Nuvos AI — Solo educativo. No constituye asesoramiento financiero.</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>"""


def daily_summary_email(market_data: dict, news: list) -> str:
    indices = market_data.get("indices", {})

    def _idx_row(name: str) -> str:
        d = indices.get(name, {})
        pct = d.get("change_pct")
        price = d.get("price")
        if pct is None:
            return ""
        color = "#22c55e" if pct >= 0 else "#ef4444"
        sign  = "+" if pct >= 0 else ""
        price_fmt = f"${price:,.2f}" if price else "—"
        return (
            f'<tr style="border-bottom:1px solid #1e2235">'
            f'<td style="padding:10px 16px;color:#d1d5db;font-size:14px">{name}</td>'
            f'<td style="padding:10px 16px;color:#9ca3af;font-size:13px;text-align:right">{price_fmt}</td>'
            f'<td style="padding:10px 16px;font-weight:700;font-size:14px;text-align:right;color:{color}">'
            f'{sign}{pct:.2f}%</td></tr>'
        )

    idx_rows = _idx_row("S&P 500") + _idx_row("NASDAQ") + _idx_row("DOW")
    best  = market_data.get("best_sector", "—")
    worst = market_data.get("worst_sector", "—")
    sectors   = market_data.get("sectors", {})
    best_pct  = sectors.get(best,  0) if best  != "—" else 0
    worst_pct = sectors.get(worst, 0) if worst != "—" else 0

    news_html = ""
    for item in news[:3]:
        news_html += (
            f'<div style="padding:14px 0;border-bottom:1px solid #1e2235">'
            f'<p style="color:#9ca3af;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">'
            f'{item.get("publisher","")}</p>'
            f'<p style="color:#d1d5db;font-size:14px;font-weight:600;margin:0;line-height:1.4">'
            f'{item.get("title","")}</p>'
            f'</div>'
        )

    news_section = (
        f'<div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:20px;margin-bottom:20px">'
        f'<p style="color:#22c55e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">Noticias Destacadas</p>'
        f'{news_html}</div>'
    ) if news_html else ""

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Resumen Diario — Nuvos AI</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">

  <div style="text-align:center;margin-bottom:24px">
    <div style="display:inline-block;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:12px;padding:8px 20px;margin-bottom:16px">
      <span style="color:#22c55e;font-weight:800;font-size:12px;letter-spacing:2px;text-transform:uppercase">Nuvos AI · Resumen Diario</span>
    </div>
    <h1 style="color:#fff;font-size:24px;font-weight:900;margin:0 0 6px">Tu resumen del mercado</h1>
    <p style="color:#6b7280;font-size:14px;margin:0">Mercados cerrados · Actualización automática</p>
  </div>

  <div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">
    <div style="padding:14px 16px;border-bottom:1px solid #2a2d3a">
      <p style="color:#22c55e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">Índices Principales</p>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#0f1117">
        <th style="padding:8px 16px;color:#6b7280;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase">Índice</th>
        <th style="padding:8px 16px;color:#6b7280;font-size:11px;font-weight:600;text-align:right;text-transform:uppercase">Precio</th>
        <th style="padding:8px 16px;color:#6b7280;font-size:11px;font-weight:600;text-align:right;text-transform:uppercase">Cambio</th>
      </tr></thead>
      <tbody>{idx_rows}</tbody>
    </table>
  </div>

  <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
    <div style="flex:1;min-width:220px;background:#1a1d27;border:1px solid rgba(34,197,94,0.2);border-radius:14px;padding:18px">
      <p style="color:#22c55e;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px">Mejor Sector</p>
      <p style="color:#fff;font-size:20px;font-weight:800;margin:0">{best}</p>
      <p style="color:#22c55e;font-size:14px;font-weight:700;margin:4px 0 0">+{best_pct:.1f}%</p>
    </div>
    <div style="flex:1;min-width:220px;background:#1a1d27;border:1px solid rgba(239,68,68,0.2);border-radius:14px;padding:18px">
      <p style="color:#ef4444;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px">Peor Sector</p>
      <p style="color:#fff;font-size:20px;font-weight:800;margin:0">{worst}</p>
      <p style="color:#ef4444;font-size:14px;font-weight:700;margin:4px 0 0">{worst_pct:.1f}%</p>
    </div>
  </div>

  {news_section}

  <div style="border-top:1px solid #2a2d3a;padding-top:20px;text-align:center">
    <p style="color:#6b7280;font-size:12px;margin:0">
      <strong style="color:#9ca3af">Nuvos AI</strong> — Solo educativo. No constituye asesoramiento financiero.
    </p>
  </div>

</div>
</body>
</html>"""


def weekly_premium_email(user_name: str, portfolio_data: dict, ai_insights: str) -> str:
    perf       = portfolio_data.get("performance", {})
    ret_pct    = perf.get("total_return_pct", 0) or 0
    total_val  = perf.get("total_value", 0) or 0
    unrealized = perf.get("unrealized_gain", 0) or 0
    vs_sp500   = perf.get("vs_sp500", "")
    positions  = portfolio_data.get("top_positions", [])[:5]
    risks      = portfolio_data.get("risks", [])

    gain_color   = "#22c55e" if ret_pct >= 0 else "#ef4444"
    ret_sign     = "+" if ret_pct >= 0 else ""
    unreal_color = "#22c55e" if unrealized >= 0 else "#ef4444"

    def fmt_usd(v):
        try:
            v = float(v)
            if abs(v) >= 1_000_000: return f"${v/1_000_000:.1f}M"
            if abs(v) >= 1_000:     return f"${v/1_000:.1f}K"
            return f"${v:,.0f}"
        except Exception:
            return "—"

    pos_rows = ""
    for p in positions:
        g  = p.get("gain_pct", 0) or 0
        gc = "#22c55e" if g >= 0 else "#ef4444"
        gs = "+" if g >= 0 else ""
        pos_rows += (
            f'<tr style="border-bottom:1px solid #1e2235">'
            f'<td style="padding:10px 12px;color:#fff;font-weight:700;font-size:13px">{p.get("ticker","")}</td>'
            f'<td style="padding:10px 12px;color:#9ca3af;font-size:12px">{p.get("name","")[:22]}</td>'
            f'<td style="padding:10px 12px;color:#fff;font-size:13px;text-align:right">{fmt_usd(p.get("value",0))}</td>'
            f'<td style="padding:10px 12px;color:{gc};font-weight:700;font-size:13px;text-align:right">{gs}{g:.1f}%</td>'
            f'</tr>'
        )

    risks_html = "".join(
        f'<li style="color:#d1d5db;font-size:14px;margin-bottom:8px;line-height:1.5">{r}</li>'
        for r in risks[:3]
    )
    insights_paras = "".join(
        f'<p style="margin:0 0 12px;color:#d1d5db;font-size:15px;line-height:1.7">{p}</p>'
        for p in ai_insights.split("\n") if p.strip()
    )

    first = user_name.split()[0] if user_name else "Inversor"
    vs_line = f'<p style="color:#6b7280;font-size:13px;margin:0 0 16px">{vs_sp500}</p>' if vs_sp500 else '<div style="margin-bottom:16px"></div>'

    positions_section = f"""<div style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">
    <div style="padding:14px 16px;border-bottom:1px solid #2a2d3a">
      <p style="color:#22c55e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">Principales Posiciones</p>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#0f1117">
        <th style="padding:8px 12px;color:#6b7280;font-size:11px;text-align:left;text-transform:uppercase">Ticker</th>
        <th style="padding:8px 12px;color:#6b7280;font-size:11px;text-align:left;text-transform:uppercase">Empresa</th>
        <th style="padding:8px 12px;color:#6b7280;font-size:11px;text-align:right;text-transform:uppercase">Valor</th>
        <th style="padding:8px 12px;color:#6b7280;font-size:11px;text-align:right;text-transform:uppercase">Retorno</th>
      </tr></thead>
      <tbody>{pos_rows}</tbody>
    </table>
  </div>""" if pos_rows else ""

    risks_section = f"""<div style="background:#1a1d27;border:1px solid rgba(245,158,11,0.2);border-radius:16px;padding:20px;margin-bottom:20px">
    <p style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">Riesgos Detectados</p>
    <ul style="margin:0;padding-left:20px">{risks_html}</ul>
  </div>""" if risks_html else ""

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Resumen Semanal Premium — Nuvos AI</title>
</head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:620px;margin:0 auto;padding:32px 16px">

  <div style="text-align:center;margin-bottom:28px">
    <div style="display:inline-block;background:linear-gradient(135deg,rgba(34,197,94,0.12),rgba(59,130,246,0.08));border:1px solid rgba(34,197,94,0.3);border-radius:14px;padding:10px 24px;margin-bottom:16px">
      <span style="color:#22c55e;font-weight:800;font-size:12px;letter-spacing:2px;text-transform:uppercase">Nuvos AI · Premium Semanal</span>
    </div>
    <h1 style="color:#fff;font-size:26px;font-weight:900;margin:0 0 8px">Hola {first}, esta fue tu semana</h1>
    <p style="color:#6b7280;font-size:14px;margin:0">Análisis personalizado de tu portafolio</p>
  </div>

  <div style="background:linear-gradient(135deg,#1a1d27,#1e2235);border:1px solid #2a2d3a;border-radius:20px;padding:28px;margin-bottom:20px;text-align:center">
    <p style="color:#9ca3af;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px">Rendimiento semanal</p>
    <div style="font-size:46px;font-weight:900;color:{gain_color};margin:0 0 6px">{ret_sign}{ret_pct:.2f}%</div>
    {vs_line}
    <div style="display:flex;justify-content:center;gap:28px;flex-wrap:wrap">
      <div>
        <p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Valor total</p>
        <p style="color:#fff;font-size:18px;font-weight:800;margin:0">{fmt_usd(total_val)}</p>
      </div>
      <div>
        <p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Ganancia no realizada</p>
        <p style="color:{unreal_color};font-size:18px;font-weight:800;margin:0">{fmt_usd(unrealized)}</p>
      </div>
    </div>
  </div>

  <div style="background:#1a1d27;border:1px solid rgba(34,197,94,0.2);border-left:3px solid #22c55e;border-radius:0 16px 16px 0;padding:24px;margin-bottom:20px">
    <p style="color:#22c55e;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 14px">Análisis IA — Esta Semana</p>
    {insights_paras}
  </div>

  {positions_section}
  {risks_section}

  <div style="border-top:1px solid #2a2d3a;padding-top:24px;text-align:center">
    <p style="color:#6b7280;font-size:12px;margin:0 0 6px">
      <strong style="color:#9ca3af">Nuvos AI</strong> — Solo educativo. No constituye asesoramiento financiero profesional.
    </p>
  </div>

</div>
</body>
</html>"""
