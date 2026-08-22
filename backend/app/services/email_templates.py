"""
Email templates — dark theme, GBM-quality Market Wrap design.
Table-based layout for maximum email client compatibility.
"""

# Ordered list of indices shown in the Market Wrap table
_INDEX_ORDER = [
    "S&P 500",
    "NASDAQ",
    "Dow Jones",
    "México (IPC)",
    "Dólar (USD/MXN)",
    "Europa (STOXX 50)",
    "Japón (Nikkei)",
    "China (CSI 300)",
]

_SECTOR_ORDER = ["Tecnología", "Finanzas", "Salud", "Energía", "Consumo"]


def _format_level(label: str, price: float) -> str:
    """Format the price/level column depending on the index type."""
    if label == "Dólar (USD/MXN)":
        return f"{price:,.2f}"
    if price >= 10_000:
        return f"{price:,.0f}"
    if price >= 100:
        return f"{price:,.2f}"
    return f"{price:.4f}"


def _idx_rows_html(indices: dict) -> str:
    rows = ""
    for label in _INDEX_ORDER:
        d = indices.get(label)
        if not d:
            continue
        pct   = d.get("change_pct")
        price = d.get("price")
        if pct is None:
            continue
        up         = pct >= 0
        arrow      = "▲" if up else "▼"
        text_color = "#22c55e" if up else "#ef4444"
        badge_bg   = "rgba(34,197,94,0.15)" if up else "rgba(239,68,68,0.15)"
        sign       = "+" if up else ""
        level_str  = _format_level(label, price) if price is not None else "—"
        rows += f"""
        <tr style="border-bottom:1px solid #1e2235">
          <td style="padding:11px 16px;font-size:14px;white-space:nowrap">
            <span style="color:{text_color};font-weight:700;margin-right:6px">{arrow}</span>
            <span style="color:#d1d5db;font-weight:600">{label}</span>
          </td>
          <td style="padding:11px 16px;color:#9ca3af;font-size:14px;text-align:right;white-space:nowrap;font-weight:600">
            {level_str}
          </td>
          <td style="padding:11px 16px;text-align:right;white-space:nowrap">
            <span style="display:inline-block;background:{badge_bg};color:{text_color};font-weight:800;font-size:13px;padding:4px 12px;border-radius:20px">
              {sign}{pct:.1f}%
            </span>
          </td>
        </tr>"""
    return rows or '<tr><td colspan="3" style="padding:20px;text-align:center;color:#4b5563;font-size:13px">Datos no disponibles</td></tr>'


def _market_wrap_table(indices: dict) -> str:
    return f"""
  <div style="background:#161b27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">
    <div style="padding:12px 16px;border-bottom:1px solid #2a2d3a;background:#111318">
      <p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">Market Wrap</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr style="background:#0d1117">
        <th style="padding:8px 16px;color:#4b5563;font-size:10px;font-weight:700;text-align:left;text-transform:uppercase;letter-spacing:1px">ÍNDICE</th>
        <th style="padding:8px 16px;color:#4b5563;font-size:10px;font-weight:700;text-align:right;text-transform:uppercase;letter-spacing:1px">NIVEL</th>
        <th style="padding:8px 16px;color:#4b5563;font-size:10px;font-weight:700;text-align:right;text-transform:uppercase;letter-spacing:1px">CAMBIO</th>
      </tr>
      {_idx_rows_html(indices)}
    </table>
    <p style="margin:0;padding:10px 16px;color:#374151;font-size:11px;border-top:1px solid #1e2235">
      Actualizado a las 6:00&nbsp;pm&nbsp;ET&nbsp;·&nbsp;Datos al cierre de operaciones más reciente.
    </p>
  </div>"""


def _sectors_html(sectors: dict, best: str, worst: str) -> str:
    best_pct  = sectors.get(best,  0.0) if best  != "—" else 0.0
    worst_pct = sectors.get(worst, 0.0) if worst != "—" else 0.0
    if best == "—" and worst == "—":
        return ""
    b_sign = "+" if best_pct  >= 0 else ""
    w_sign = "+" if worst_pct >= 0 else ""
    return f"""
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
    <tr>
      <td style="width:49%;vertical-align:top;padding-right:6px">
        <div style="background:#161b27;border:1px solid rgba(34,197,94,0.2);border-radius:14px;padding:16px">
          <p style="color:#22c55e;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px">Mejor sector</p>
          <p style="color:#fff;font-size:17px;font-weight:800;margin:0 0 4px">{best}</p>
          <p style="color:#22c55e;font-size:13px;font-weight:700;margin:0">{b_sign}{best_pct:.1f}%</p>
        </div>
      </td>
      <td style="width:49%;vertical-align:top;padding-left:6px">
        <div style="background:#161b27;border:1px solid rgba(239,68,68,0.2);border-radius:14px;padding:16px">
          <p style="color:#ef4444;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px">Peor sector</p>
          <p style="color:#fff;font-size:17px;font-weight:800;margin:0 0 4px">{worst}</p>
          <p style="color:#ef4444;font-size:13px;font-weight:700;margin:0">{w_sign}{worst_pct:.1f}%</p>
        </div>
      </td>
    </tr>
  </table>"""


