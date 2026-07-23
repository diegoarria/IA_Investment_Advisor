import asyncio
import io
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from fpdf import FPDF

from app.api.deps import get_current_user
from app.api.routes.report import _compute_performance
from app.core.database import get_supabase, run_query
from app.core.limiter import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/annual-report", tags=["annual-report"])

_LOGO_PATH = Path(__file__).parent.parent.parent / "static" / "logo.png"

# ─── Helpers ─────────────────────────────────────────────────────────────────

_ACCENT_MAP = str.maketrans(
    "áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜñÑ¿¡",
    "aeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUnN??",
)


def _clean(text: str) -> str:
    """Strip accented/special chars not supported by FPDF built-in fonts."""
    if not text:
        return ""
    return str(text).translate(_ACCENT_MAP)


def _score_label(score: float, lang: str = "es") -> str:
    if lang == "en":
        if score < 25:
            return "Beginner"
        if score < 50:
            return "Intermediate"
        if score < 75:
            return "Advanced"
        return "Expert"
    if score < 25:
        return "Principiante"
    if score < 50:
        return "Intermedio"
    if score < 75:
        return "Avanzado"
    return "Experto"


def _pdf_labels(lang: str) -> dict:
    """All static PDF strings, in one place — the whole 7-page report used
    to be hardcoded Spanish regardless of the user's language setting."""
    if lang == "en":
        return {
            "footer_brand": "Nuvos AI - Annual Investor Maturity Report",
            "page_prefix": "Page",
            "cover_title_1": "ANNUAL INVESTOR",
            "cover_title_2": "MATURITY REPORT",
            "year_label": "Year {year}",
            "confidential_line": "Nuvos AI  |  {date}  |  Confidential",
            "exec_summary_header": "EXECUTIVE SUMMARY",
            "score_suffix": "of 100  -  {label}",
            "stat_streak_value": "{n} days",
            "stat_streak_label": "Active streak",
            "stat_goal_label": "Investment goal",
            "stat_goal_default": "No goal",
            "stat_risk_label": "Risk profile",
            "stat_risk_default": "N/A",
            "summary_of_year": "Summary of the year",
            "evolution_header": "SCORE EVOLUTION",
            "current_label": "Current",
            "interpretation_header": "Interpretation",
            "interp_intro": "Your current score of {score}/100 reflects your investor maturity level as of the end of {year}. ",
            "interp_streak": "You kept an active streak of {n} consecutive days, showing solid commitment to your financial education.",
            "interp_no_streak": "Keep building consistent habits to improve your score next year.",
            "behavior_header": "BEHAVIORAL ANALYSIS",
            "risk_score_label": "Behavioral Risk Score / 100",
            "portfolio_header": "PORTFOLIO SUMMARY",
            "no_positions": "No positions recorded this year",
            "table_headers": ["Asset", "Value (USD)", "Return %"],
            "total_invested_label": "Total invested:",
            "total_value_label": "Current value:",
            "total_return_label": "Total return:",
            "recommendations_header": "RECOMMENDATIONS FOR {year}",
            "certificate_header": "DIGITAL CERTIFICATE",
            "certificate_title": "Informed Investor",
            "cert_text": "This certificate recognizes that {name} completed a full year of actively tracking their investor maturity with Nuvos AI.",
            "issued_on": "Issued on {date}",
            "founder_title": "Founder, Nuvos AI",
            "tagline": "Smart investing education platform",
            "goal_default": "Wealth growth",
            "risk_tolerance_default": "Moderate",
            "investor_default": "Investor",
        }
    return {
        "footer_brand": "Nuvos AI - Reporte Anual de Madurez Inversora",
        "page_prefix": "Pag.",
        "cover_title_1": "REPORTE ANUAL DE MADUREZ",
        "cover_title_2": "INVERSORA",
        "year_label": "Ano {year}",
        "confidential_line": "Nuvos AI  |  {date}  |  Confidencial",
        "exec_summary_header": "RESUMEN EJECUTIVO",
        "score_suffix": "de 100  -  {label}",
        "stat_streak_value": "{n} dias",
        "stat_streak_label": "Racha activa",
        "stat_goal_label": "Meta de inversion",
        "stat_goal_default": "Sin meta",
        "stat_risk_label": "Perfil de riesgo",
        "stat_risk_default": "N/D",
        "summary_of_year": "Resumen del ano",
        "evolution_header": "EVOLUCION DE PUNTUACION",
        "current_label": "Actual",
        "interpretation_header": "Interpretacion",
        "interp_intro": "Tu puntuacion actual de {score}/100 refleja tu nivel de madurez inversora al cierre del ano {year}. ",
        "interp_streak": "Mantuviste una racha activa de {n} dias consecutivos, lo cual demuestra un compromiso solido con tu educacion financiera.",
        "interp_no_streak": "Sigue construyendo habitos constantes para mejorar tu puntuacion el proximo ano.",
        "behavior_header": "ANALISIS DE COMPORTAMIENTO",
        "risk_score_label": "Puntuacion de Riesgo Conductual / 100",
        "portfolio_header": "RESUMEN DE PORTAFOLIO",
        "no_positions": "Sin posiciones registradas este ano",
        "table_headers": ["Activo", "Valor (USD)", "Rendimiento %"],
        "total_invested_label": "Total invertido:",
        "total_value_label": "Valor actual:",
        "total_return_label": "Rendimiento total:",
        "recommendations_header": "RECOMENDACIONES PARA {year}",
        "certificate_header": "CERTIFICADO DIGITAL",
        "certificate_title": "Inversor Informado",
        "cert_text": "Este certificado acredita que {name} completo un ano de seguimiento activo de su madurez inversora con Nuvos AI.",
        "issued_on": "Emitido el {date}",
        "founder_title": "Fundador, Nuvos AI",
        "tagline": "Plataforma educativa de inversion inteligente",
        "goal_default": "Crecimiento patrimonial",
        "risk_tolerance_default": "Moderado",
        "investor_default": "Inversor",
    }


