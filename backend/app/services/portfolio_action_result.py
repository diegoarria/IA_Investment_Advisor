"""Structured result + deterministic reply for a portfolio action the backend
has ALREADY executed (Stage 4 COGS work).

After `confirm_pending_financial_action` runs, the backend knows exactly what
happened — it just wrote (or failed to write) the portfolio. Re-asking an LLM
"what happened?" to narrate that costs a full model call (~48K-token prefix
before Stage 1) and is the one place Arthur has been caught lying about a
transaction (2026-09-19). This module turns the backend's own result into the
reply instead, with NO model involved.

Safety rules baked into the renderer:
  * Every number comes from the result, which the executor fills from the
    pending row that was actually applied and the positions the DB write
    actually returned — never from the user's message.
  * Success wording ("Listo", "Registré", "tu posición ahora es") is only ever
    produced for status == "success".
  * `portfolio_refresh` is only ever emitted for status == "success".
  * Only outcomes that need no further conversation are rendered here
    (success, a failed write, a lost double-confirm race). Everything else —
    expired, not found, rejected sell, cancelled, UPDATE/DELETE corrections —
    is left to the existing LLM path unchanged.
"""
import json
import re
from dataclasses import dataclass, asdict

STATUS_SUCCESS = "success"
STATUS_WRITE_FAILED = "write_failed"
STATUS_ALREADY_PROCESSED = "already_processed"
RENDERABLE_STATUSES = frozenset({STATUS_SUCCESS, STATUS_WRITE_FAILED, STATUS_ALREADY_PROCESSED})
RENDERABLE_ACTIONS = frozenset({"BUY", "SELL"})


@dataclass(frozen=True)
class PortfolioActionResult:
    status: str
    action: str | None = None           # "BUY" | "SELL" | "UPDATE" | "DELETE"
    ticker: str | None = None
    company_name: str | None = None
    quantity: float | None = None
    price: float | None = None
    total_value: float | None = None
    previous_position: float | None = None   # shares of this ticker BEFORE the write
    new_position: float | None = None        # shares of this ticker AFTER the write (from the DB result)
    avg_cost: float | None = None
    realized_pl: float | None = None         # SELL only
    currency: str = "USD"
    portfolio_name: str | None = None
    portfolio_refresh: bool = False

    @property
    def renderable(self) -> bool:
        if self.status not in RENDERABLE_STATUSES:
            return False
        if self.status == STATUS_SUCCESS:
            return (
                self.action in RENDERABLE_ACTIONS
                and self.ticker is not None
                and self.quantity is not None
                and self.price is not None
                and self.new_position is not None
            )
        return True

    def to_log_dict(self) -> dict:
        """Fields safe to log — no names, no ids."""
        d = asdict(self)
        d.pop("portfolio_name", None)
        d.pop("company_name", None)
        return d


def action_from_row(action_type: str | None) -> str | None:
    return {
        "BUY_ASSET": "BUY", "SELL_ASSET": "SELL",
        "UPDATE_TRANSACTION": "UPDATE", "DELETE_TRANSACTION": "DELETE",
    }.get(action_type or "")


# ── Formatting ───────────────────────────────────────────────────────────────

def _qty(x: float) -> str:
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return s or "0"


def _money(x: float, currency: str) -> str:
    s = f"${abs(x):,.2f}"
    return s if not currency or currency.upper() == "USD" else f"{s} {currency.upper()}"


def _signed_money(x: float, currency: str) -> str:
    return ("+" if x >= 0 else "-") + _money(x, currency)


def _label(r: PortfolioActionResult) -> str:
    name = (r.company_name or "").strip()
    if name and name.upper() != (r.ticker or "").upper():
        return f"{name} ({r.ticker})"
    return r.ticker or ""


