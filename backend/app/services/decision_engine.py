"""Decision Support layer for Arthur (Nuvos's mentor) — built ON TOP of the
existing prompt-driven system in ai_service.py, not a replacement for it.

Why this file exists: SYSTEM_PROMPT_BASE already tells the model, in prose,
to reason about the user's real situation before answering and to never
prescribe. That works, but it leaves two things to the model's judgment that
shouldn't be judgment calls at all:

1. Portfolio math (cost basis vs. market value, position weight, P&L) — the
   model was being asked to hold numbers in its head and compute correctly
   every time. `compute_portfolio_truth()` below does that once,
   deterministically, in code, and the result is injected as a fact.
2. Whether a generated answer slipped into "you should buy/sell X" — the
   model was the only line of defense. `check_recommendation_guard()` is a
   deterministic, regex-based second line, mirroring the existing
   `_INJECTION_RE` / `is_blatant_injection_attempt()` pattern in
   ai_service.py for prompt-injection detection.

Everything else here (DecisionContext, DecisionState) is a *typed
description* of information Arthur already has scattered across
build_profile_context/build_deep_user_context — it does not re-fetch or
duplicate that data, it just gives the pieces that matter for a capital-
allocation decision a name and a single deterministic rendering path into
the prompt, so the model is told facts instead of asked to reconstruct them
from prose it wrote itself two paragraphs earlier.

Design boundary that matters: NOTHING in this module decides anything for
the user or generates prose recommendations. Scenario generation, the
actual "here are your alternatives" reasoning, stays with the LLM under
SYSTEM_PROMPT_BASE's existing capital-allocation section — that's a genuine
open-ended reasoning task, not a computation, and turning it into a rigid
templated engine would trade Arthur's actual judgment for something worse.
What's deterministic here is *only* the parts that are genuinely arithmetic
or classification (portfolio math, keyword-based state/language detection).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ──────────────────────────────────────────────────────────────
# Portfolio Truth — cost basis vs. market value, computed once, correctly.
# ──────────────────────────────────────────────────────────────

def aggregate_positions_by_ticker(positions: list[dict]) -> list[dict]:
    """`positions` is one row per purchase LOT, by design — buying more of a
    ticker you already hold adds a new lot rather than merging into the
    existing one, so each lot keeps its own price/date. Any code that feeds
    positions to an LLM (or counts them) must aggregate by ticker first, or
    a stock bought twice reads as two separate holdings with split weights.
    Returns one row per ticker with combined shares and a shares-weighted
    average cost — never fabricates a price, just re-derives the same real
    numbers the caller already had.

    Single source of truth: ai_service.py imports this function rather than
    defining its own copy, so lot-aggregation logic only exists in one
    place."""
    agg_by_ticker: dict[str, dict] = {}
    for p in positions:
        ticker = (p.get("ticker") or "?").upper()
        shares = float(p.get("shares", 0) or 0)
        avg    = float(p.get("avg_price", p.get("avgPrice", 0)) or 0)
        entry  = agg_by_ticker.setdefault(ticker, {"ticker": ticker, "name": p.get("name"), "shares": 0.0, "cost": 0.0})
        entry["shares"] += shares
        entry["cost"]   += shares * avg
        if not entry.get("name") and p.get("name"):
            entry["name"] = p.get("name")
    return [
        {
            "ticker": e["ticker"],
            "name": e.get("name"),
            "shares": e["shares"],
            "avg_price": (e["cost"] / e["shares"] if e["shares"] else 0.0),
        }
        for e in agg_by_ticker.values()
    ]


@dataclass
class PositionTruth:
    """One holding's real numbers — cost basis and market value kept as two
    distinct fields on purpose (see module docstring point 1). Nothing here
    is ever estimated: `market_value`/`unrealized_pnl`/`unrealized_return`
    are all `None` when no live quote was available, never backfilled with
    cost basis or any other stand-in value."""
    ticker: str
    shares: float
    avg_cost: float
    cost_basis: float                      # shares * avg_cost — capital histórico invertido
    current_price: Optional[float] = None
    market_value: Optional[float] = None   # shares * current_price, only when a real quote exists
    unrealized_pnl: Optional[float] = None
    unrealized_return_pct: Optional[float] = None
    current_weight_pct: Optional[float] = None  # % of portfolio BY MARKET VALUE — never by cost basis


def compute_portfolio_truth(positions: list[dict], quotes: dict[str, dict] | None = None) -> list[PositionTruth]:
    """The Portfolio Truth layer: one PositionTruth per real holding.

    Critical rule (this is the part the spec calls out explicitly): current
    weight is computed against total MARKET VALUE, never total cost basis.
    A position that's up 60% is a bigger share of the portfolio today than
    its original investment implies — reasoning about concentration using
    the wrong denominator understates real risk. When live quotes aren't
    available for every position, this falls back to weighting by cost
    basis for the positions missing a quote and says so via `current_price
    is None` on those rows — it never silently mixes the two bases into one
    number without a way to tell which is which.
    """
    quotes = quotes or {}
    agg = aggregate_positions_by_ticker(positions)
    if not agg:
        return []

    rows: list[PositionTruth] = []
    for p in agg:
        ticker = p["ticker"]
        shares = p["shares"]
        avg_cost = p["avg_price"]
        cost_basis = shares * avg_cost
        q = quotes.get(ticker)
        price = float(q["price"]) if q and q.get("price") else None
        market_value = shares * price if price is not None else None
        pnl = (market_value - cost_basis) if market_value is not None else None
        ret_pct = (pnl / cost_basis * 100) if (pnl is not None and cost_basis > 0) else None
        rows.append(PositionTruth(
            ticker=ticker, shares=shares, avg_cost=avg_cost, cost_basis=cost_basis,
            current_price=price, market_value=market_value,
            unrealized_pnl=pnl, unrealized_return_pct=ret_pct,
        ))

    # Weight by market value where we have it for EVERY position; otherwise
    # fall back to cost-basis weight (documented via current_price=None on
    # the affected rows) rather than silently blending both bases into one
    # percentage that means nothing.
    have_all_prices = all(r.market_value is not None for r in rows)
    denom_field = "market_value" if have_all_prices else "cost_basis"
    total = sum(getattr(r, denom_field) or r.cost_basis for r in rows)
    if total > 0:
        for r in rows:
            base = r.market_value if have_all_prices else r.cost_basis
            r.current_weight_pct = round((base or 0) / total * 100, 1)
    return rows


def portfolio_truth_to_prompt_block(rows: list[PositionTruth]) -> str:
    """Deterministic rendering of Portfolio Truth for the system prompt —
    the model is TOLD these numbers, never asked to recompute or recall
    them from earlier in the conversation."""
    if not rows:
        return ""
    lines = ["\n## 📐 PORTFOLIO TRUTH (calculado en código, no en el modelo — usa estas cifras exactas):"]
    for r in sorted(rows, key=lambda x: x.current_weight_pct or 0, reverse=True):
        weight_basis = "valor de mercado" if r.market_value is not None else "costo (sin cotización en vivo)"
        line = f"  - {r.ticker}: {r.shares:g} acciones, costo base ${r.cost_basis:,.0f}"
        if r.market_value is not None:
            sign = "+" if (r.unrealized_pnl or 0) >= 0 else ""
            line += f", valor de mercado ${r.market_value:,.0f}, P&L {sign}${r.unrealized_pnl:,.0f} ({sign}{r.unrealized_return_pct:.1f}%)"
        line += f" — peso actual del portafolio: {r.current_weight_pct}% (base: {weight_basis})"
        lines.append(line)
    lines.append(
        "  → El peso de cada posición se calcula SIEMPRE con el valor de mercado actual, nunca con el costo "
        "de la compra original — una posición que subió representa hoy más concentración de la que su costo "
        "original sugiere. Si en otra parte de este contexto aparece un porcentaje distinto para la misma "
        "posición (ej. un peso calculado sobre el costo de compra), estas cifras de PORTFOLIO TRUTH son las "
        "correctas para hablar de concentración real — la otra sección describe cuánto invirtió el usuario, "
        "no cuánto representa hoy esa posición."
    )
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────
# Decision State — where the user is in their own decision process.
# ──────────────────────────────────────────────────────────────

class DecisionState(str, Enum):
    EXPLORING = "exploring"          # discovering what's even possible
    UNDERSTANDING = "understanding"  # trying to understand one alternative/problem
    COMPARING = "comparing"          # weighing two or more alternatives
    EVALUATING = "evaluating"        # going deep on one specific alternative
    DECIDING = "deciding"            # close to a decision
    EXECUTING = "executing"          # already decided, acting on it
    REVIEWING = "reviewing"          # looking back at a past decision


_STATE_PATTERNS: dict[DecisionState, list[str]] = {
    DecisionState.EXECUTING: [
        r"\bvoy a (comprar|vender|invertir|meter)\b", r"\backo de (comprar|vender)\b",
        r"\bacabo de (comprar|vender|invertir)\b", r"\bya (compr[eé]|vend[ií])\b",
        r"\bi('m| am) (going to|about to) (buy|sell|invest)\b", r"\bi just (bought|sold|invested)\b",
    ],
    DecisionState.DECIDING: [
        r"\bestoy (pensando|a punto) de\b", r"\bquiero meter \$?\d", r"\bdeber[ií]a (comprar|vender)\b",
        r"\bme conviene\b", r"\bvale la pena\b", r"\bi('m| am) (thinking about|about to)\b",
        r"\bshould i (buy|sell|invest)\b",
        # Urgency/FOMO phrasing ("subió 15%, ¿compro antes de que siga subiendo?")
        r"antes de que (siga|contin[uú]e)", r"\bbefore it (goes up|rises|keeps going)\b",
        r"¿?compro\s+(ahora|ya|antes)", r"\bshould i buy (it )?now\b",
    ],
    DecisionState.COMPARING: [
        r"\b\w+\s+(o|vs\.?|versus)\s+\w+\b",
        r"\bcu[aá]l(es)? es mejor\b", r"\bqu[eé] es mejor\b", r"\bqu[eé] me conviene m[aá]s\b",
        r"\bwhich is better\b", r"\bcompar[ae]r?\b.{0,30}\bcon\b",
    ],
    DecisionState.REVIEWING: [
        r"\bhice bien\b", r"\bfue buena decisi[oó]n\b", r"\bmirando hacia atr[aá]s\b",
        r"\bin hindsight\b", r"\bwas it a good (decision|call)\b", r"\bc[oó]mo me fue con\b",
    ],
    DecisionState.EVALUATING: [
        r"\banal[ií]za(me)?\b", r"\bqu[eé] tan buena? (empresa|acci[oó]n|inversi[oó]n)\b",
        r"\banalyze\b", r"\bdeep dive\b", r"\bhow good (is|of an investment)\b",
    ],
    DecisionState.UNDERSTANDING: [
        r"\bqu[eé] es\b", r"\bc[oó]mo funciona\b", r"\bno entiendo\b", r"\bexpl[ií]came\b",
        r"\bwhat is\b", r"\bhow does .* work\b", r"\bi don'?t understand\b",
    ],
}


def infer_decision_state(message: str, recent_decisions: list[dict] | None = None) -> DecisionState:
    """Heuristic, deterministic classification of where the user is in a
    decision process — used to calibrate how much Arthur should ask vs.
    answer (per SYSTEM_PROMPT_BASE's existing "no sobre-preguntar" rule),
    never to gate or block a response. Order matters: checked from most-
    committed (EXECUTING) to least (UNDERSTANDING/EXPLORING) so a message
    that matches multiple patterns lands on the most actionable one.
    Falls back to EXPLORING — the safest default when no signal matches,
    since it implies "show the map," never "assume a decision is imminent."
    """
    text = (message or "").lower()
    for state in (
        DecisionState.EXECUTING, DecisionState.DECIDING, DecisionState.COMPARING,
        DecisionState.REVIEWING, DecisionState.EVALUATING, DecisionState.UNDERSTANDING,
    ):
        for pattern in _STATE_PATTERNS[state]:
            if re.search(pattern, text):
                return state
    return DecisionState.EXPLORING


# ──────────────────────────────────────────────────────────────
# Decision Context — a typed snapshot of what's known about THIS decision.
# ──────────────────────────────────────────────────────────────

@dataclass
class DecisionContext:
    """Structured facts relevant to a capital-allocation decision, built
    from real backend data — never from the LLM "remembering" or inferring
    a number. Every field is `None` when not known; `None` must never be
    treated as zero or as license to guess. `to_prompt_block()` renders
    only the fields that are actually known, and is explicit when a field
    that WOULD matter (debt, purpose) is simply unavailable, rather than
    silently omitting it (per section 3/18 of the spec: never turn
    "unknown" into an assumption).

    Source-of-truth precedence for every field here (highest first):
    1. Structured backend data (user_profiles, user_portfolio, live quotes)
    2. Explicit statement in the user's current message
    3. Stored profile fields
    4. Conversation memory (lowest — informative, never authoritative for
       an exact number)
    The LLM's own general knowledge is never a source for a DecisionContext
    field — it only synthesizes prose FROM these facts.
    """
    decision_state: DecisionState = DecisionState.EXPLORING
    available_capital: Optional[float] = None
    currency: Optional[str] = None
    purpose: Optional[str] = None                 # what the capital is FOR, if stated
    country: Optional[str] = None
    tax_residency: Optional[str] = None
    monthly_income: Optional[float] = None
    monthly_expenses: Optional[float] = None
    has_emergency_fund: Optional[bool] = None
    debt_known: bool = False                       # True only if the backend actually tracks debt for this user
    risk_tolerance: Optional[str] = None
    investment_horizon_years: Optional[float] = None
    financial_goals: list[str] = field(default_factory=list)
    knowledge_level: Optional[str] = None
    portfolio: list[PositionTruth] = field(default_factory=list)
    cash_position: Optional[float] = None

    def to_prompt_block(self) -> str:
        """Deterministic, fact-only rendering — every line here is either a
        real number/field from the backend or an explicit "no disponible."
        Never invents a value for a None field."""
        lines = [f"\n## 🧭 DECISION CONTEXT (estado inferido: {self.decision_state.value})"]
        known: list[str] = []
        if self.available_capital is not None:
            cur = self.currency or ""
            known.append(f"Capital disponible declarado en este mensaje: {cur} ${self.available_capital:,.0f}")
        if self.purpose:
            known.append(f"Propósito declarado del capital: {self.purpose}")
        if self.country:
            known.append(f"País: {self.country}")
        if self.monthly_income is not None:
            known.append(f"Ingreso mensual: ${self.monthly_income:,.0f}")
        if self.monthly_expenses is not None:
            known.append(f"Gastos mensuales: ${self.monthly_expenses:,.0f}")
        if self.has_emergency_fund is not None:
            known.append("Tiene fondo de emergencia" if self.has_emergency_fund else "No tiene fondo de emergencia (o no está confirmado)")
        if self.risk_tolerance:
            known.append(f"Tolerancia al riesgo declarada: {self.risk_tolerance}")
        if self.investment_horizon_years is not None:
            known.append(f"Horizonte declarado: {self.investment_horizon_years:g} años")
        if self.financial_goals:
            known.append(f"Metas declaradas: {', '.join(self.financial_goals)}")
        if self.cash_position is not None:
            known.append(f"Efectivo disponible en portafolio: ${self.cash_position:,.0f}")

        if known:
            lines.extend(f"  - {k}" for k in known)
        else:
            lines.append("  - Sin datos estructurados adicionales para esta decisión más allá del perfil ya mostrado arriba.")

        if not self.debt_known:
            lines.append(
                "  - Deuda: NO HAY DATOS ESTRUCTURADOS DE DEUDA EN NUVOS TODAVÍA. Si el usuario menciona deuda "
                "en su mensaje, trátala como información real de ESTE mensaje — pero nunca asumas que no tiene "
                "deuda solo porque no aparece aquí; si es relevante para la decisión, pregúntaselo en vez de asumir."
            )

        if self.portfolio:
            lines.append(portfolio_truth_to_prompt_block(self.portfolio))

        lines.append(
            "  → Regla: cualquier campo que NO aparezca arriba es DESCONOCIDO, no cero ni irrelevante. "
            "Si es materialmente importante para comparar las alternativas de esta decisión, pregúntalo — "
            "nunca lo asumas ni lo inventes."
        )
        return "\n".join(lines)


_CAPITAL_MENTION_RE = re.compile(
    r"(?:tengo|dispongo de|cuento con|i have|got)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*"
    r"(mxn|usd|pesos|dollars?|dólares|d[oó]lares|k\b)?",
    re.IGNORECASE,
)


def _extract_capital_mention(message: str) -> tuple[Optional[float], Optional[str]]:
    """Best-effort, conservative extraction of an amount the user just
    stated in THIS message (e.g. "tengo $50,000 MXN") — deliberately narrow
    (a handful of common phrasings) so it never misreads an unrelated
    number (a ticker price, a percentage) as available capital. Returns
    (None, None) rather than a guess when the message doesn't match."""
    m = _CAPITAL_MENTION_RE.search(message or "")
    if not m:
        return None, None
    try:
        amount = float(m.group(1).replace(",", ""))
    except ValueError:
        return None, None
    unit = (m.group(2) or "").lower()
    if unit == "k":
        amount *= 1000
    currency = "USD" if unit in ("usd", "dollars", "dollar", "dólares", "dolares") else ("MXN" if unit in ("mxn", "pesos") else None)
    return amount, currency


def build_decision_context(
    message: str,
    profile=None,  # UserProfile | None — kept loosely typed to avoid importing app.models.user here
    positions: list[dict] | None = None,
    quotes: dict[str, dict] | None = None,
    cash_position: Optional[float] = None,
    recent_decisions: list[dict] | None = None,
) -> DecisionContext:
    """Builds a DecisionContext from real, already-fetched backend data —
    this function does NOT hit the network or the database itself (callers
    in chat.py already fetched profile/positions/quotes for other reasons;
    this just re-shapes what they already have). No field is invented: a
    profile attribute that's None/missing stays None here.
    """
    ctx = DecisionContext(decision_state=infer_decision_state(message, recent_decisions))

    amount, currency = _extract_capital_mention(message)
    if amount is not None:
        ctx.available_capital = amount
        ctx.currency = currency or (getattr(profile, "currency", None) if profile else None)

    if profile is not None:
        ctx.country = getattr(profile, "country", None)
        ctx.monthly_income = _safe_float(getattr(profile, "monthly_income", None))
        ctx.monthly_expenses = _safe_float(getattr(profile, "monthly_expenses_usd", None))
        ctx.risk_tolerance = getattr(profile, "risk_tolerance", None)
        ctx.investment_horizon_years = _safe_float(getattr(profile, "time_horizon_years", None))
        goal = getattr(profile, "investment_goal", None)
        if goal:
            ctx.financial_goals = [goal]
        ctx.knowledge_level = getattr(profile, "knowledge_level", None)
        if ctx.currency is None:
            ctx.currency = getattr(profile, "currency", None)

    if positions:
        ctx.portfolio = compute_portfolio_truth(positions, quotes)

    ctx.cash_position = cash_position

    return ctx


def _safe_float(value) -> Optional[float]:
    try:
        return float(value) if value is not None and value != "" else None
    except (TypeError, ValueError):
        return None


# ──────────────────────────────────────────────────────────────
# Recommendation Guardrail — deterministic detection of personalized,
# prescriptive language ("you should buy X"), as a second line of defense
# behind SYSTEM_PROMPT_BASE's existing NIVEL 1 prompt-level guardrails.
# ──────────────────────────────────────────────────────────────

# Deliberately narrow: matches PRESCRIPTIVE phrasing directed at the reader
# ("deberías comprar", "te recomiendo", imperative "compra X"), never a
# descriptive statement about buying/selling in general ("comprar acciones
# individuales implica más riesgo" must NOT match — note it uses the
# infinitive "comprar", not the imperative "compra"). Spanish imperative
# tú-forms (compra, vende, invierte) are distinct word forms from their
# infinitives (comprar, vender, invertir), which is what keeps this from
# false-positiving on ordinary descriptive analysis.
_RECOMMENDATION_PATTERNS = [
    # Spanish — direct prescriptive verbs/phrases
    r"deber[ií]as?\s+(comprar|vender|invertir|elegir|escoger|meter|poner)",
    r"te recomiendo\b", r"mi recomendaci[oó]n\s+es\b", r"lo mejor (para ti|es)\b",
    r"la mejor opci[oó]n\s+(es|para ti)\b", r"yo\s+(compr(ar[ií]a|o)|vender[ií]a|invertir[ií]a)\b",
    r"\bte aconsejo\b",
    # Spanish — bare imperative commands (tú-form), not the infinitive
    r"^\s*(compra|vende|invierte)\s+\S",
    r"\b(compra|vende|invierte)\s+(ahora|ya|en)\s+\w",
    # English — direct prescriptive phrasing
    r"you should\s+(buy|sell|invest|choose|pick)", r"\bi recommend\b", r"my recommendation is\b",
    r"the best option (is|for you)\b", r"\bi would\s+(buy|sell|invest)\b", r"\bi'd\s+(buy|sell|invest)\b",
    r"^\s*(buy|sell|invest in)\s+\S",
]
_RECOMMENDATION_RE = re.compile("|".join(_RECOMMENDATION_PATTERNS), re.IGNORECASE | re.MULTILINE)


def check_recommendation_guard(text: str) -> list[str]:
    """Returns the list of matched prescriptive phrases found in `text`
    (empty list = clean). Mirrors ai_service.is_blatant_injection_attempt's
    pattern exactly: a compiled regex set as a deterministic, cheap,
    code-level check — not a replacement for the model-level guardrails
    already in SYSTEM_PROMPT_BASE (NIVEL 1), a second line of defense
    behind them.

    Deliberately conservative (see the patterns' comments above) — this is
    tuned to catch clear violations, not to police every sentence
    containing the word "comprar"/"buy". A false negative here just falls
    through to the existing prompt-level guardrails; a false positive would
    strip or flag legitimate educational analysis, which is the worse
    failure mode for a mentor product, so precision is prioritized over
    recall."""
    if not text:
        return []
    return [m.group(0) for m in _RECOMMENDATION_RE.finditer(text)]


def has_prescriptive_language(text: str) -> bool:
    return bool(check_recommendation_guard(text))


def strip_prescriptive_sentences(text: str) -> str:
    """Deterministic, no-LLM-call fallback for when a generated response
    fails the recommendation guard and a corrective regeneration either
    isn't worth the extra Claude call or also failed: removes just the
    sentence(s) containing the violation rather than discarding the whole
    response. Last-resort safety net, not the primary defense — the
    primary defenses are SYSTEM_PROMPT_BASE's NIVEL 1 instructions and,
    where a corrective regeneration is used (see simulate_whatif), the
    model fixing its own output."""
    if not check_recommendation_guard(text):
        return text
    # Split on sentence boundaries conservatively (period/exclamation/
    # question mark followed by whitespace) — good enough for a safety net,
    # not meant to be a full NLP sentence splitter.
    sentences = re.split(r"(?<=[.!?])\s+", text)
    kept = [s for s in sentences if not check_recommendation_guard(s)]
    result = " ".join(kept).strip()
    return result or "No puedo convertir esto en una recomendación personalizada — la decisión final es tuya."