# ─── Claude content generation ───────────────────────────────────────────────

async def _generate_narrative(
    maturity_score: float,
    maturity_history: list,
    behavioral_risk_score: float,
    investment_goal: str,
    investment_goal_amount: float,
    risk_tolerance: str,
    streak_count: int,
    lang: str = "es",
) -> dict:
    """Call Claude to generate narrative sections (3 short JSON text fields — no
    extended reasoning needed, so this deliberately skips thinking and Opus)."""

    history_summary = ", ".join(
        f"{m.get('month', i + 1)}: {m.get('score', 0)}"
        for i, m in enumerate(maturity_history[-12:])
    ) if maturity_history else f"score actual: {maturity_score}"

    if lang == "en":
        prompt = (
            f"IMPORTANT: Write every text field below entirely in English.\n\n"
            f"Generate 3 sections for an annual investor-maturity report "
            f"for a user with these stats:\n"
            f"- Maturity score: {maturity_score}/100 (history: {history_summary})\n"
            f"- Behavioral risk score: {behavioral_risk_score}/100\n"
            f"- Investment goal: {investment_goal}, Amount: ${investment_goal_amount}\n"
            f"- Risk profile: {risk_tolerance}\n"
            f"- Active-day streak: {streak_count}\n\n"
            f"Reply ONLY with a valid JSON object (no markdown, no code blocks) "
            f"with these keys:\n"
            f"- \"executive_summary\": 2-3 sentence executive summary, plain text\n"
            f"- \"behavioral_analysis\": 2-3 paragraphs analyzing the user's behavioral patterns "
            f"and 3-4 specific biases they likely have given their score "
            f"(plain text, no markdown)\n"
            f"- \"recommendations\": exactly 5 bullet points for next year, each starting "
            f"with a relevant emoji, separated by newlines "
            f"(format: \"emoji Point text...\")\n"
            f"Don't include extra quotes, code blocks, or text outside the JSON."
        )
    else:
        prompt = (
            f"Genera 3 secciones para un reporte anual de madurez inversora en espanol "
            f"para un usuario con estas estadisticas:\n"
            f"- Puntuacion de madurez: {maturity_score}/100 (historial: {history_summary})\n"
            f"- Puntuacion de riesgo conductual: {behavioral_risk_score}/100\n"
            f"- Meta de inversion: {investment_goal}, Monto: ${investment_goal_amount}\n"
            f"- Perfil de riesgo: {risk_tolerance}\n"
            f"- Racha de dias activos: {streak_count}\n\n"
            f"Responde UNICAMENTE con un objeto JSON valido (sin markdown, sin bloques de codigo) "
            f"con estas claves:\n"
            f"- \"executive_summary\": resumen ejecutivo de 2-3 oraciones en texto plano\n"
            f"- \"behavioral_analysis\": 2-3 parrafos analizando patrones conductuales del usuario "
            f"y 3-4 sesgos especificos que probablemente tenga segun su puntuacion "
            f"(texto plano, sin markdown)\n"
            f"- \"recommendations\": exactamente 5 puntos para el proximo ano, cada uno comenzando "
            f"con un emoji relevante, separados por saltos de linea "
            f"(formato: \"emoji Texto del punto...\")\n"
            f"No incluyas comillas extra, bloques de codigo ni texto fuera del JSON."
        )

    client = anthropic.AsyncAnthropic()
    response = await asyncio.wait_for(
        client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        ),
        timeout=45,
    )

    raw = ""
    for block in response.content:
        if block.type == "text":
            raw = block.text
            break

    # Try to parse JSON; fall back to defaults on failure
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:])
        if cleaned.endswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[:-1])
        cleaned = cleaned.strip()
        return json.loads(cleaned)
    except Exception:
        logger.warning("Could not parse Claude JSON response, using defaults")
        return _default_narrative(maturity_score, lang)