def _nuvos_header(subtitle: str = "Resumen Diario del Mercado") -> str:
    return f"""
  <div style="text-align:center;margin-bottom:28px">
    <img src="https://www.nuvosai.com/logo.png" alt="Nuvos AI" width="56" height="56"
         style="display:block;margin:0 auto 10px;border-radius:14px" />
    <div style="color:#fff;font-size:18px;font-weight:900;margin-bottom:14px;letter-spacing:-0.3px">Nuvos AI</div>
    <div style="display:inline-block;background:rgba(0,212,126,0.1);border:1px solid rgba(0,212,126,0.3);border-radius:20px;padding:6px 18px;margin-bottom:14px">
      <span style="color:#00d47e;font-weight:800;font-size:11px;letter-spacing:2px;text-transform:uppercase">{subtitle}</span>
    </div>
  </div>"""


def _email_wrapper(body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nuvos AI</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
{body}
  <!-- Footer -->
  <p style="text-align:center;color:#374151;font-size:11px;margin:24px 0 0">
    <strong style="color:#4b5563">Nuvos AI</strong>&nbsp;·&nbsp;Solo educativo. No constituye asesoramiento financiero.
  </p>
</div>
</body>
</html>"""


# ─── Free user daily email ────────────────────────────────────────────────────

def daily_summary_email(market_data: dict, news: list) -> str:
    """Free user daily email — GBM-style Market Wrap with all global indices."""
    indices = market_data.get("indices", {})
    sectors = market_data.get("sectors", {})
    best    = market_data.get("best_sector") or "—"
    worst   = market_data.get("worst_sector") or "—"

    news_html = ""
    for item in news[:3]:
        news_html += (
            f'<div style="padding:12px 0;border-bottom:1px solid #1e2235">'
            f'<p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">{item.get("publisher","")}</p>'
            f'<p style="color:#d1d5db;font-size:13px;font-weight:600;margin:0;line-height:1.5">{item.get("title","")}</p>'
            f'</div>'
        )
    news_section = (
        f'<div style="background:#161b27;border:1px solid #2a2d3a;border-radius:16px;padding:20px;margin-bottom:20px">'
        f'<p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">Noticias del día</p>'
        f'{news_html}</div>'
    ) if news_html else ""

    body = f"""
  {_nuvos_header()}
  <h1 style="color:#fff;font-size:24px;font-weight:900;margin:0 0 6px;text-align:center;letter-spacing:-0.5px">Market Wrap</h1>
  <p style="color:#6b7280;font-size:13px;margin:0 0 24px;text-align:center">Cierre del mercado · Actualización automática</p>

  {_market_wrap_table(indices)}
  {_sectors_html(sectors, best, worst)}
  {news_section}

  <div style="text-align:center;margin-bottom:8px">
    <a href="https://nuvosai.com" style="display:inline-block;background:#00d47e;color:#0d1117;font-weight:900;font-size:14px;padding:13px 32px;border-radius:14px;text-decoration:none">
      Ver mi portafolio en Nuvos AI →
    </a>
  </div>"""
    return _email_wrapper(body)


# ─── Premium user daily email ─────────────────────────────────────────────────

def personalized_daily_email(name: str, market_data: dict, news: list, portfolio_day: dict | None = None) -> str:
    """Premium daily email — portfolio vs indices comparison + full Market Wrap."""
    indices = market_data.get("indices", {})
    sectors = market_data.get("sectors", {})
    best    = market_data.get("best_sector") or "—"
    worst   = market_data.get("worst_sector") or "—"
    first   = name.split()[0] if name else "Inversor"

    # ── Portfolio hero (premium only) ─────────────────────────────────────────
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

        # Comparison line vs S&P 500 and NASDAQ
        sp_d  = indices.get("S&P 500", {})
        nq_d  = indices.get("NASDAQ",  {})
        sp_pct  = sp_d.get("change_pct")
        nq_pct  = nq_d.get("change_pct")

        comparison_line = ""
        if sp_pct is not None and nq_pct is not None:
            sp_color = "#22c55e" if sp_pct >= 0 else "#ef4444"
            nq_color = "#22c55e" if nq_pct >= 0 else "#ef4444"
            beat     = day_pct > sp_pct
            beat_label = (
                '<span style="background:rgba(34,197,94,0.15);color:#22c55e;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;margin-left:8px">🏆 Superaste al mercado</span>'
                if beat else ""
            )
            comparison_line = f"""
            <p style="color:#6b7280;font-size:12px;margin:10px 0 0;text-align:center">
              S&amp;P 500&nbsp;<span style="color:{sp_color};font-weight:700">{('+' if sp_pct >= 0 else '')}{sp_pct:.1f}%</span>
              &nbsp;·&nbsp;
              NASDAQ&nbsp;<span style="color:{nq_color};font-weight:700">{('+' if nq_pct >= 0 else '')}{nq_pct:.1f}%</span>
              {beat_label}
            </p>"""

        top_note = ""
        if top_t and top_p is not None:
            top_sign = "+" if top_p >= 0 else ""
            top_note = f'<p style="color:#9ca3af;font-size:12px;margin:6px 0 0;text-align:center">🏆 Mejor posición: <strong style="color:#d1d5db">{top_t}</strong> <span style="color:#22c55e">{top_sign}{top_p:.2f}%</span></p>'

        # Position rows — top 6 sorted by day %
        pos_rows = ""
        for p in sorted(portfolio_day["positions"], key=lambda x: x.get("day_pct", 0), reverse=True)[:6]:
            pct   = p.get("day_pct",     0) or 0
            usd   = p.get("day_dollars", 0) or 0
            val   = p.get("total_value", 0) or 0
            color = "#22c55e" if pct >= 0 else "#ef4444"
            sign  = "+" if pct >= 0 else ""
            pos_rows += (
                f'<tr style="border-top:1px solid #1e2235">'
                f'<td style="padding:9px 14px;color:#d1d5db;font-size:13px;font-weight:700">{p["ticker"]}</td>'
                f'<td style="padding:9px 14px;text-align:right;color:{color};font-weight:800;font-size:13px">{sign}{pct:.2f}%</td>'
                f'<td style="padding:9px 14px;text-align:right;color:{color};font-size:12px">{sign}${abs(usd):.2f}</td>'
                f'<td style="padding:9px 14px;text-align:right;color:#6b7280;font-size:12px">${val:,.2f}</td>'
                f'</tr>'
            )

        portfolio_section = f"""
  <div style="background:#161b27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">
    <div style="padding:12px 16px;border-bottom:1px solid #2a2d3a;background:#111318">
      <p style="color:#00d47e;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">💼 Tu portafolio hoy</p>
    </div>
    <div style="padding:24px 20px;border-bottom:1px solid #1e2235;text-align:center">
      <div style="font-size:42px;font-weight:900;color:{hero_color};letter-spacing:-1px">{hero_sign}{day_pct:.2f}%</div>
      <p style="color:{hero_color};font-size:14px;font-weight:700;margin:6px 0 0">{usd_sign}${abs(day_usd):,.2f} hoy&nbsp;·&nbsp;Total ${total:,.2f}</p>
      {comparison_line}
      {top_note}
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr style="background:#0d1117">
        <th style="padding:8px 14px;color:#4b5563;font-size:10px;font-weight:700;text-align:left;text-transform:uppercase;letter-spacing:1px">ACTIVO</th>
        <th style="padding:8px 14px;color:#4b5563;font-size:10px;font-weight:700;text-align:right;text-transform:uppercase;letter-spacing:1px">HOY %</th>
        <th style="padding:8px 14px;color:#4b5563;font-size:10px;font-weight:700;text-align:right;text-transform:uppercase;letter-spacing:1px">HOY $</th>
        <th style="padding:8px 14px;color:#4b5563;font-size:10px;font-weight:700;text-align:right;text-transform:uppercase;letter-spacing:1px">VALOR</th>
      </tr>
      {pos_rows}
    </table>
  </div>"""

    news_html = ""
    for item in news[:3]:
        news_html += (
            f'<div style="padding:12px 0;border-bottom:1px solid #1e2235">'
            f'<p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">{item.get("publisher","")}</p>'
            f'<p style="color:#d1d5db;font-size:13px;font-weight:600;margin:0;line-height:1.5">{item.get("title","")}</p>'
            f'</div>'
        )
    news_section = (
        f'<div style="background:#161b27;border:1px solid #2a2d3a;border-radius:16px;padding:20px;margin-bottom:20px">'
        f'<p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">Noticias del día</p>'
        f'{news_html}</div>'
    ) if news_html else ""

    body = f"""
  {_nuvos_header("Resumen Diario · Premium")}
  <h1 style="color:#fff;font-size:22px;font-weight:900;margin:0 0 4px;text-align:center;letter-spacing:-0.5px">Hola {first}, así cerró el mercado</h1>
  <p style="color:#6b7280;font-size:13px;margin:0 0 24px;text-align:center">Cierre del mercado · Actualización automática</p>

  {portfolio_section}
  {_market_wrap_table(indices)}
  {_sectors_html(sectors, best, worst)}
  {news_section}

  <div style="text-align:center;margin-bottom:8px">
    <a href="https://nuvosai.com/portfolio" style="display:inline-block;background:#00d47e;color:#0d1117;font-weight:900;font-size:14px;padding:13px 32px;border-radius:14px;text-decoration:none">
      Ver análisis completo →
    </a>
  </div>"""
    return _email_wrapper(body)


# ─── Daily email v2 ──────────────────────────────────────────────────────────

_DAILY_EMAIL_COPY = {
    "es": {
        "period_label_week": "de la semana", "period_label_day": "del día",
        "period_adverb_week": "esta semana", "period_adverb_day": "hoy",
        "next_period_week": "La próxima semana es otra oportunidad",
        "next_period_day": "Mañana es otra oportunidad",
        "na": "N/D", "dash": "—",
        "beat_market": "🏆 SUPERASTE AL MERCADO",
        "your_portfolio": "Tu Portafolio",
        "performance": "📊 Rendimiento {period_label}",
        "ai_summary": "🤖 Resumen IA {period_label}",
        "no_data": "Sin datos",
        "portfolio_moves": "📈 Movimientos de tu portafolio {period_adverb}",
        "top_gainers": "▲ Top subidas",
        "top_losers": "▼ Top caídas",
        "market_wrap": "🌐 Market Wrap — Qué pasó {period_adverb}",
        "earnings_header": "📣 Ganancias del día — Tu portafolio & watchlist",
        "revenue": "Ingresos",
        "estimate": "est.",
        "beat": "✅ Superó", "miss": "❌ No alcanzó",
        "pre_market": "Antes de apertura", "after_hours": "Después del cierre",
        "header_tagline": "Resumen Diario del Mercado",
        "greeting": "Hola {first_name}, así cerró el mercado",
        "subheading": "Cierre del mercado · Actualización automática",
        "cta": "Ver mi portafolio en Nuvos AI →",
    },
    "en": {
        "period_label_week": "this week", "period_label_day": "today",
        "period_adverb_week": "this week", "period_adverb_day": "today",
        "next_period_week": "Next week is another opportunity",
        "next_period_day": "Tomorrow is another day",
        "na": "N/A", "dash": "—",
        "beat_market": "🏆 YOU BEAT THE MARKET",
        "your_portfolio": "Your Portfolio",
        "performance": "📊 Performance {period_label}",
        "ai_summary": "🤖 AI Summary {period_label}",
        "no_data": "No data",
        "portfolio_moves": "📈 Your portfolio's moves {period_adverb}",
        "top_gainers": "▲ Top gainers",
        "top_losers": "▼ Top losers",
        "market_wrap": "🌐 Market Wrap — What happened {period_adverb}",
        "earnings_header": "📣 Today's Earnings — Your portfolio & watchlist",
        "revenue": "Revenue",
        "estimate": "est.",
        "beat": "✅ Beat", "miss": "❌ Miss",
        "pre_market": "Pre-market", "after_hours": "After-hours",
        "header_tagline": "Daily Market Summary",
        "greeting": "Hi {first_name}, here's how the market closed",
        "subheading": "Market close · Automatic update",
        "cta": "View my portfolio on Nuvos AI →",
    },
}


_DM_SANS_LINK = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,500;9..40,700;9..40,800;9..40,900&display=swap" rel="stylesheet">'
)
_DM_SANS_STACK = "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif"

# Unified colors — the old template used two different greens (#00d47e for
# brand/CTA, #22c55e for "up" figures); Diego's redesign (2026-08-21)
# consolidated to one green used for both, so "up" and "the brand" always
# read as the same color instead of two competing accents.
_UP_COLOR   = "#00d47e"
_DOWN_COLOR = "#ef4444"


def daily_email_v2(
    first_name: str,
    port_pct: float | None,
    port_usd: float | None,
    sp_pct: float | None,
    sp_px: float | None,
    nq_pct: float | None,
    nq_px: float | None,
    top_gainers: list[dict],
    top_losers: list[dict],
    ai_summary: str,
    market_wrap: str = "",
    earnings_items: list = [],
    period: str = "día",
    language: str = "es",
) -> str:
    """Shared template for both the real daily market-close email/push AND the
    Friday weekly summary (worker.py's job_daily_email passes period="semana"
    with genuinely week-over-week pct/px values — everything else here is
    generic enough to serve either cadence unchanged) — 4-section structure:
    1. Tu portafolio (hero figure) vs S&P 500 / Nasdaq (compact strip)
    2. Top 3 subidas / Top 3 caídas del portafolio — logo + name + ticker
    3. Market Wrap (AI narrative)
    4. Earnings (portfolio + watchlist, if any)

    Redesigned 2026-08-21 (Diego, from a real screenshot of the old layout):
    the portfolio figure used to share equal visual weight with S&P/Nasdaq in
    a 3-column table — now it's the hero, S&P/Nasdaq drop to a compact
    comparison strip beneath it. Movers show `company_name`/`logo_url` when
    a caller provides them (falls back to a ticker-initial badge otherwise,
    so callers that don't fetch that data — e.g. the market-close push's
    on-demand email trigger — still render correctly, just without the logo).

    `language` picks the ES/EN copy dict (_DAILY_EMAIL_COPY) — callers should
    pass the user's own preferred_language so this always lands in whichever
    language they've configured, not just Spanish.
    """
    is_weekly = period == "semana"
    t = _DAILY_EMAIL_COPY.get(language, _DAILY_EMAIL_COPY["es"])
    period_label  = t["period_label_week"] if is_weekly else t["period_label_day"]
    period_adverb = t["period_adverb_week"] if is_weekly else t["period_adverb_day"]
    next_period   = t["next_period_week"] if is_weekly else t["next_period_day"]
    na            = t["na"]

    def _px_str(px):
        if px is None:
            return "—"
        if px >= 1000:
            return f"{px:,.0f}"
        return f"{px:,.2f}"

    # ── Header ─────────────────────────────────────────────────────────────
    header = f"""
  <div style="text-align:center;padding:36px 0 28px">
    <img src="https://www.nuvosai.com/logo.png" alt="Nuvos AI" width="40" height="40"
         style="display:block;margin:0 auto 12px;border-radius:10px" />
    <div style="color:#5b6478;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase">{t["header_tagline"]}</div>
  </div>
  <div style="text-align:center;padding-bottom:30px">
    <div style="color:#f3f5f7;font-size:20px;font-weight:800;letter-spacing:-0.01em;margin-bottom:6px">{t["greeting"].format(first_name=first_name)}</div>
    <div style="color:#5b6478;font-size:12.5px">{t["subheading"]}</div>
  </div>"""

    # ── Hero: portfolio figure ────────────────────────────────────────────────
    hero = ""
    if port_pct is not None:
        up    = port_pct >= 0
        color = _UP_COLOR if up else _DOWN_COLOR
        sign  = "+" if up else ""
        usd_line = ""
        if port_usd is not None:
            usd_sign = "+" if port_usd >= 0 else "-"
            usd_line = (
                f'<div style="color:{color};font-size:15px;font-weight:700;margin-top:6px;'
                f'font-variant-numeric:tabular-nums">{usd_sign}${abs(port_usd):,.2f} {period_adverb}</div>'
            )
        hero = f"""
  <div style="text-align:center;padding-bottom:22px">
    <div style="color:#8b93a7;font-size:10.5px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:10px">{t["your_portfolio"]} {period_label}</div>
    <div style="font-size:52px;font-weight:900;color:{color};letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">{sign}{port_pct:.2f}%</div>
    {usd_line}
  </div>"""
    elif not is_weekly:
        hero = f"""
  <div style="background:rgba(0,212,126,0.07);border:1px solid rgba(0,212,126,0.2);border-radius:12px;padding:14px 18px;margin-bottom:4px;text-align:center">
    <p style="color:{_UP_COLOR};font-size:12.5px;margin:0;font-weight:600">🔒 Activa Premium para ver el rendimiento real de tu portafolio</p>
  </div>"""

    # ── Compact S&P / Nasdaq comparison strip ─────────────────────────────────
    def _strip_cell(label, pct, px_val, border_right):
        up    = pct is not None and pct >= 0
        color = _UP_COLOR if up else _DOWN_COLOR
        sign  = "+" if up else ""
        pct_s = f"{sign}{pct:.2f}%" if pct is not None else na
        border = "border-right:1px solid #212736;" if border_right else ""
        return f"""
        <td style="padding:14px 18px;width:50%;{border}">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="color:#8b93a7;font-size:12px;font-weight:700">{label}</td>
            <td align="right" style="color:{color};font-size:14px;font-weight:800;font-variant-numeric:tabular-nums">{pct_s}</td>
          </tr></table>
          <div style="color:#4d5568;font-size:11px;margin-top:2px;font-variant-numeric:tabular-nums">{_px_str(px_val)}</div>
        </td>"""

    beating = port_pct is not None and sp_pct is not None and port_pct > sp_pct
    note = ""
    if port_pct is not None:
        note = f'<span style="color:{_UP_COLOR};font-size:12px;font-weight:700">{t["beat_market"]}</span>' if beating \
            else f'<span style="color:#5b6478;font-size:12px">{next_period}</span>'

    vs_strip = f"""
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#131824;border:1px solid #212736;border-radius:14px;margin-bottom:14px">
    <tr>{_strip_cell("S&amp;P 500", sp_pct, sp_px, True)}{_strip_cell("Nasdaq", nq_pct, nq_px, False)}</tr>
  </table>
  <div style="text-align:center;padding-bottom:30px">{note}</div>"""

    # ── AI Summary ─────────────────────────────────────────────────────────────
    ai_section = ""
    if ai_summary:
        paras = "".join(
            f'<p style="margin:0 0 10px;color:#d1d5db;font-size:14px;line-height:1.7">{p}</p>'
            for p in ai_summary.split("\n") if p.strip()
        )
        ai_section = f"""
  <div style="background:#161b27;border-left:3px solid {_UP_COLOR};border-radius:0 16px 16px 0;padding:20px 20px 10px;margin-bottom:20px">
    <p style="color:{_UP_COLOR};font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">{t["ai_summary"].format(period_label=period_label)}</p>
    {paras}
  </div>"""

    # ── Movers: logo + company name + ticker, stacked lists ──────────────────
    def _mover_rows(items):
        if not items:
            return f'<div style="padding:14px 0;text-align:center;color:#4b5563;font-size:12px">{t["no_data"]}</div>'
        rows = ""
        for i, item in enumerate(items):
            ticker  = item["ticker"]
            name    = item.get("company_name") or ticker
            logo    = item.get("logo_url")
            pct     = item.get("pct") or item.get("day_pct") or 0
            dollar  = item.get("dollar_change")
            up      = pct >= 0
            color   = _UP_COLOR if up else _DOWN_COLOR
            sign    = "+" if up else ""
            dollar_str = f'<span style="color:#5b6478;font-size:11px;font-variant-numeric:tabular-nums">{sign}${abs(dollar):,.2f}</span>' if dollar is not None else ""
            border  = "border-top:1px solid #1a1f2c" if i > 0 else ""
            badge   = (
                f'<img src="{logo}" width="30" height="30" alt="{ticker}" '
                f'style="display:block;border-radius:50%;border:1px solid #2a3348" />'
                if logo else
                f'<div style="width:30px;height:30px;border-radius:50%;background:#131824;border:1px solid #2a3348;text-align:center">'
                f'<span style="font-size:12px;font-weight:800;color:#e8ebf0;line-height:29px">{ticker[0]}</span></div>'
            )
            rows += f"""
      <table width="100%" cellpadding="0" cellspacing="0" style="{border};padding-top:11px;padding-bottom:11px"><tr>
        <td style="width:34px">{badge}</td>
        <td style="padding-left:10px">
          <div style="color:#e8ebf0;font-size:13px;font-weight:700;line-height:1.3">{name}</div>
          <div style="color:#5b6478;font-size:11px;font-weight:600">{ticker}</div>
        </td>
        <td align="right" style="padding-right:10px">{dollar_str}</td>
        <td align="right" style="color:{color};font-size:13px;font-weight:800;width:62px;font-variant-numeric:tabular-nums">{sign}{pct:.2f}%</td>
      </tr></table>"""
        return rows

    movers_section = ""
    if top_gainers or top_losers:
        movers_section = f"""
  <div style="color:#8b93a7;font-size:10.5px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;border-bottom:1px solid #212736;padding-bottom:10px;margin-bottom:6px">{t["portfolio_moves"].format(period_adverb=period_adverb)}</div>
  <div style="color:{_UP_COLOR};font-size:10.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;margin:14px 0 4px">{t["top_gainers"]}</div>
  {_mover_rows(top_gainers)}
  <div style="color:{_DOWN_COLOR};font-size:10.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;margin:18px 0 4px">{t["top_losers"]}</div>
  {_mover_rows(top_losers)}
  <div style="padding-bottom:14px"></div>"""

    # ── Section 3: Market Wrap ─────────────────────────────────────────────────
    wrap_section = ""
    if market_wrap:
        paras = "".join(
            f'<p style="margin:0 0 10px;color:#d1d5db;font-size:14px;line-height:1.7">{p}</p>'
            for p in market_wrap.split("\n") if p.strip()
        )
        wrap_section = f"""
  <div style="background:#161b27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">
    <div style="padding:12px 16px;border-bottom:1px solid #2a2d3a;background:#111318">
      <p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">{t["market_wrap"].format(period_adverb=period_adverb)}</p>
    </div>
    <div style="padding:18px 20px">
      {paras}
    </div>
  </div>"""

    # ── Section 4: Earnings del día ────────────────────────────────────────────
    earnings_section = ""
    if earnings_items:
        cards = ""
        for e in earnings_items:
            ticker_sym = e.get("ticker", "")
            name      = e.get("company_name", ticker_sym)
            eps_a     = e.get("eps_actual")
            eps_e     = e.get("eps_estimate")
            rev_a     = e.get("rev_actual_b")
            rev_e     = e.get("rev_estimate_b")
            beat_eps  = e.get("beat_eps", False)
            beat_rev  = e.get("beat_rev", False)
            analysis  = e.get("ai_analysis", "")
            hour      = e.get("hour", "")
            timing    = t["pre_market"] if hour == "BMO" else (t["after_hours"] if hour == "AMC" else "")

            eps_color  = _UP_COLOR if beat_eps else _DOWN_COLOR
            eps_badge  = t["beat"] if beat_eps else t["miss"]
            eps_beat_pct = round((eps_a - eps_e) / abs(eps_e) * 100, 1) if eps_a is not None and eps_e and eps_e != 0 else None

            rev_row = ""
            if rev_a is not None and rev_e is not None:
                rev_color = _UP_COLOR if beat_rev else _DOWN_COLOR
                rev_diff  = round((rev_a - rev_e) / abs(rev_e) * 100, 1) if rev_e != 0 else 0
                rev_sign  = "+" if rev_diff >= 0 else ""
                rev_row = f"""
                <tr style="border-top:1px solid #1e2235">
                  <td style="padding:8px 14px;color:#9ca3af;font-size:12px">{t["revenue"]}</td>
                  <td style="padding:8px 14px;text-align:right;color:#d1d5db;font-size:12px">${rev_a:.2f}B <span style="color:#4b5563">vs ${rev_e:.2f}B</span></td>
                  <td style="padding:8px 14px;text-align:right;color:{rev_color};font-size:12px;font-weight:700">{rev_sign}{rev_diff:.1f}%</td>
                </tr>"""

            beat_pct_str = f" (+{eps_beat_pct:.1f}%)" if beat_eps and eps_beat_pct else (f" ({eps_beat_pct:.1f}%)" if eps_beat_pct else "")
            analysis_html = f'<div style="background:#0d1f17;border-left:2px solid {_UP_COLOR};padding:10px 14px;margin-top:10px"><p style="margin:0;color:#d1fae5;font-size:12px;line-height:1.6">{analysis}</p></div>' if analysis else ""

            cards += f"""
            <div style="border-bottom:1px solid #1e2235;padding:16px 20px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
                <div>
                  <span style="font-size:16px;font-weight:900;color:#fff">{ticker_sym}</span>
                  <span style="font-size:12px;color:#6b7280;margin-left:8px">{name}</span>
                </div>
                <div>
                  <span style="background:{eps_color}22;color:{eps_color};font-size:11px;font-weight:800;padding:3px 10px;border-radius:12px">{eps_badge}{beat_pct_str}</span>
                  {'<span style="color:#4b5563;font-size:11px;margin-left:8px">' + timing + '</span>' if timing else ''}
                </div>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                <tr>
                  <td style="padding:8px 14px;color:#9ca3af;font-size:12px">EPS</td>
                  <td style="padding:8px 14px;text-align:right;font-size:14px;font-weight:800;color:{eps_color}">${eps_a:.2f}</td>
                  <td style="padding:8px 14px;text-align:right;color:#4b5563;font-size:12px">{t["estimate"]} ${eps_e:.2f}</td>
                </tr>
                {rev_row}
              </table>
              {analysis_html}
            </div>"""

        earnings_section = f"""
  <div style="background:#161b27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">
    <div style="padding:12px 16px;border-bottom:1px solid #2a2d3a;background:#111318">
      <p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">{t["earnings_header"]}</p>
    </div>
    {cards}
  </div>"""

    body = f"""
  {header}
  {hero}
  {vs_strip}
  {movers_section}
  {ai_section}
  {wrap_section}
  {earnings_section}

  <div style="text-align:center;margin:8px 0 32px">
    <a href="https://nuvosai.com/portfolio" style="display:inline-block;background:{_UP_COLOR};color:#06110c;font-weight:800;font-size:14px;padding:14px 34px;border-radius:12px;text-decoration:none">
      {t["cta"]}
    </a>
  </div>"""

    return f"""<!DOCTYPE html>
<html lang="{language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nuvos AI</title>
  {_DM_SANS_LINK}
</head>
<body style="margin:0;padding:0;background:#0a0d13;font-family:{_DM_SANS_STACK}">
<div style="max-width:580px;margin:0 auto;padding:0 16px 28px">
{body}
  <p style="text-align:center;color:#3c4152;font-size:10.5px;margin:8px 0 0">
    <strong style="color:#4d5568">Nuvos AI</strong>&nbsp;·&nbsp;Solo educativo. No constituye asesoramiento financiero.
  </p>
</div>
</body>
</html>"""


# ─── Weekly premium email ─────────────────────────────────────────────────────

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
    vs_line = f'<p style="color:#6b7280;font-size:13px;margin:0 0 16px;text-align:center">{vs_sp500}</p>' if vs_sp500 else '<div style="margin-bottom:16px"></div>'

    positions_section = f"""
  <div style="background:#161b27;border:1px solid #2a2d3a;border-radius:16px;overflow:hidden;margin-bottom:20px">
    <div style="padding:12px 16px;border-bottom:1px solid #2a2d3a;background:#111318">
      <p style="color:#9ca3af;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0">Principales Posiciones</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr style="background:#0d1117">
        <th style="padding:8px 12px;color:#4b5563;font-size:10px;font-weight:700;text-align:left;text-transform:uppercase;letter-spacing:1px">Ticker</th>
        <th style="padding:8px 12px;color:#4b5563;font-size:10px;font-weight:700;text-align:left;text-transform:uppercase;letter-spacing:1px">Empresa</th>
        <th style="padding:8px 12px;color:#4b5563;font-size:10px;font-weight:700;text-align:right;text-transform:uppercase;letter-spacing:1px">Valor</th>
        <th style="padding:8px 12px;color:#4b5563;font-size:10px;font-weight:700;text-align:right;text-transform:uppercase;letter-spacing:1px">Retorno</th>
      </tr>
      {pos_rows}
    </table>
  </div>""" if pos_rows else ""

    risks_section = f"""
  <div style="background:#161b27;border:1px solid rgba(245,158,11,0.2);border-radius:16px;padding:20px;margin-bottom:20px">
    <p style="color:#f59e0b;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 12px">Riesgos Detectados</p>
    <ul style="margin:0;padding-left:20px">{risks_html}</ul>
  </div>""" if risks_html else ""

    body = f"""
  {_nuvos_header("Premium Semanal")}
  <h1 style="color:#fff;font-size:24px;font-weight:900;margin:0 0 6px;text-align:center;letter-spacing:-0.5px">Hola {first}, esta fue tu semana</h1>
  <p style="color:#6b7280;font-size:13px;margin:0 0 24px;text-align:center">Análisis personalizado de tu portafolio</p>

  <div style="background:#161b27;border:1px solid #2a2d3a;border-radius:20px;padding:28px;margin-bottom:20px;text-align:center">
    <p style="color:#9ca3af;font-size:11px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px">Rendimiento semanal</p>
    <div style="font-size:48px;font-weight:900;color:{gain_color};margin:0 0 6px;letter-spacing:-1px">{ret_sign}{ret_pct:.2f}%</div>
    {vs_line}
    <table cellpadding="0" cellspacing="0" style="margin:0 auto">
      <tr>
        <td style="padding:0 20px;text-align:center;border-right:1px solid #2a2d3a">
          <p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Valor total</p>
          <p style="color:#fff;font-size:18px;font-weight:800;margin:0">{fmt_usd(total_val)}</p>
        </td>
        <td style="padding:0 20px;text-align:center">
          <p style="color:#6b7280;font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px">Ganancia no realizada</p>
          <p style="color:{unreal_color};font-size:18px;font-weight:800;margin:0">{fmt_usd(unrealized)}</p>
        </td>
      </tr>
    </table>
  </div>

  <div style="background:#161b27;border-left:3px solid #00d47e;border-radius:0 16px 16px 0;padding:24px;margin-bottom:20px">
    <p style="color:#00d47e;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 14px">Análisis IA — Esta Semana</p>
    {insights_paras}
  </div>

  {positions_section}
  {risks_section}

  <div style="text-align:center;margin-bottom:8px">
    <a href="https://nuvosai.com/portfolio" style="display:inline-block;background:#00d47e;color:#0d1117;font-weight:900;font-size:14px;padding:13px 32px;border-radius:14px;text-decoration:none">
      Ver análisis completo →
    </a>
  </div>"""
    return _email_wrapper(body)
