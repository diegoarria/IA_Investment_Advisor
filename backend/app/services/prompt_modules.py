"""Situational modules for Arthur's system prompt (COGS optimization, Sep 2026).

SYSTEM_PROMPT_BASE is ~40K tokens, and every Arthur message used to pay for
all of it — including ~25K tokens of protocols that only apply to specific
kinds of messages (the 11K-token "¿es buena inversión?" verdict format, the
capital-allocation protocol, the transaction-registration protocol, ...).

This module splits the base prompt by its own `## ` section headers into an
always-sent CORE plus situational MODULES, WITHOUT rewriting or removing a
single line of prompt text: `split_prompt()` is purely mechanical, and
tests/test_prompt_modules.py asserts core + modules reassemble to exactly the
original text. Any section whose header isn't listed in `_SECTION_MODULE`
stays in CORE, so a newly added prompt section is always sent by default.

Selection is deliberately generous (a false positive only costs tokens; a
false negative drops an instruction Arthur needed) and falls back to "send
everything" — the pre-optimization behavior — whenever the caller doesn't
supply the user's raw message.
"""
import re

# Header prefix -> module. Matched with str.startswith on the section header
# line. Anything unmatched is CORE.
_SECTION_MODULE: list[tuple[str, str]] = [
    ('## FORMATO OBLIGATORIO — "¿ES BUENA INVERSIÓN', "analysis"),
    ("## 📊 Scorecard", "analysis"),
    ("## ESTADOS FINANCIEROS — FORMATO OBLIGATORIO", "analysis"),
    ("## 🧭 CAPITAL ALLOCATION MENTOR", "capital"),
    ("## 🧭 DECISIONES DE VIDA GRANDES", "capital"),
    ("## 📝 REGISTRAR TRANSACCIONES", "transactions"),
    ("## 📰 CUANDO LA PREGUNTA ES SOBRE UNA NOTICIA", "news"),
    ("## ANÁLISIS DE CAÍDAS", "drawdown"),
    ("## CUANDO DETECTES INTENCIÓN DE COMPRAR O VENDER", "trade_intent"),
    ("## PRE-MORTEM DE DECISIONES", "trade_intent"),
    ("## CUANDO PIDAN ACCIONES SUBVALUADAS", "screener"),
    ("## CUANDO PIDAN SUGERENCIAS/IDEAS", "screener"),
]

ALL_MODULES = frozenset(m for _, m in _SECTION_MODULE)

_SECTION_SPLIT_RE = re.compile(r"(?m)^(?=## )")


def _module_for_section(section: str) -> str | None:
    header = section.lstrip("\n").split("\n", 1)[0]
    for prefix, module in _SECTION_MODULE:
        if header.startswith(prefix):
            return module
    return None


def split_prompt(base: str) -> tuple[str, dict[str, str]]:
    """Return (core_text, {module: text}). Section order is preserved within
    core and within each module; concatenating core + every module text in
    original section order reproduces `base` exactly (see tests)."""
    core_parts: list[str] = []
    modules: dict[str, list[str]] = {}
    for section in _SECTION_SPLIT_RE.split(base):
        if not section:
            continue
        module = _module_for_section(section)
        if module is None:
            core_parts.append(section)
        else:
            modules.setdefault(module, []).append(section)
    return "".join(core_parts), {m: "".join(parts) for m, parts in modules.items()}


# ── Selection ────────────────────────────────────────────────────────────────

_RE = lambda p: re.compile(p, re.IGNORECASE)  # noqa: E731