def _default_narrative(maturity_score: float, lang: str = "es") -> dict:
    if lang == "en":
        return {
            "executive_summary": (
                f"This year, you reached an investor maturity score of {int(maturity_score)}/100, "
                f"showing sustained progress in your financial education. "
                f"Your commitment to continuous learning is the foundation of your growth as an investor."
            ),
            "behavioral_analysis": (
                "The behavioral analysis reveals patterns typical of a developing investor. "
                "Biases identified include confirmation bias, where you seek information that "
                "confirms prior beliefs. Loss aversion also shows up, which can lead to holding "
                "losing positions too long. Overconfidence during bull periods and herd behavior — "
                "following trends without your own analysis — are key areas to improve."
            ),
            "recommendations": (
                "📈 Diversify your portfolio across at least 3 different sectors\n"
                "📚 Spend 20 minutes a day on structured financial education\n"
                "🎯 Set SMART investment goals and review them quarterly\n"
                "⚖️ Rebalance your portfolio every quarter to maintain your target allocation\n"
                "🧠 Document your investment decisions and analyze your wins and mistakes"
            ),
        }
    return {
        "executive_summary": (
            f"Este ano, lograste una puntuacion de madurez inversora de {int(maturity_score)}/100, "
            f"demostrando progreso sostenido en tu educacion financiera. "
            f"Tu compromiso con el aprendizaje continuo es la base de tu crecimiento como inversor."
        ),
        "behavioral_analysis": (
            "El analisis conductual revela patrones tipicos de un inversor en desarrollo. "
            "Se identifican sesgos como el sesgo de confirmacion, donde se busca informacion que "
            "confirme creencias previas. Tambien se observa aversion a las perdidas, que puede llevar "
            "a mantener posiciones perdedoras demasiado tiempo. El exceso de confianza en periodos "
            "alcistas y el efecto manada al seguir tendencias sin analisis propio son areas de mejora clave."
        ),
        "recommendations": (
            "📈 Diversifica tu portafolio en al menos 3 sectores distintos\n"
            "📚 Dedica 20 minutos diarios a educacion financiera estructurada\n"
            "🎯 Establece metas de inversion SMART y revisalas trimestralmente\n"
            "⚖️ Rebalancea tu portafolio cada trimestre para mantener tu asignacion objetivo\n"
            "🧠 Documenta tus decisiones de inversion y analiza tus aciertos y errores"
        ),
    }