def render_reply(r: PortfolioActionResult, lang: str = "es") -> str:
    """Natural, short Arthur-voice reply derived ONLY from `r`. `lang` is
    "es" or "en". Callers must check `r.renderable` first."""
    en = lang == "en"
    if r.status == STATUS_WRITE_FAILED:
        return (
            "I couldn't complete the operation because there was a problem updating your portfolio. "
            "No change was recorded. You can try again."
            if en else
            "No pude completar la operación porque ocurrió un problema al actualizar tu portafolio. "
            "No se registró ningún cambio. Puedes intentarlo nuevamente."
        )
    if r.status == STATUS_ALREADY_PROCESSED:
        return (
            "That operation was already processed (or is being processed), so I didn't duplicate it. "
            "Check your portfolio before repeating it."
            if en else
            "Esa operación ya se procesó antes (o está en proceso), así que no la dupliqué. "
            "Revisa tu portafolio antes de repetirla."
        )
    if not r.renderable:
        raise ValueError("render_reply called on a result that is not renderable")

    cur = r.currency
    qty = _qty(r.quantity)
    one = abs(r.quantity - 1) < 1e-9
    plural_en = "" if one else "s"
    word_es = "acción" if one else "acciones"
    total = r.total_value if r.total_value is not None else r.quantity * r.price
    label = _label(r)

    if r.action == "BUY":
        if en:
            head = f"Done. I recorded the purchase of {qty} share{plural_en} of {label} at {_money(r.price, cur)} per share."
            body = f"You invested {_money(total, cur)} and your position is now {_qty(r.new_position)} shares"
            body += f", with an average cost of {_money(r.avg_cost, cur)}." if r.avg_cost else "."
            tail = "Your portfolio is already up to date."
        else:
            head = f"Listo. Registré la compra de {qty} {word_es} de {label} a {_money(r.price, cur)} por acción."
            body = f"Invertiste {_money(total, cur)} y tu posición ahora es de {_qty(r.new_position)} acciones"
            body += f", con un costo promedio de {_money(r.avg_cost, cur)}." if r.avg_cost else "."
            tail = "Tu portafolio ya quedó actualizado."
        return f"{head}\n\n{body}\n\n{tail}"

    # SELL
    closed = r.new_position <= 1e-6
    if en:
        head = f"Done. I recorded the sale of {qty} share{plural_en} of {label} at {_money(r.price, cur)} per share."
        body = f"The operation was worth {_money(total, cur)} and " + (
            "you closed the position completely." if closed
            else f"your position is now {_qty(r.new_position)} shares."
        )
        if r.realized_pl is not None:
            body += f" Realized gain/loss on this sale: {_signed_money(r.realized_pl, cur)}."
        tail = "Your portfolio is already up to date."
    else:
        head = f"Listo. Registré la venta de {qty} {word_es} de {label} a {_money(r.price, cur)} por acción."
        body = f"La operación fue por {_money(total, cur)} y " + (
            "cerraste la posición por completo." if closed
            else f"tu posición ahora es de {_qty(r.new_position)} acciones."
        )
        if r.realized_pl is not None:
            body += f" Ganancia/pérdida realizada en esta venta: {_signed_money(r.realized_pl, cur)}."
        tail = "Tu portafolio ya quedó actualizado."
    return f"{head}\n\n{body}\n\n{tail}"


def action_tag(r: PortfolioActionResult, lang: str = "es") -> str:
    """The hidden `<!-- ACTION -->` block the clients already parse. Carries
    the silent `portfolio_refresh` signal — but ONLY for a successful write —
    plus the same "log a reflection" chip Arthur's protocol always includes."""
    if r.status != STATUS_SUCCESS or not r.portfolio_refresh:
        return ""
    actions = [{
        "type": "decision",
        "label": "Log this reflection" if lang == "en" else "Registrar esta reflexión",
        "data": {"action": "buy" if r.action == "BUY" else "sell", "ticker": r.ticker, "notes": ""},
    }, {"type": "portfolio_refresh", "label": "", "data": {}}]
    return "\n\n<!-- ACTION: " + json.dumps({"actions": actions}, ensure_ascii=False, separators=(",", ":")) + " -->"


def render_full(r: PortfolioActionResult, lang: str = "es") -> str:
    return render_reply(r, lang) + action_tag(r, lang)


# ── Shadow-mode comparison ───────────────────────────────────────────────────

_SUCCESS_WORDS_RE = re.compile(
    r"\b(listo|registr[eé]|registrad[oa]|aplicad[oa]|ya qued[oó]|actualizad[oa]|done|recorded|applied|updated)\b",
    re.IGNORECASE,
)


def compare_with_llm_text(r: PortfolioActionResult, llm_text: str) -> list[str]:
    """Discrepancies between what the LLM narrated after the tool and what the
    backend's structured result says. Empty list == they agree on every fact
    the deterministic reply would have stated."""
    issues: list[str] = []
    text = llm_text or ""
    if r.status != STATUS_SUCCESS:
        if _SUCCESS_WORDS_RE.search(text):
            issues.append("llm_claims_success_on_non_success")
        if '"portfolio_refresh"' in text:
            issues.append("llm_emitted_refresh_on_non_success")
        return issues
    if r.ticker and r.ticker.upper() not in text.upper():
        issues.append("llm_missing_ticker")
    if r.new_position is not None and _qty(r.new_position) not in text.replace(",", ""):
        issues.append("llm_missing_or_different_new_position")
    if r.portfolio_refresh and '"portfolio_refresh"' not in text:
        issues.append("llm_missing_portfolio_refresh")
    return issues