_ANALYSIS_RE = _RE(
    r"anal[ií]z\w*|an[aá]lisis|es buena (compra|inversi[oó]n)|buena (compra|inversi[oó]n)|vale la pena|"
    r"me conviene|\b(compro|entro a)\b|veredicto|qu[eé] opinas|opinas de|c[oó]mo ves|"
    r"estados? financieros?|balance|income statement|cash ?flow|flujo de caja|ingresos|utilidad|m[aá]rgenes?|"
    r"deuda de|roic|roe\b|dcf|valor intr[ií]nseco|fair value|valuaci[oó]n|valoraci[oó]n|fundament|"
    r"scorecard|moat|foso|earnings|resultados|p/e|\bper\b|"
    r"\banalyz\w*|what do you think|good buy|worth (it|investing)|deep dive|full analysis|thoughts on"
)
# A bare ticker/company mention that is only asking for a quote doesn't need
# the 11K-token verdict format — but only if NO analysis wording is present.
_QUOTE_ONLY_RE = _RE(
    r"\bprecio\b|cotiza|cu[aá]nto (est[aá]|vale|cuesta)|c[oó]mo va\b|c[oó]mo est[aá]\b|price of|how is .{1,20} doing|\bquote\b"
)
_CAPITAL_WORDS = (
    r"dinero|ahorr\w*|deuda|pr[eé]stamo|cr[eé]dito|hipoteca|casa\b|inmueble|departamento|negocio|emprend\w*|"
    r"empleo|trabajo|sueldo|salario|renunci\w*|jubilaci|retiro|herencia|bono\b|capital|liquidez|efectivo|"
    r"fondo de emergencia|cetes|bonos|tasa|invertir|inversi[oó]n|inversiones|"
    r"qu[eé] hago|que hago|c[oó]mo empiezo|por d[oó]nde|"
    r"\bmeta\b|objetivo|plan financiero|patrimonio|ingresos|gastos|"
    r"money|savings?|debt|loan|mortgage|business|\bjob\b|salary|retire\w*|inheritance|emergency fund|"
    r"\binvest\w*|where to put|what should i do|net worth|financial plan"
)
_CAPITAL_AMOUNTS = r"\$\s?\d|\d\s?(mil|k)\b|\d+\s?(usd|d[oó]lares|dolares|pesos|mxn|eur)"
_CAPITAL_RE = _RE(_CAPITAL_WORDS + "|" + _CAPITAL_AMOUNTS)
_CAPITAL_WORDS_RE = _RE(_CAPITAL_WORDS)
# Past-tense "I already did this trade" reports — the transactions protocol
# is what they need, not the 11K verdict format or the capital-allocation
# protocol that a ticker + dollar amount would otherwise pull in.
_TRADE_REPORT_RE = _RE(r"compr[eé]\b|compr[eé]\w*|vend[ií]\w*|\bbought\b|\bsold\b|acabo de (comprar|vender)|registr\w*")
_FUTURE_INTENT_RE = _RE(r"voy a|quiero|deber[ií]a|debo|\bshould\b|thinking (of|about)|pienso|planeo|me conviene")
_TXN_RE = _RE(
    r"compr[eéó]\w*|vend[ií]\w*|acabo de|\bya (compr|vend)|bought|\bsold\b|registr\w*|transacci\w*|operaci[oó]n|"
    r"mis (compras|ventas|operaciones)|posici[oó]n|portafolio|portfolio|acciones? de|\bshares?\b|broker|"
    r"ejecut\w*|confirm\w*|cancel\w*|elimin\w*|borr\w*|corrig\w*|correg\w*|actualiz\w*|modific\w*|agreg\w*|"
    r"a[ñn]ad\w*|quit\w*|\bdelete\b|\bremove\b|\bupdate\b|\badd\b|rebalanc\w*|"
    r"^\s*(s[ií]|si|confirmo|ok|okay|dale|adelante|correcto|yes|yep|confirm|no)\b[\s.!¡]*$"
)
_NEWS_RE = _RE(
    r"noticia|news|\bpas[oó]\b|qu[eé] (est[aá] pasando|pasa|ha pasado)|por qu[eé] (subi|baj|cay|rebot)|"
    r"earnings|reporte|resultados|anunci\w*|evento|\bhoy\b|esta semana|este mes|rally|crash|\bfed\b|"
    r"inflaci|\bcpi\b|guerra|arancel|tarifa|\btoday\b|this week|announce\w*|what happened|why (did|is)"
)
_DRAWDOWN_RE = _RE(
    r"cay[oó]|ca[ií]da|baj[oó]|bajando|bajan|p[eé]rdida|perdiendo|vender|vendo|salir|salgo|p[aá]nico|panic|"
    r"drawdown|correcci[oó]n|crash|dropp\w*|\bdown\b|sell\w*|red\b|rojo|hundi\w*|desplom\w*"
)
_TRADE_INTENT_RE = _RE(
    r"compr\w*|vend\w*|\bentr(o|ar)\b|\bsal(go|ir)\b|invertir|apost\w*|all.?in|me conviene|\bbuy\w*|\bsell\w*|\binvest\w*|"
    r"mantener|\bhold\b|aumentar|reducir|diversific\w*"
)
_SCREENER_RE = _RE(
    r"subvaluad|infravalorad|barat[ao]s?|sugi\w*|recomi\w*|ideas?\b|screener|oportunidad\w*|undervalued|cheap|"
    r"suggest\w*|recommend\w*|what should i buy|qu[eé] compro|qu[eé] (empresas|acciones)|mejores acciones|best stocks?"
)
_PENDING_HINT_RE = _RE(
    r"¿confirmas|confirma cuando|¿todo correcto|antes de (aplicarlo|eliminarlo|registrarlo)|para que (lo )?confirmes|"
    r"do you confirm|confirm when|before I (apply|delete)|PENDING_ID|propuesta|proposal"
)