# ─── PDF builder ─────────────────────────────────────────────────────────────

def _page_footer(pdf: FPDF, W: int, H: int, mid_gray: tuple, page_num: int, L: dict) -> None:
    pdf.set_draw_color(*mid_gray)
    pdf.line(20, H - 14, W - 20, H - 14)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(*mid_gray)
    pdf.set_xy(20, H - 12)
    pdf.cell(85, 5, L["footer_brand"], align="L")
    pdf.set_xy(W - 30, H - 12)
    pdf.cell(10, 5, _clean(f"{L['page_prefix']} {page_num}"), align="R")


def _build_pdf(
    first_name: str,
    year: int,
    maturity_score: float,
    maturity_history: list,
    behavioral_risk_score: float,
    investment_goal: str,
    streak_count: int,
    risk_tolerance: str,
    portfolio_perf: dict,
    narrative: dict,
    lang: str = "es",
) -> bytes:
    """Build the 7-page PDF and return raw bytes."""

    L = _pdf_labels(lang)
    pdf = FPDF()
    pdf.set_auto_page_break(auto=False)

    W, H = 210, 297  # A4 mm
    GREEN      = (0, 212, 126)
    DARK       = (13, 17, 23)
    WHITE      = (255, 255, 255)
    LIGHT_GRAY = (245, 247, 250)
    MID_GRAY   = (156, 163, 175)
    DARK_TEXT  = (31, 41, 55)

    # ── Page 1: Cover ────────────────────────────────────────────────────────
    pdf.add_page()

    # Dark background
    pdf.set_fill_color(*DARK)
    pdf.rect(0, 0, W, H, "F")

    # Top green bar
    pdf.set_fill_color(*GREEN)
    pdf.rect(0, 0, W, 4, "F")

    # Bottom green bar
    pdf.rect(0, H - 4, W, 4, "F")

    # Logo
    if _LOGO_PATH.exists():
        pdf.image(str(_LOGO_PATH), x=85, y=35, w=40)

    # Company name below logo
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(0, 85)
    pdf.cell(W, 8, "NUVOS AI", align="C")

    # Main title
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(0, 105)
    pdf.cell(W, 12, L["cover_title_1"], align="C")
    pdf.set_xy(0, 118)
    pdf.cell(W, 12, L["cover_title_2"], align="C")

    # Decorative line
    pdf.set_fill_color(*GREEN)
    pdf.rect(70, 135, 70, 1, "F")

    # User name
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(0, 143)
    pdf.cell(W, 10, _clean(first_name), align="C")

    # Year
    pdf.set_font("Helvetica", "", 14)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(0, 156)
    pdf.cell(W, 8, _clean(L["year_label"].format(year=year)), align="C")

    # Bottom text
    date_str = datetime.now(timezone.utc).strftime("%d/%m/%Y")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*MID_GRAY)
    pdf.set_xy(0, H - 18)
    pdf.cell(W, 6, _clean(L["confidential_line"].format(date=date_str)), align="C")

    # ── Page 2: Resumen Ejecutivo ─────────────────────────────────────────────
    pdf.add_page()
    pdf.set_fill_color(*WHITE)
    pdf.rect(0, 0, W, H, "F")

    # Header bar
    pdf.set_fill_color(*GREEN)
    pdf.rect(0, 0, W, 1.5, "F")

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(20, 18)
    pdf.cell(0, 6, L["exec_summary_header"], ln=True)

    # Divider
    pdf.set_fill_color(*GREEN)
    pdf.rect(20, 26, 30, 0.8, "F")

    # Big score
    pdf.set_font("Helvetica", "B", 52)
    pdf.set_text_color(*DARK)
    pdf.set_xy(0, 35)
    pdf.cell(W, 30, f"{int(maturity_score)}", align="C")

    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*MID_GRAY)
    pdf.set_xy(0, 64)
    pdf.cell(W, 6, _clean(L["score_suffix"].format(label=_score_label(maturity_score, lang))), align="C")

    # 3 stat boxes
    box_y = 78
    box_h = 28
    goal_label = _clean(str(investment_goal or L["stat_goal_default"]))
    if len(goal_label) > 14:
        goal_label = goal_label[:14] + "..."
    stats = [
        (L["stat_streak_value"].format(n=streak_count), L["stat_streak_label"]),
        (goal_label, L["stat_goal_label"]),
        (_clean(str(risk_tolerance or L["stat_risk_default"])), L["stat_risk_label"]),
    ]
    box_w = 52
    for i, (val, lbl) in enumerate(stats):
        bx = 17 + i * (box_w + 7)
        pdf.set_fill_color(*LIGHT_GRAY)
        pdf.rect(bx, box_y, box_w, box_h, "F")
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(*DARK)
        pdf.set_xy(bx, box_y + 5)
        pdf.cell(box_w, 8, _clean(str(val)), align="C")
        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(*MID_GRAY)
        pdf.set_xy(bx, box_y + 15)
        pdf.cell(box_w, 5, _clean(lbl), align="C")

    # Executive summary text
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(20, 115)
    pdf.cell(0, 6, L["summary_of_year"], ln=True)

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*DARK_TEXT)
    pdf.set_xy(20, 123)
    pdf.set_right_margin(20)
    pdf.multi_cell(170, 6, _clean(narrative.get("executive_summary", "")))
    pdf.set_right_margin(10)

    _page_footer(pdf, W, H, MID_GRAY, 2, L)

    # ── Page 3: Evolucion de Madurez ─────────────────────────────────────────
    pdf.add_page()
    pdf.set_fill_color(*WHITE)
    pdf.rect(0, 0, W, H, "F")
    pdf.set_fill_color(*GREEN)
    pdf.rect(0, 0, W, 1.5, "F")

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(20, 18)
    pdf.cell(0, 6, L["evolution_header"], ln=True)
    pdf.set_fill_color(*GREEN)
    pdf.rect(20, 26, 30, 0.8, "F")

    # Bar chart
    chart_x = 20
    chart_y = 40
    chart_w = 170
    chart_h = 100

    # Chart background
    pdf.set_fill_color(*LIGHT_GRAY)
    pdf.rect(chart_x, chart_y, chart_w, chart_h, "F")

    history = maturity_history[-12:] if maturity_history else []
    if not history:
        history = [{"month": L["current_label"], "score": maturity_score}]

    n = len(history)
    bar_w = min(18, (chart_w - 10) / n - 2)
    bar_spacing = (chart_w - 10) / n

    for i, entry in enumerate(history):
        score = float(entry.get("score", 0) or 0)
        bar_h_px = (score / 100) * (chart_h - 18)
        bx = chart_x + 5 + i * bar_spacing
        by = chart_y + chart_h - 14 - bar_h_px

        # Bar
        pdf.set_fill_color(*GREEN)
        pdf.rect(bx, by, bar_w, bar_h_px, "F")

        # Score label on top of bar
        pdf.set_font("Helvetica", "B", 6)
        pdf.set_text_color(*DARK)
        pdf.set_xy(bx - 1, by - 6)
        pdf.cell(bar_w + 2, 5, str(int(score)), align="C")

        # Month label below bar
        month_label = str(entry.get("month", i + 1))
        if len(month_label) > 4:
            month_label = month_label[:3]
        pdf.set_font("Helvetica", "", 6)
        pdf.set_text_color(*MID_GRAY)
        pdf.set_xy(bx - 1, chart_y + chart_h - 9)
        pdf.cell(bar_w + 2, 5, _clean(month_label), align="C")

    # Chart interpretation
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(20, chart_y + chart_h + 8)
    pdf.cell(0, 6, L["interpretation_header"], ln=True)

    interp = L["interp_intro"].format(score=int(maturity_score), year=year)
    if streak_count > 0:
        interp += L["interp_streak"].format(n=streak_count)
    else:
        interp += L["interp_no_streak"]

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*DARK_TEXT)
    pdf.set_xy(20, chart_y + chart_h + 16)
    pdf.set_right_margin(20)
    pdf.multi_cell(170, 6, _clean(interp))
    pdf.set_right_margin(10)

    _page_footer(pdf, W, H, MID_GRAY, 3, L)

    # ── Page 4: Sesgos & Comportamiento ──────────────────────────────────────
    pdf.add_page()
    pdf.set_fill_color(*WHITE)
    pdf.rect(0, 0, W, H, "F")
    pdf.set_fill_color(*GREEN)
    pdf.rect(0, 0, W, 1.5, "F")

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(20, 18)
    pdf.cell(0, 6, L["behavior_header"], ln=True)
    pdf.set_fill_color(*GREEN)
    pdf.rect(20, 26, 30, 0.8, "F")

    # Risk score display
    pdf.set_font("Helvetica", "B", 36)
    pdf.set_text_color(*DARK)
    pdf.set_xy(0, 35)
    pdf.cell(W, 20, f"{int(behavioral_risk_score)}", align="C")

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*MID_GRAY)
    pdf.set_xy(0, 54)
    pdf.cell(W, 6, L["risk_score_label"], align="C")

    # Behavioral analysis text
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*DARK_TEXT)
    pdf.set_xy(20, 68)
    pdf.set_right_margin(20)
    pdf.multi_cell(170, 6, _clean(narrative.get("behavioral_analysis", "")))
    pdf.set_right_margin(10)

    _page_footer(pdf, W, H, MID_GRAY, 4, L)

    # ── Page 5: Portafolio ────────────────────────────────────────────────────
    pdf.add_page()
    pdf.set_fill_color(*WHITE)
    pdf.rect(0, 0, W, H, "F")
    pdf.set_fill_color(*GREEN)
    pdf.rect(0, 0, W, 1.5, "F")

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(20, 18)
    pdf.cell(0, 6, L["portfolio_header"], ln=True)
    pdf.set_fill_color(*GREEN)
    pdf.rect(20, 26, 30, 0.8, "F")

    positions = portfolio_perf.get("positions", [])
    if not positions:
        pdf.set_font("Helvetica", "I", 11)
        pdf.set_text_color(*MID_GRAY)
        pdf.set_xy(0, 80)
        pdf.cell(W, 10, L["no_positions"], align="C")
    else:
        col_w = [80, 50, 40]
        headers = L["table_headers"]
        table_y = 38

        # Table header
        pdf.set_fill_color(*DARK)
        pdf.rect(20, table_y, 170, 9, "F")
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(*WHITE)
        pdf.set_xy(20, table_y + 1)
        for h, cw in zip(headers, col_w):
            pdf.cell(cw, 7, h, align="C")

        row_y = table_y + 9
        for i, pos in enumerate(positions[:12]):
            fill = LIGHT_GRAY if i % 2 == 0 else WHITE
            pdf.set_fill_color(*fill)
            pdf.rect(20, row_y, 170, 8, "F")
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(*DARK_TEXT)
            pdf.set_xy(20, row_y + 1)
            name = pos.get("name") or pos.get("ticker", "")
            pdf.cell(col_w[0], 6, _clean(str(name)[:30]), align="L")
            pdf.cell(col_w[1], 6, f"${pos.get('value', 0):,.2f}", align="C")
            gain = pos.get("gain_pct", 0)
            color = (0, 180, 100) if gain >= 0 else (220, 50, 50)
            pdf.set_text_color(*color)
            pdf.cell(col_w[2], 6, f"{gain:+.2f}%", align="C")
            pdf.set_text_color(*DARK_TEXT)
            row_y += 8

        # Totals summary
        total_invested  = portfolio_perf.get("total_invested", 0)
        total_value     = portfolio_perf.get("total_value", 0)
        total_return    = portfolio_perf.get("total_return_pct", 0)

        summary_y = row_y + 12
        for label, value_str, color in [
            (L["total_invested_label"], f"${total_invested:,.2f}", GREEN),
            (L["total_value_label"], f"${total_value:,.2f}", GREEN),
            (L["total_return_label"], f"{total_return:+.2f}%",
             (0, 180, 100) if total_return >= 0 else (220, 50, 50)),
        ]:
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*DARK_TEXT)
            pdf.set_xy(20, summary_y)
            pdf.cell(85, 7, label, align="L")
            pdf.set_text_color(*color)
            pdf.cell(85, 7, value_str, align="L")
            summary_y += 9

    _page_footer(pdf, W, H, MID_GRAY, 5, L)

    # ── Page 6: Recomendaciones ───────────────────────────────────────────────
    pdf.add_page()
    pdf.set_fill_color(*WHITE)
    pdf.rect(0, 0, W, H, "F")
    pdf.set_fill_color(*GREEN)
    pdf.rect(0, 0, W, 1.5, "F")

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(20, 18)
    pdf.cell(0, 6, _clean(L["recommendations_header"].format(year=year + 1)), ln=True)
    pdf.set_fill_color(*GREEN)
    pdf.rect(20, 26, 30, 0.8, "F")

    recs_text = narrative.get("recommendations", "")
    lines = [ln.strip() for ln in recs_text.split("\n") if ln.strip()]

    bullet_y = 40
    for line in lines[:5]:
        # Bullet box background
        pdf.set_fill_color(*LIGHT_GRAY)
        pdf.rect(20, bullet_y, 170, 22, "F")

        # Green left accent
        pdf.set_fill_color(*GREEN)
        pdf.rect(20, bullet_y, 3, 22, "F")

        # Text
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*DARK_TEXT)
        pdf.set_xy(27, bullet_y + 4)
        pdf.set_right_margin(25)
        pdf.multi_cell(163, 6, _clean(line))
        pdf.set_right_margin(10)

        bullet_y += 28

    _page_footer(pdf, W, H, MID_GRAY, 6, L)

    # ── Page 7: Certificado ───────────────────────────────────────────────────
    pdf.add_page()
    pdf.set_fill_color(*DARK)
    pdf.rect(0, 0, W, H, "F")

    # Border frame
    pdf.set_draw_color(*GREEN)
    pdf.set_line_width(1.5)
    pdf.rect(10, 10, W - 20, H - 20)
    pdf.set_line_width(0.3)
    pdf.rect(13, 13, W - 26, H - 26)

    # Corner accent squares
    for cx, cy in [(10, 10), (W - 10, 10), (10, H - 10), (W - 10, H - 10)]:
        pdf.set_fill_color(*GREEN)
        pdf.rect(cx - 2, cy - 2, 4, 4, "F")

    # Header
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(0, 38)
    pdf.cell(W, 7, L["certificate_header"], align="C")

    # Decorative line
    pdf.set_fill_color(*GREEN)
    pdf.rect(70, 48, 70, 0.8, "F")

    # Logo
    if _LOGO_PATH.exists():
        pdf.image(str(_LOGO_PATH), x=85, y=55, w=40)

    # Main certificate title
    pdf.set_font("Helvetica", "B", 28)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(0, 105)
    pdf.cell(W, 16, L["certificate_title"], align="C")

    # Second decorative line
    pdf.set_fill_color(*GREEN)
    pdf.rect(55, 124, 100, 0.8, "F")

    # User name
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(0, 130)
    pdf.cell(W, 10, _clean(first_name), align="C")

    # Certificate body
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color((200, 210, 225))
    cert_text = _clean(L["cert_text"].format(name=_clean(first_name)))
    pdf.set_xy(30, 148)
    pdf.set_right_margin(30)
    pdf.multi_cell(150, 6, cert_text, align="C")
    pdf.set_right_margin(10)

    # Issue date
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*MID_GRAY)
    issue_date = datetime.now(timezone.utc).strftime("%d/%m/%Y")
    pdf.set_xy(0, 170)
    pdf.cell(W, 6, _clean(L["issued_on"].format(date=issue_date)), align="C")

    # Signature line
    pdf.set_draw_color(*GREEN)
    pdf.set_line_width(0.5)
    pdf.line(65, 210, W - 65, 210)

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(0, 215)
    pdf.cell(W, 6, "Diego Arria", align="C")

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*MID_GRAY)
    pdf.set_xy(0, 222)
    pdf.cell(W, 5, L["founder_title"], align="C")

    # Bottom Nuvos label
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(*GREEN)
    pdf.set_xy(0, H - 22)
    pdf.cell(W, 5, "NUVOS AI", align="C")

    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(*MID_GRAY)
    pdf.set_xy(0, H - 16)
    pdf.cell(W, 4, L["tagline"], align="C")

    # Return bytes
    return bytes(pdf.output())


