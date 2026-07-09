"""
Generic PDF renderer for Deep Research reports.

Unlike annual_report.py's hand-laid-out 7-page PDF (fixed sections, auto page
break disabled), a research report's length varies enormously by request —
one company vs. five, screening vs. deep single-company dive — so this uses
FPDF's automatic pagination and one small render function per block type.
Adding a new block type later is additive here too, same as the frontend
report renderer.
"""

from fpdf import FPDF

_ACCENT_MAP = str.maketrans(
    "áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöüÄËÏÖÜñÑ¿¡",
    "aeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUnN??",
)


def _clean(text) -> str:
    if text is None:
        return ""
    return str(text).translate(_ACCENT_MAP)


_GREEN = (0, 212, 126)
_DARK_TEXT = (31, 41, 55)
_MUTED = (107, 114, 128)

_BLOCK_TITLES = {
    "executive_summary": "Resumen Ejecutivo",
    "business_overview": "Vision General del Negocio",
    "recent_changes": "Cambios Recientes",
    "business_model": "Modelo de Negocio",
    "competitive_advantages": "Ventajas Competitivas",
    "industry_analysis": "Analisis de la Industria",
    "competitor_comparison": "Comparacion con Competidores",
    "financial_analysis": "Analisis Financiero",
    "management_evaluation": "Evaluacion de la Gerencia",
    "risk_analysis": "Analisis de Riesgos",
    "catalysts": "Catalizadores",
    "valuation": "Valuacion",
    "historical_performance": "Desempeno Historico",
    "portfolio_compatibility": "Compatibilidad con tu Portafolio",
    "alternative_ideas": "Ideas Alternativas",
    "investment_thesis": "Tesis de Inversion",
    "key_takeaways": "Puntos Clave",
    "sources": "Fuentes",
}


def _section_header(pdf: FPDF, title: str) -> None:
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(*_GREEN)
    pdf.cell(0, 10, _clean(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*_GREEN)
    pdf.line(pdf.get_x(), pdf.get_y(), pdf.get_x() + 190, pdf.get_y())
    pdf.ln(4)
    pdf.set_text_color(*_DARK_TEXT)


def _body_text(pdf: FPDF, text) -> None:
    if not text:
        return
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*_DARK_TEXT)
    # multi_cell defaults to new_x=RIGHT — without resetting to the left margin,
    # the very next multi_cell call inherits a cursor near the right edge and
    # raises "Not enough horizontal space to render a single character".
    pdf.multi_cell(0, 5.5, _clean(text), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)


def _bullet_list(pdf: FPDF, items) -> None:
    if not items:
        return
    pdf.set_font("Helvetica", "", 10)
    for item in items:
        pdf.set_text_color(*_DARK_TEXT)
        pdf.multi_cell(0, 5.5, f"- {_clean(item)}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)


def _render_block(pdf: FPDF, block: dict) -> None:
    btype = block.get("type", "")
    data = block.get("data", {})
    _section_header(pdf, _BLOCK_TITLES.get(btype, btype.replace("_", " ").title()))

    if isinstance(data, str):
        _body_text(pdf, data)
    elif isinstance(data, list):
        _bullet_list(pdf, data)
    elif isinstance(data, dict):
        for key, value in data.items():
            label = key.replace("_", " ").title()
            if isinstance(value, list):
                pdf.set_font("Helvetica", "B", 10.5)
                pdf.set_text_color(*_MUTED)
                pdf.cell(0, 6, _clean(label), new_x="LMARGIN", new_y="NEXT")
                _bullet_list(pdf, value)
            elif isinstance(value, dict):
                pdf.set_font("Helvetica", "B", 10.5)
                pdf.set_text_color(*_MUTED)
                pdf.cell(0, 6, _clean(label), new_x="LMARGIN", new_y="NEXT")
                _body_text(pdf, ", ".join(f"{k}: {v}" for k, v in value.items()))
            else:
                pdf.set_font("Helvetica", "B", 10.5)
                pdf.set_text_color(*_MUTED)
                pdf.cell(0, 6, _clean(label) + ":", new_x="LMARGIN", new_y="NEXT")
                _body_text(pdf, value)
    pdf.ln(4)


def build_report_pdf(title: str, blocks: list[dict]) -> bytes:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*_GREEN)
    pdf.multi_cell(0, 10, _clean(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*_MUTED)
    pdf.cell(0, 6, "Nuvos AI - Deep Research", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    for block in blocks or []:
        _render_block(pdf, block)

    return bytes(pdf.output())