def select_modules(
    raw_message: str | None,
    history: list | None = None,
    *,
    has_ticker: bool = False,
    has_images: bool = False,
) -> frozenset[str]:
    """Which situational modules this turn needs.

    `raw_message` is the user's own text (NOT the enriched message with
    injected market context — that would make every module match). When it's
    None/empty, or images are attached (a screenshot can be about anything),
    returns ALL modules: identical to the pre-optimization behavior.

    Trigger text is the current message plus the previous user message, so a
    terse follow-up ("y si mejor lo vendo?") keeps its topic's module. Any
    recent assistant turn that asked the user to confirm a portfolio action
    forces the transactions module, so a bare "sí" always reaches the
    protocol that explains what to do with it.
    """
    if not raw_message or not raw_message.strip() or has_images:
        return ALL_MODULES

    history = history or []
    user_msgs = [getattr(m, "content", "") or "" for m in history if getattr(m, "role", "") == "user"]
    prev_user = user_msgs[-1] if user_msgs else ""
    text = f"{raw_message}\n{prev_user}"

    selected: set[str] = set()
    is_report = bool(_TRADE_REPORT_RE.search(text)) and not _FUTURE_INTENT_RE.search(raw_message)
    explicit_analysis = bool(_ANALYSIS_RE.search(text))

    # Analysis format: explicit analysis wording, or a company/ticker mention
    # that isn't merely a quote request or a report of a trade already done.
    if explicit_analysis or (has_ticker and not is_report and not _QUOTE_ONLY_RE.search(raw_message)):
        selected.add("analysis")
    if (_CAPITAL_WORDS_RE.search(text) if is_report else _CAPITAL_RE.search(text)):
        selected.add("capital")
    if _TXN_RE.search(raw_message) or _TXN_RE.search(prev_user):
        selected.add("transactions")
    if has_ticker and re.search(r"\d", raw_message):
        selected.add("transactions")  # "3 acciones de Google a $343" style reports
    for m in reversed(history):
        if getattr(m, "role", "") == "assistant":
            if _PENDING_HINT_RE.search(getattr(m, "content", "") or ""):
                selected.add("transactions")
            break
    if _NEWS_RE.search(text):
        selected.add("news")
    if _DRAWDOWN_RE.search(text):
        selected.add("drawdown")
    if _TRADE_INTENT_RE.search(text) and not is_report:
        selected.add("trade_intent")
    if _SCREENER_RE.search(text):
        selected.add("screener")
    return frozenset(selected)