# ─── Route ───────────────────────────────────────────────────────────────────

@router.get("/generate")
@limiter.limit("3/hour")
async def generate_annual_report(
    request: Request,
    lang: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Generate a 7-page annual investor maturity PDF report for the authenticated user."""
    user_id    = user["id"]
    user_email = user.get("email") or ""
    year       = datetime.now(timezone.utc).year

    db = get_supabase()

    # Fetch user profile
    profile_result = await run_query(
        db.table("user_profiles").select(
            "maturity_score, maturity_history, behavioral_risk_score, risk_tolerance, "
            "investment_goal, investment_goal_amount, streak_count, created_at, "
            "subscription_tier, first_name, last_name, full_name, preferred_language"
        ).eq("user_id", user_id).single()
    )
    profile = profile_result.data or {}

    if lang not in ("es", "en"):
        lang = profile.get("preferred_language") or "es"
    L = _pdf_labels(lang)

    # Resolve display name
    first_name = (
        profile.get("first_name")
        or (profile.get("full_name") or "").split()[0]
        or user_email.split("@")[0]
        or L["investor_default"]
    )

    maturity_score         = float(profile.get("maturity_score") or 0)
    maturity_history       = profile.get("maturity_history") or []
    behavioral_risk_score  = float(profile.get("behavioral_risk_score") or 0)
    risk_tolerance         = profile.get("risk_tolerance") or L["risk_tolerance_default"]
    investment_goal        = profile.get("investment_goal") or L["goal_default"]
    investment_goal_amount = float(profile.get("investment_goal_amount") or 0)
    streak_count           = int(profile.get("streak_count") or 0)

    # Fetch portfolio positions
    port_result = await run_query(
        db.table("portfolio_positions").select("*").eq("user_id", user_id)
    )
    positions = port_result.data or []

    # Compute portfolio performance
    if positions:
        try:
            portfolio_perf = await asyncio.wait_for(
                asyncio.to_thread(_compute_performance, positions),
                timeout=30,
            )
        except Exception as e:
            logger.warning("_compute_performance failed: %s", e)
            portfolio_perf = {
                "positions": [], "total_invested": 0,
                "total_value": 0, "total_return_pct": 0,
            }
    else:
        portfolio_perf = {
            "positions": [], "total_invested": 0,
            "total_value": 0, "total_return_pct": 0,
        }

    # Generate Claude narrative
    try:
        narrative = await _generate_narrative(
            maturity_score=maturity_score,
            maturity_history=maturity_history,
            behavioral_risk_score=behavioral_risk_score,
            investment_goal=investment_goal,
            investment_goal_amount=investment_goal_amount,
            risk_tolerance=risk_tolerance,
            streak_count=streak_count,
            lang=lang,
        )
    except Exception as e:
        logger.error("Claude narrative generation failed: %s", e)
        narrative = _default_narrative(maturity_score, lang)

    # Build PDF (CPU-bound, run in thread)
    pdf_bytes = await asyncio.to_thread(
        _build_pdf,
        first_name,
        year,
        maturity_score,
        maturity_history,
        behavioral_risk_score,
        investment_goal,
        streak_count,
        risk_tolerance,
        portfolio_perf,
        narrative,
        lang,
    )

    buffer = io.BytesIO(pdf_bytes)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="reporte-anual-nuvos-{year}.pdf"'
        },
    )
