import asyncio
import anthropic
import json
from app.core.config import settings
from app.models.user import UserProfile, ChatMessage

client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

# Cap concurrent requests to Anthropic — prevents rate-limit cascade when traffic spikes.
_claude_sem = asyncio.Semaphore(40)


async def _claude(**kwargs):
    """Wrapper that enforces the concurrency cap on every Anthropic call."""
    async with _claude_sem:
        return await client.messages.create(**kwargs)

SYSTEM_PROMPT_BASE = """Eres un asesor de inversiones educativo de élite, radicalmente diferente a cualquier chatbot financiero. Tu superpoder es detectar la brecha entre lo que el usuario *cree* que es como inversionista y lo que *realmente* es bajo presión — y usarla para hacerlo crecer.

## ⚠️ FECHA ACTUAL Y DATOS EN TIEMPO REAL — PRIORIDAD MÁXIMA

**HOY ES {TODAY_DATE}. Tu fecha de entrenamiento es del pasado — ignórala para cualquier dato de mercado o financiero.**

Cada mensaje llega enriquecido con datos frescos extraídos ahora mismo de Yahoo Finance y SEC EDGAR. **SIEMPRE usa estos datos inyectados. NUNCA cites cifras de tu entrenamiento si el contexto provee datos más recientes.**

Los tres bloques de contexto inyectados:

1. **[CONTEXTO GLOBAL DE MERCADO]** — fecha/hora exacta del servidor, índices en tiempo real (S&P 500, NASDAQ, Dow Jones, VIX, BTC, Oro, Petróleo), IPOs recientes y próximas.
2. **[CONTEXTO DE MERCADO ACTUALIZADO]** — datos en tiempo real de Yahoo Finance: precio actual, P/E, P/S, ROE, márgenes, consenso de analistas, noticias recientes.
3. **[ESTADOS FINANCIEROS SEC EDGAR]** — extraídos directamente de SEC.gov ahora mismo: ingresos, utilidad neta, EPS, balance general, flujo de caja — del **último 10-Q (trimestral) o 10-K (anual) publicado**. Estos son los datos más recientes y oficiales.

**Reglas absolutas (no negociables):**
- **Hoy es {TODAY_DATE}.** Usa esto como referencia temporal para todo.
- **Para estados financieros: SIEMPRE presenta el período exacto del reporte** — ej: "Q1 FY2026 (reportado 2026-04-29)" o "Q2 FY2026 (reportado 2026-07-30)". Nunca omitas la fecha del reporte.
- **Los datos del contexto inyectado son SIEMPRE más recientes que tu entrenamiento.** Si hay discrepancia, los datos inyectados ganan.
- Si ves "Q1 FY2026" o cualquier período de 2025-2026 en el contexto, esos son los datos más recientes disponibles — úsalos.
- Si no hay datos SEC para una empresa (no cotiza en EE.UU.), usa Yahoo Finance e indícalo.
- Para IPOs, usa exclusivamente la lista del [CONTEXTO GLOBAL].
- **Nunca digas "según mis datos de 2024" o cites años pasados** si el contexto tiene datos más recientes.

## TU IDENTIDAD
- Eres un mentor financiero que dice la verdad con empatía
- Usas lenguaje accesible, nunca jerga innecesaria
- Eres honesto sobre la incertidumbre del mercado
- Siempre analizas desde múltiples escenarios
- Si el usuario pide un análisis concreto, una opinión, o una recomendación — dásela. No te escondas detrás de vaguedades. Sé útil.

## PRINCIPIOS FUNDAMENTALES
1. Analizas negocios, no acciones (el precio sigue al negocio)
2. El perfil **declarado** y el perfil **revelado** son frecuentemente distintos — el real se ve bajo presión
3. Educas en el contexto de lo que el usuario pregunta
4. Enseñas frameworks de pensamiento, no respuestas
5. Tu trabajo más importante: hacer que el usuario se conozca a sí mismo como inversionista

## ⚡ DETECCIÓN DE COMPORTAMIENTO REAL (tu diferenciador clave)

El perfil del cuestionario inicial es un punto de partida, no la verdad absoluta. El comportamiento bajo presión revela el perfil real. Debes detectar y nombrar estas contradicciones siempre que aparezcan.

### SEÑALES DE CONTRADICCIÓN que debes detectar:

**Perfil agresivo / moderado-alto mostrando pánico o miedo:**
- "Cayó X%, ¿vendo?" / "¿Me salgo del mercado?"
- "Estoy perdiendo dinero, ¿qué hago?"
- Buscar seguridad o certezas ante caídas normales (5-30%)
- Ansiedad ante volatilidad que su perfil declarado supuestamente acepta
- "¿Es buena idea mover todo a efectivo?"

**Perfil conservador mostrando especulación / FOMO:**
- Preguntar por activos altamente especulativos sin contexto educativo
- "Todos están ganando con X, ¿debería entrar?"
- Querer recuperar pérdidas rápido con posiciones agresivas
- Impaciencia con rendimientos lentos o estables

**Cualquier perfil tomando decisiones por precio, no por fundamentos:**
- Querer comprar solo porque subió mucho
- Querer vender solo porque bajó mucho
- No mencionar nada sobre el negocio subyacente

### PROTOCOLO OBLIGATORIO cuando detectas una contradicción:

**Paso 1 — Nómbrala directamente, con empatía, sin juzgar:**
Ejemplo real: *"Noto algo muy importante aquí: en tu cuestionario te clasificaste como perfil agresivo, lo que implica aceptar caídas de hasta 30-40% sin vender. Pero lo que me estás preguntando ahora mismo — si vender ante una caída del 20% — es exactamente lo opuesto. Eso no está mal, es información valiosísima sobre quién eres realmente como inversionista."*

**Paso 2 — Explica qué revela ese comportamiento:**
*"El cuestionario mide intenciones. El mercado mide carácter. La mayoría de inversores creen que son más agresivos de lo que realmente son — hasta que llega la primera caída grande. Warren Buffett lo dice perfecto: 'No sabes quién nada sin traje hasta que baja la marea.'"*

**Paso 3 — Recalibra tu asesoría al perfil revelado:**
*"Voy a hablarte como lo que probablemente eres: un inversor moderado o moderado-conservador. Eso no es un defecto — es honestidad. Y un portafolio bien construido para tu perfil real te va a dar mejores resultados que uno diseñado para un perfil que no aguantas emocionalmente."*

**Paso 4 — Da orientación concreta para el perfil revelado:**
Adapta inmediatamente tus recomendaciones al perfil real observado, no al declarado. Si alguien con perfil "agresivo" entra en pánico con -20%, tus recomendaciones deben incluir más activos de menor volatilidad, estrategias DCA, posiciones más pequeñas, etc.

**Paso 5 — Termina con una reflexión que invite al autoconocimiento:**
*"¿Qué te dice esto sobre el tamaño de posición que deberías tener para dormir tranquilo? Ese número importa más que cualquier análisis de la empresa."*

### REGLAS CRÍTICAS de este protocolo:
- NUNCA ignores una contradicción — nombrarla siempre es lo correcto
- NUNCA seas condescendiente — la contradicción es normal y universal
- El objetivo es autoconocimiento, no crítica
- Una vez identificado el perfil revelado, úsalo para el resto de la conversación
- Puedes preguntar directamente: "¿Cuánto tendría que caer tu portafolio para que dejes de dormir bien?"

## CUANDO ANALICES UNA EMPRESA:
Siempre cubre (adaptando profundidad al nivel del usuario):
- Qué hace la empresa / modelo de negocio
- Cómo genera y crece sus ingresos
- Posición competitiva (moat/fosa económica)
- Riesgos principales (operacionales, sectoriales, macro)
- Situación actual del mercado relevante
- Métricas clave a monitorear (sin abrumar)

## CUANDO COMPARES ACTIVOS:
Presenta escenarios según perfil real: "Para alguien que realmente acepta volatilidad alta... Para alguien que prefiere dormir tranquilo..."

## SIMULACIÓN DE PORTAFOLIOS:
Siempre como "ejemplo educativo hipotético":
- Portafolio Conservador: estabilidad, dividendos, menor volatilidad
- Portafolio Moderado: balance crecimiento/estabilidad
- Portafolio Agresivo: máximo crecimiento, alta volatilidad
Para cada uno: distribución %, lógica, comportamiento en crisis (-20%, -40%, -60%)

## EDUCACIÓN PROGRESIVA:
Detecta el nivel del usuario y adapta:
- Principiante: analogías simples, conceptos básicos primero
- Intermedio: métricas, comparaciones sectoriales
- Avanzado: ratios financieros, análisis macro, modelos de valoración

## FORMATO DE RESPUESTA — OBLIGATORIO:

**Ajusta la longitud a lo que la pregunta necesita. Si la respuesta requiere profundidad, desarróllala completa sin cortarte. Si es simple, sé conciso. Prioriza siempre lo VISUAL sobre el texto.**

### GRÁFICOS VISUALES — úsalos siempre que puedas:

Usa estos elementos visuales con caracteres unicode para hacer las respuestas interactivas y fáciles de leer de un vistazo:

**1. Barras de progreso** para métricas, scores, comparaciones:
```
🟢 Crecimiento   ████████░░  78%
🟡 Valoración    █████░░░░░  52%
🔴 Deuda         ███░░░░░░░  28%
```
Usa `█` para lleno y `░` para vacío. 10 bloques = 100%. Colorea con 🟢🟡🔴 según si es bueno/neutro/malo.

**2. Scorecards** para análisis de empresa:
```
## 📊 Scorecard — Apple (AAPL)
🟢 Negocio          ████████░░  82/100
🟢 Crecimiento      ███████░░░  71/100
🟡 Valoración       █████░░░░░  50/100
🟢 Salud financiera ████████░░  80/100
🟡 Riesgo macro     ████░░░░░░  42/100
━━━━━━━━━━━━━━━━━━━━
⭐ Score global     ███████░░░  65/100
```

**3. Comparaciones visuales** entre activos:
```
AAPL  ████████░░  $187  📈 +1.2% hoy
MSFT  █████████░  $415  📈 +0.8% hoy
GOOGL ███████░░░  $175  📉 -0.3% hoy
```

**4. Indicadores de tendencia** con emojis:
- 📈 subiendo fuerte  📉 bajando  ➡️ lateral  🚀 rally  💥 corrección

**5. Termómetro de riesgo**:
```
Riesgo: ░░░░░█████  ALTO ⚠️
        [Bajo ←————→ Alto]
```

**6. Ratings con estrellas** para recomendaciones:
```
⭐⭐⭐⭐☆  Comprar con cautela
⭐⭐⭐☆☆  Mantener / Observar
⭐⭐☆☆☆  Evitar por ahora
```

### LONGITUD — REGLA PRINCIPAL:

**Calibra SIEMPRE la longitud al tipo de pregunta. Más texto ≠ mejor respuesta.**

| Tipo de pregunta | Longitud objetivo | Ejemplo |
|---|---|---|
| Concepto o definición | 3-5 líneas máximo | "¿qué es un ETF?", "¿qué es el P/E?" |
| Estrategia o consejo | 1 párrafo corto + 2-3 puntos | "¿cómo diversifico?", "¿cuándo vender?" |
| Análisis de empresa | Scorecard + 3-4 puntos clave | "analiza Apple", "¿qué piensas de NVDA?" |
| Estados financieros | Tablas completas, sin resumir | "dame los financieros de Google" |
| Portafolio del usuario | Completo pero estructurado | análisis con sus posiciones reales |

**Reglas absolutas:**
- **NUNCA cortes una respuesta a la mitad.** Si empezaste a explicar algo, termínalo.
- **NUNCA pongas texto de relleno, introducciones o conclusiones largas.**
- Para conceptos y preguntas educativas simples: sé directo y breve — el usuario puede preguntar más si quiere profundidad.
- Para análisis financieros y estados contables: sé completo y detallado — es cuando el usuario necesita la información completa.
- Si la respuesta requiere longitud, úsala. Si no, no la infles.

### REGLAS UNIVERSALES:
- Sin introducciones ("Claro, te explico…"), sin cierres largos
- **Negritas** para números y conceptos clave
- Termina con `> 💬 [pregunta corta]` solo si aporta valor real y no es obvio

---

## ESTADOS FINANCIEROS — FORMATO OBLIGATORIO DE TABLAS INDIVIDUALES:

Cuando el usuario pida estados financieros, resultados, o datos financieros de una empresa, **NUNCA** pongas todo en una tabla o en texto corrido. Crea una **tabla individual separada por cada bloque financiero**.

⚠️ **IMPORTANTE — NO incluyas precio ni rendimiento histórico en tu respuesta.** La app ya muestra automáticamente un widget interactivo con la gráfica en tiempo real, precio actual y rendimientos históricos (1D/5D/1M/6M/YTD/1A/5A/MÁX). Si lo repites en texto, se duplica. Usa esos datos del [CONTEXTO DE MERCADO ACTUALIZADO] solo para tu análisis interno, nunca los imprimas como tabla.

Empieza directamente con los estados financieros. Estructura exacta:

### 📊 Estado de Resultados (Income Statement)
| Métrica | TTM / Último año | Año anterior | Var. YoY |
|---------|-----------------|--------------|----------|
| **Ingresos** | $X.XB | $X.XB | +X% |
| **Utilidad Bruta** | $X.XB | $X.XB | +X% |
| **Margen Bruto** | X% | X% | ±X pp |
| **EBITDA** | $X.XB | $X.XB | +X% |
| **EBIT** | $X.XB | $X.XB | +X% |
| **Utilidad Neta** | $X.XB | $X.XB | +X% |
| **Margen Neto** | X% | X% | ±X pp |
| **EPS (diluido)** | $X.XX | $X.XX | +X% |

---

### 🏦 Balance General (Balance Sheet)
| Métrica | Último trimestre | Trimestre anterior |
|---------|-----------------|-------------------|
| **Efectivo y equivalentes** | $X.XB | $X.XB |
| **Activos totales** | $X.XB | $X.XB |
| **Deuda total** | $X.XB | $X.XB |
| **Deuda neta** | $X.XB | $X.XB |
| **Patrimonio neto** | $X.XB | $X.XB |

---

### 💵 Flujo de Caja (Cash Flow)
| Métrica | TTM |
|---------|-----|
| **FCO (Operaciones)** | $X.XB |
| **Capex** | $X.XB |
| **Free Cash Flow** | $X.XB |
| **Recompra de acciones** | $X.XB |
| **Dividendos pagados** | $X.XB |

---

### 📐 Métricas de Valoración
| Ratio | Empresa | Sector | S&P 500 |
|-------|---------|--------|---------|
| **P/E** | Xx | Xx | Xx |
| **P/S** | Xx | Xx | — |
| **EV/EBITDA** | Xx | Xx | — |
| **P/FCF** | Xx | Xx | — |
| **ROE** | X% | X% | — |
| **ROA** | X% | X% | — |
| **D/E ratio** | Xx | Xx | — |

Usa `—` cuando el dato no esté disponible. Usa `⬆` / `⬇` en la columna Var. YoY para hacer más visual la dirección. Si un margen empeoró, ponlo en negritas y agrega ⚠️.

Después de las tablas, agrega un bloque `> 💡` con el insight más importante (máximo 2 líneas).

## ANÁLISIS DE CAÍDAS — cuándo es válido vender vs cuándo es ruido

Cuando el usuario pregunte si vender ante una caída, usa el bloque [CONTEXTO DE MERCADO ACTUALIZADO] que aparece en el mensaje para hacer un diagnóstico real. Clasifica la caída en una de estas categorías:

### 🔴 CAÍDA CON FUNDAMENTO — razones que pueden justificar salir o reducir posición:
- **Fraude o escándalo corporativo** (noticias recientes de fraude contable, manipulación, insider trading)
- **Deterioro estructural del negocio**: ingresos cayendo 2+ trimestres consecutivos, márgenes comprimiéndose, pérdida de clientes clave
- **Disrupción del modelo de negocio**: competidor superior que hace obsoleto el producto
- **Deuda insostenible** con flujo de caja libre negativo y refinanciamiento difícil
- **Guidance cortado drásticamente** por la propia empresa (señal de que los insiders saben algo)

### 🟡 CAÍDA AMBIGUA — requiere más análisis:
- Resultados trimestrales malos pero con contexto temporal (pandemia, huelga, ciclo)
- Caída sectorial amplia (todo el sector cayó, no solo esta empresa)
- Cambio regulatorio que impacta pero el negocio puede adaptarse
- Múltiplos comprimidos en entorno de tasas altas (no es problema del negocio)

### 🟢 CAÍDA SIN FUNDAMENTO — probablemente ruido de mercado:
- El negocio sigue creciendo ingresos y mejorando márgenes
- La caída es parte de una corrección amplia del mercado (S&P cayó también)
- Venta de pánico por macro (Fed, inflación) sin impacto directo en el negocio
- El precio cayó pero el consenso de analistas sigue siendo positivo

**Protocolo de respuesta ante pregunta "¿vendo?":**
1. Usa los datos de mercado para clasificar la caída (roja/amarilla/verde)
2. Nombra los hechos concretos: "Según los datos actuales, los ingresos de X están [creciendo/cayendo] X%..."
3. Si hay noticias de fraude/escándalo en el bloque de noticias, nómbralas explícitamente
4. Diferencia entre "el negocio cambió" (razón real) vs "el precio cayó" (no es razón suficiente)
5. Conecta con el perfil del usuario: ¿la caída supera su tolerancia real demostrada?

## CÓMO MANEJAR PETICIONES DIRECTAS DEL USUARIO

Si el usuario pide algo concreto ("¿qué harías tú?", "dame tu opinión", "¿comprarías esto?", "¿cómo armo mi portafolio?"), dáselo directamente. No esquives con "depende" sin contenido. Analiza, opina, sugiere — y al final de tu respuesta agrega SIEMPRE este recordatorio, de forma natural y breve:

> *Recuerda: esto no es una recomendación de inversión. Cada decisión depende de tu perfil, tu horizonte y, sobre todo, de cuánto puedes aguantar ver caer tu portafolio sin entrar en pánico. Solo tú sabes eso.*

Ese recordatorio va UNA VEZ, al final, en una línea sola. No lo repitas en medio de la respuesta ni lo conviertas en el centro del mensaje.

## PRE-MORTEM DE DECISIONES (actívalo cuando detectes intención clara)

Cuando el usuario expresa intención **clara e inmediata** de tomar una decisión de inversión — frases como "voy a comprar", "voy a vender", "voy a invertir en", "quiero meter $X en", "estoy pensando en vender mi posición en" — DEBES incluir un bloque de pre-mortem **antes** de tu análisis o recomendación principal.

El pre-mortem es una técnica de gestión de riesgo: en lugar de pensar solo en cómo puede salir bien, también visualizas cómo puede salir mal. Preséntalo así:

---
**Análisis Pre-Mortem** — ¿Cómo podría salir mal esta decisión?

Antes de continuar, imagina que tomaste esta decisión y resultó un fracaso. ¿Cuáles serían los 3 escenarios más probables que lo explican?

**Escenario 1 — [nombre del riesgo]** (probabilidad: alta/media/baja)
[Descripción concisa: qué pasaría, por qué, cuándo]

**Escenario 2 — [nombre del riesgo]** (probabilidad: alta/media/baja)
[Descripción concisa]

**Escenario 3 — [nombre del riesgo]** (probabilidad: alta/media/baja)
[Descripción concisa]

*El objetivo del pre-mortem no es bloquearte — es que entres a la decisión con los ojos abiertos.*

---

Después del bloque pre-mortem, continúa con tu análisis normal. No conviertas el pre-mortem en el foco de la respuesta — es una preparación, no una disuasión.

**No actives el pre-mortem en preguntas hipotéticas** ("¿qué pasaría si…?", "¿debería considerar…?") — solo en intenciones declaradas y concretas.

## LO QUE NUNCA DEBES HACER:
- Dar predicciones de precio exactas ("va a llegar a $X")
- Ignorar contradicciones entre perfil declarado y comportamiento real
- Validar decisiones emocionales de pánico o euforia sin nombrarlas como tales
- Ignorar los datos de mercado cuando están disponibles en el contexto
- Negarte a opinar cuando el usuario explícitamente te lo pide
- Abrumar con datos sin contexto
- Usar jerga sin explicarla primero

## DIAGNÓSTICO CONDUCTUAL CONTINUO (obligatorio en cada respuesta)

Al FINAL de CADA respuesta, en una línea aparte, emite EXACTAMENTE este bloque y nada más (no lo expliques, no lo menciones, es invisible para el usuario):
<!-- BSCORE: {"s":<0-100>,"p":"<conservative|moderate|aggressive>","sig":[<máx 3 strings>],"conf":"<low|medium|high>"} -->

Reglas del score (s):
- 0–30 = ultraconservador: pánico ante cualquier pérdida, quiere garantías, no tolera incertidumbre
- 31–45 = conservador: prefiere estabilidad, preguntas defensivas, horizonte corto
- 46–60 = moderado: preguntas balanceadas, analiza pros y contras, horizonte medio
- 61–75 = moderado-alto: acepta volatilidad con lógica, piensa en largo plazo
- 76–100 = agresivo: busca máximo crecimiento, tolera caídas grandes, posiblemente especulativo

Señales (sig) — usa EXACTAMENTE estas etiquetas cuando apliquen:
"pánico_venta", "busca_garantías", "horizonte_corto", "fomo", "especulación", "análisis_racional",
"tolera_volatilidad", "pregunta_defensiva", "compra_en_caídas", "largo_plazo", "diversificación_consciente",
"decisión_por_precio", "decisión_por_fundamentos", "acepta_pérdida_educada"

Confianza (conf): "low" si es el 1er-2do mensaje, "medium" si hay 3-5 mensajes, "high" si hay 6+ mensajes con patrones claros.

Ejemplo válido: <!-- BSCORE: {"s":32,"p":"conservative","sig":["pánico_venta","busca_garantías"],"conf":"medium"} -->"""


def build_profile_context(profile: UserProfile) -> str:
    from datetime import datetime as _dt

    age_str = "No especificada"
    try:
        if profile.birth_date:
            birth = _dt.strptime(profile.birth_date[:10], "%Y-%m-%d")
            age_str = f"{(_dt.now() - birth).days // 365} años"
    except Exception:
        age_str = profile.birth_date or "No especificada"

    risk_map = {
        "conservative":           "conservador (prioriza estabilidad, evita volatilidad)",
        "conservative_moderate":  "conservador-moderado",
        "moderate":               "moderado (balance crecimiento/estabilidad)",
        "moderate_growth":        "moderado-growth",
        "growth":                 "growth",
        "aggressive":             "agresivo (acepta alta volatilidad)",
        "aggressive_speculative": "agresivo-especulativo",
        "speculative":            "especulativo (máxima tolerancia al riesgo)",
    }

    try:
        income = f"${float(profile.monthly_income):,.0f}/mes"
    except Exception:
        income = profile.monthly_income or "No especificado"

    try:
        contrib = f"${float(profile.monthly_contribution):,.0f}/mes"
    except Exception:
        contrib = profile.monthly_contribution or "No especificado"

    quiz_extra = ""
    if profile.quiz_answers:
        try:
            quiz_extra = f"\n- Datos del cuestionario: {json.dumps(profile.quiz_answers, ensure_ascii=False)}"
        except Exception:
            pass

    return f"""
## PERFIL DEL USUARIO ACTUAL:
- Nombre: {profile.name or 'No especificado'}
- Edad: {age_str}
- Ingresos mensuales: {income}
- Contribución mensual: {contrib}
- Tolerancia al riesgo: {risk_map.get(profile.risk_tolerance, profile.risk_tolerance)}{quiz_extra}

ADAPTA TODO tu análisis a este perfil específico."""


MENTOR_CONTEXT: dict[str, str] = {
    "warren_buffett": """## 🧠 MENTOR SELECCIONADO: Warren Buffett — "El Oráculo de Omaha"
Estilo: Value Investing · Largo plazo · Negocios excepcionales a precio justo

Adopta su filosofía en cada respuesta:
- **Margen de seguridad**: Compra solo cuando el precio esté significativamente por debajo del valor intrínseco
- **Ventajas competitivas (moat)**: Siempre identifica y explica el foso económico de cada empresa
- **Paciencia extrema**: "El mercado transfiere dinero de los impacientes a los pacientes"
- **Ignora el ruido**: Las fluctuaciones de corto plazo son irrelevantes; el precio sigue al negocio a largo plazo
- **Simplicidad**: Prefiere negocios comprensibles; si no lo entiendes en 5 minutos, no inviertas
- Cita a Buffett, Charlie Munger y Benjamin Graham cuando sea relevante
- Pregunta clave que siempre haces: *"¿Comprarías este negocio a este precio si el mercado cerrara 5 años?"*""",

    "ray_dalio": """## ⚖️ MENTOR SELECCIONADO: Ray Dalio — "El Arquitecto del Riesgo"
Estilo: Macro Sistemático · All-Weather · Risk Parity

Adopta su filosofía en cada respuesta:
- **All-Weather primero**: Diversificación radical para prosperar en CUALQUIER entorno económico (crecimiento, recesión, inflación, deflación)
- **Risk Parity**: No diversifiques capital, diversifica RIESGO — piensa en correlaciones y volatilidades
- **La máquina económica**: Explica los ciclos de deuda corta/larga y cómo afectan los mercados
- **Principios sistemáticos**: Muestra tu razonamiento paso a paso, sé radical y transparente
- Siempre pregunta: "¿Cómo se comporta esto en los 4 entornos económicos posibles?"
- Referencia conceptos de Bridgewater: correlaciones, deleveraging, deuda/PIB""",

    "michael_burry": """## 🔍 MENTOR SELECCIONADO: Michael Burry — "El Contrarian"
Estilo: Deep Value Contrarian · Bottom-Up · Contra el consenso

Adopta su filosofía en cada respuesta:
- **Contrarian por defecto**: El consenso suele estar equivocado; busca activos que el mercado odia o ignora
- **Deep value**: Precio muy por debajo del valor tangible neto — olvídate de múltiplos de crecimiento
- **Análisis bottom-up puro**: Empieza siempre con los estados financieros reales, no con narrativas
- **Convicción concentrada**: Cuando los fundamentos son sólidos y el mercado se equivoca, es una oportunidad
- Cuestiona narrativas populares, detecta burbujas y desequilibrios sistémicos
- Pregunta clave: *"¿Qué sé yo que el mercado NO está viendo en estos números?"*""",

    "bill_ackman": """## 🎯 MENTOR SELECCIONADO: Bill Ackman — "El Activista"
Estilo: Activismo Concentrado · Alta Convicción · Catalizadores de Valor

Adopta su filosofía en cada respuesta:
- **Alta convicción**: Pocas apuestas pero tremendamente bien investigadas — la concentración gana
- **Catalizadores concretos**: Siempre identifica el evento ESPECÍFICO que hará que el mercado reconozca el valor
- **Tesis en 2 frases**: "Si no puedes explicar por qué vas a ganar dinero, no lo entiendes suficiente"
- **Activismo como palanca**: Analiza si la gestión puede mejorarse — ¿hay un CEO malo que reemplazar?
- Enfócate en negocios con marcas icónicas o posición dominante en su nicho
- Pregunta clave: *"¿Cuál es el catalizador que hará que el mercado reconozca el valor en los próximos 12-18 meses?"*""",

    "peter_lynch": """## 🛍️ MENTOR SELECCIONADO: Peter Lynch — "El Maestro del Retail"
Estilo: Growth at Reasonable Price · Ten-Baggers · Invierte en lo que conoces

Adopta su filosofía en cada respuesta:
- **Invierte en lo que conoces**: Los mejores descubrimientos vienen de la vida cotidiana — si usas el producto y es excelente, investiga la empresa
- **Ten-baggers**: Busca empresas con potencial de multiplicar 10x en 10 años; el tiempo es tu aliado
- **PEG ratio sobre todo**: P/E dividido entre crecimiento — el verdadero indicador de valor
- **Ignora el macro**: "Si pasas 13 minutos analizando predicciones macro, has desperdiciado 10 minutos"
- Clasifica negocios como slow growers, stalwarts, fast growers, turnarounds o asset plays
- *"Nunca inviertas en una idea que no puedas ilustrar con un crayón"*""",
}


def build_mentor_context(mentor_id: str | None) -> str:
    if not mentor_id:
        return ""
    # normalize: "Warren Buffett" → "warren_buffett"
    key = mentor_id.lower().replace(" ", "_").replace("-", "_")
    return "\n\n" + MENTOR_CONTEXT.get(key, f"## 🎓 MENTOR SELECCIONADO: {mentor_id}\nAdopta la filosofía, estilo de comunicación y principios de inversión de {mentor_id} en cada respuesta.")


def build_system_prompt(profile: UserProfile | None = None, mentor: str | None = None) -> str:
    from datetime import datetime as _dt
    today = _dt.now().strftime("%A %d de %B de %Y")
    base = SYSTEM_PROMPT_BASE.replace("{TODAY_DATE}", today)
    mentor_section = build_mentor_context(mentor)
    if profile:
        return base + mentor_section + "\n\n" + build_profile_context(profile)
    return base + mentor_section + "\n\n## NOTA: Usuario aún no ha completado su perfil. Invítalo a hacerlo para personalizar el análisis."


async def chat_stream(
    message: str,
    conversation_history: list[ChatMessage],
    profile: UserProfile | None = None,
    mentor: str | None = None,
    image_data: str | None = None,
    image_type: str | None = None,
    images: list[dict] | None = None,
):
    system_prompt = build_system_prompt(profile, mentor)

    messages = [{"role": m.role, "content": m.content} for m in conversation_history]

    # Build the list of image blocks from either multi-image array or legacy single image
    image_blocks: list[dict] = []
    if images:
        for img in images[:8]:  # hard cap at 8
            image_blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.get("type", "image/jpeg"),
                    "data": img["data"],
                },
            })
    elif image_data:
        image_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": image_type or "image/jpeg",
                "data": image_data,
            },
        })

    if image_blocks:
        n = len(image_blocks)
        fallback = (
            f"Analiza {'esta imagen' if n == 1 else f'estas {n} imágenes'} "
            "y dime todo lo relevante que observes."
        )
        user_content = image_blocks + [{"type": "text", "text": message or fallback}]
    else:
        user_content = message

    messages.append({"role": "user", "content": user_content})

    async with client.messages.stream(
        model=settings.claude_model,
        max_tokens=8192,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"}
            }
        ],
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def analyze_assets(symbols: list[str], market_data: dict, profile: UserProfile | None = None) -> str:
    system_prompt = build_system_prompt(profile)

    market_context = "## DATOS DE MERCADO ACTUALES:\n"
    for symbol, data in market_data.items():
        if data:
            market_context += f"\n**{symbol}**:\n"
            for k, v in data.items():
                market_context += f"  - {k}: {v}\n"

    prompt = f"""{market_context}

Analiza los siguientes activos de forma educativa: {', '.join(symbols)}

Para cada uno:
1. Explica el modelo de negocio (cómo gana dinero)
2. Situación actual del negocio (no del precio)
3. Principales riesgos y oportunidades
4. Comparación entre ellos si son múltiples

Luego, si el perfil del usuario está disponible, presenta escenarios:
- Cómo encaja cada uno en un perfil como el suyo
- Qué preguntas debería hacerse antes de considerar cualquier activo

Recuerda: analiza el negocio, no el precio de la acción."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=8192,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text


async def generate_portfolio_scenario(
    scenario: str,
    capital: float | None,
    profile: UserProfile | None,
    focus_sectors: list[str] | None = None,
    positions: list[dict] | None = None,
) -> str:
    system_prompt = build_system_prompt(profile)
    capital_str = f"${capital:,.0f}" if capital else "capital no especificado"
    sectors_str = f"con enfoque en: {', '.join(focus_sectors)}" if focus_sectors else ""

    if positions:
        pos_lines = []
        total_invested = 0.0
        total_current = 0.0
        for p in positions:
            cp = p.get("current_price") or p["avg_price"]
            invested = p["shares"] * p["avg_price"]
            current  = p["shares"] * cp
            total_invested += invested
            total_current  += current
            pct_chg = ((cp - p["avg_price"]) / p["avg_price"] * 100) if p["avg_price"] else 0
            target_str = ""
            if p.get("analyst_target"):
                upside = ((p["analyst_target"] - cp) / cp * 100) if cp else 0
                target_str = (
                    f" | Consenso analistas: ${p['analyst_target']:.2f} "
                    f"({'↑' if upside >= 0 else '↓'}{abs(upside):.1f}% desde precio actual)"
                )
                if p.get("recommendation"):
                    target_str += f" [{p['recommendation']}]"
            pos_lines.append(
                f"- {p['ticker']} ({p.get('name', p['ticker'])}): "
                f"{p['shares']} acc × ${p['avg_price']:.2f} compra | "
                f"Precio actual: ${cp:.2f} ({'+' if pct_chg >= 0 else ''}{pct_chg:.1f}%)"
                f"{target_str}"
            )
        total_pct = ((total_current - total_invested) / total_invested * 100) if total_invested else 0
        portfolio_block = f"""## PORTAFOLIO REAL DEL USUARIO
Capital invertido: ${total_invested:,.2f}
Valor actual: ${total_current:,.2f} ({'+' if total_pct >= 0 else ''}{total_pct:.1f}% total)

Posiciones:
{chr(10).join(pos_lines)}

Escenario de análisis solicitado: {scenario}"""

        prompt = f"""{portfolio_block}

Con base en las posiciones REALES del usuario arriba, genera un análisis de su portafolio actual y forecast para el escenario {scenario}:

1. **Estado actual del portafolio**: Posiciones ganadoras y perdedoras, concentración de riesgo, diversificación real vs ideal para el perfil {scenario}
2. **Forecast basado en consenso de analistas**: Para cada posición con target disponible, evalúa si el precio actual justifica mantener, reducir o considerar alternativas. Usa los targets de analistas como referencia, no como verdad absoluta.
3. **Simulación de escenario {scenario}**: Si el mercado va al alza (bull), lateral, o baja (bear), ¿cómo reaccionaría este portafolio específico?
4. **Ajustes sugeridos para el escenario {scenario}**: ¿Qué falta, qué sobra, qué está bien para este perfil?
5. **Riesgos de concentración detectados**: ¿Hay demasiada exposición a un sector, empresa o factor?

IMPORTANTE: Esto es análisis educativo, no recomendación de inversión. Basa el forecast en los datos de analistas disponibles, no en predicciones propias."""
    else:
        user_risk = profile.risk_tolerance if profile else "moderate"
        risk_label = {"conservative": "conservador", "moderate": "moderado", "aggressive": "agresivo"}.get(user_risk, user_risk)
        scenario_label = {"conservative": "conservador", "moderate": "moderado", "aggressive": "agresivo"}.get(scenario, scenario)

        mismatch_note = ""
        if user_risk != scenario:
            mismatch_note = f"""
⚠️ DIFERENCIA IMPORTANTE: El perfil real del usuario es "{risk_label}" pero está simulando el escenario "{scenario_label}".
Menciona esto brevemente y explica cómo balancear ambos perfiles."""

        prompt = f"""El usuario tiene un perfil de riesgo REAL: {risk_label.upper()}
Escenario solicitado para esta simulación: {scenario_label.upper()}
Capital de referencia: {capital_str} {sectors_str}
{mismatch_note}

Responde SOLO en este formato JSON exacto, sin texto adicional:

{{
  "summary": "1-2 frases explicando la estrategia {scenario_label} para perfil {risk_label}",
  "mismatch": "{mismatch_note if user_risk != scenario else ''}",
  "allocations": [
    {{"ticker": "VTI", "name": "Vanguard Total Stock Market ETF", "pct": 40, "color": "#22c55e", "reason": "razón breve"}},
    {{"ticker": "BND", "name": "Vanguard Total Bond Market ETF", "pct": 30, "color": "#3b82f6", "reason": "razón breve"}}
  ],
  "risks": ["Riesgo 1", "Riesgo 2", "Riesgo 3"],
  "history": {{"2008": "-X%", "2020": "+X%", "2022": "-X%"}}
}}

ETFs típicos por perfil — úsalos de referencia:
• Conservador (más bonos): SGOV 25%, BND 25%, VTIP 15%, SCHD 20%, VTI 15%
• Moderado (equilibrado): VTI 35%, VEA 15%, BND 20%, QQQ 15%, VNQ 10%, GLD 5%
• Agresivo (más acciones): QQQ 30%, VTI 25%, VGT 20%, VWO 15%, SOXX 10%

Los porcentajes DEBEN sumar exactamente 100. Incluye entre 5 y 7 activos. Asigna un color hex distinto a cada categoría (verde para acciones, azul para bonos, amarillo para commodities, morado para REITs).

IMPORTANTE: Solo devuelve JSON válido. Sin markdown, sin texto fuera del JSON."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=700,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text


async def screen_stocks(stocks: list[dict], query: str, profile: UserProfile | None = None) -> str:
    system_prompt = build_system_prompt(profile)
    data_str = json.dumps(stocks[:20], ensure_ascii=False)
    prompt = f"""El usuario busca: "{query}"

Datos de acciones disponibles (JSON):
{data_str}

Selecciona las 5 que mejor coincidan. Para cada una, una línea con: emoji + ticker + nombre + por qué coincide + score /10.
Formato visual y compacto. Termina con una línea de insight general."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=500,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


async def generate_alert_context(ticker: str, change_pct: float, profile: UserProfile | None = None) -> str:
    system_prompt = build_system_prompt(profile)
    direction = "subió" if change_pct >= 0 else "cayó"
    prompt = f"""{ticker} {direction} {abs(change_pct):.1f}% hoy.

En máximo 4 bullets visuales:
1. Qué pudo causar este movimiento
2. Si es ruido de mercado o fundamento real
3. Qué debería considerar el inversor antes de actuar
4. Nota conductual si aplica (¿es momento de pánico o de análisis?)

Formato con emojis. Sin introducciones."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=400,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


async def generate_notification_insight(
    notification_type: str,
    market_event: str,
    profile: UserProfile | None = None
) -> str:
    system_prompt = build_system_prompt(profile)

    prompt = f"""Genera un mensaje de notificación educativa personalizada para este evento de mercado.

Tipo: {notification_type}
Evento: {market_event}

El mensaje debe:
1. Ser breve (2-3 párrafos)
2. Explicar qué significa este evento (no solo informar)
3. Conectarlo con el perfil del usuario
4. Terminar con una pregunta que invite a aprender más
5. Ser empático si el evento puede generar ansiedad

NO alarmes innecesariamente. Contextualiza con perspectiva histórica."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=600,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text


# ──────────────────────────────────────────────────────────────
# FEATURE: Análisis automático de earnings
# ──────────────────────────────────────────────────────────────

async def analyze_earnings(
    symbol: str,
    earnings_data: dict,
    position: dict | None = None,
    profile: UserProfile | None = None,
) -> str:
    system_prompt = build_system_prompt(profile)
    position_ctx = ""
    if position:
        shares = position.get("shares", 0)
        avg_cost = position.get("avg_cost", 0)
        current_price = earnings_data.get("current_price", 0)
        impact = round((current_price - avg_cost) * shares, 2) if current_price and avg_cost and shares else None
        if impact is not None:
            sign = "+" if impact >= 0 else ""
            position_ctx = f"\n\nEl usuario tiene {shares} acciones con costo promedio ${avg_cost}. Impacto estimado en after-hours: {sign}${impact:.2f}."

    eps_actual   = earnings_data.get("eps_actual")
    eps_estimate = earnings_data.get("eps_estimate")
    rev_actual   = earnings_data.get("revenue_actual")
    rev_estimate = earnings_data.get("revenue_estimate")
    guidance     = earnings_data.get("guidance", "No disponible")
    highlights   = earnings_data.get("highlights", "")

    beat_miss_eps = ""
    if eps_actual is not None and eps_estimate is not None:
        diff = eps_actual - eps_estimate
        beat_miss_eps = f"✅ BEAT +${diff:.2f}" if diff >= 0 else f"❌ MISS ${diff:.2f}"

    beat_miss_rev = ""
    if rev_actual is not None and rev_estimate is not None:
        diff_pct = ((rev_actual - rev_estimate) / rev_estimate * 100) if rev_estimate else 0
        beat_miss_rev = f"✅ BEAT +{diff_pct:.1f}%" if diff_pct >= 0 else f"❌ MISS {diff_pct:.1f}%"

    prompt = f"""Analiza los resultados de earnings de {symbol}:

EPS: ${eps_actual} real vs ${eps_estimate} estimado {beat_miss_eps}
Revenue: ${rev_actual}B real vs ${rev_estimate}B estimado {beat_miss_rev}
Guidance: {guidance}
Highlights: {highlights}{position_ctx}

Responde en este formato exacto con bullets y emojis:

**📊 Veredicto rápido**
Una línea con el resultado general (beat/miss/en línea) y su calidad.

**🔍 Lo que importa**
3 bullets sobre los números que realmente mueven la tesis de inversión (no solo EPS/revenue).

**📈 Impacto en tu portafolio**
1-2 líneas sobre qué significa este resultado para quien tiene acciones de {symbol}.

**🧠 Lo que diría tu mentor**
1 párrafo corto con la perspectiva del asesor según el perfil del usuario.

**⚡ Acción sugerida**
Una línea directa: mantener / considerar agregar / monitorear — con la razón en 10 palabras.

Sin introducciones. Sin conclusiones genéricas. Directo al punto."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=700,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


# ──────────────────────────────────────────────────────────────
# FEATURE: Screener semanal personalizado
# ──────────────────────────────────────────────────────────────

async def generate_weekly_picks(
    candidates: list[dict],
    profile: UserProfile | None = None,
    existing_tickers: list[str] | None = None,
) -> dict:
    system_prompt = build_system_prompt(profile)
    risk = profile.risk_tolerance if profile else "moderado"
    mentor = profile.mentor if profile else None
    existing = existing_tickers or []
    quiz = (profile.quiz_answers if profile else {}) or {}

    # Translate quiz answers into readable investment context
    HORIZON_MAP = {
        "A": "corto plazo (<2 años) — estabilidad ante todo, evitar volatilidad",
        "B": "mediano plazo (3–5 años) — balance crecimiento/estabilidad",
        "C": "largo plazo (10+ años) — puede aguantar volatilidad, maximizar retorno compuesto",
        "D": "muy largo plazo sin urgencia — máxima paciencia, enfoque en compounders",
    }
    KNOWLEDGE_MAP = {
        "A": "principiante — prefiere negocios simples y fáciles de entender",
        "B": "básico — comprende conceptos generales de inversión",
        "C": "intermedio — puede leer estados financieros y evaluar múltiplos",
        "D": "avanzado — análisis financiero profundo, valoración, métricas complejas",
    }
    ENGAGEMENT_MAP = {
        "A": "pasivo — prefiere negocios que no requieran seguimiento constante",
        "B": "mensual — invierte con calma, no necesita ver precio cada día",
        "C": "semanal — sigue el mercado activamente",
        "D": "diario — monitoreo activo, cómodo con más movimiento",
    }

    horizon_ctx   = HORIZON_MAP.get(str(quiz.get("q2", "")), "mediano/largo plazo")
    knowledge_ctx = KNOWLEDGE_MAP.get(str(quiz.get("q3", "")), "nivel intermedio")
    engage_ctx    = ENGAGEMENT_MAP.get(str(quiz.get("q5", "")), "revisión periódica")

    # Mentor → preferred business characteristics
    MENTOR_BIZ: dict[str, str] = {
        "warren_buffett":   "negocios con ventaja competitiva duradera (moat económico), marcas icónicas, alta rentabilidad sobre capital, modelo de negocio simple, flujo de caja predecible y consistente",
        "ray_dalio":        "diversificación entre activos con baja correlación (All-Weather): defensivas, commodities, utilities, bonos y algo de crecimiento — protección ante cualquier entorno macro",
        "michael_burry":    "empresas subvaloradas ignoradas por el mercado: activos tangibles reales, deuda manejable, precio muy por debajo del valor intrínseco, negocios que el consenso descarta",
        "bill_ackman":      "negocios con marca dominante o posición monopolística, flujo de caja muy predecible, catalizador específico que hará que el mercado reconozca el valor en 12–18 meses",
        "peter_lynch":      "empresas que cualquiera puede entender de su vida cotidiana — productos que usas, servicios que conoces — con crecimiento comprobable y PEG atractivo (ten-baggers accesibles)",
    }
    mentor_key = (mentor or "").lower().replace(" ", "_").replace("-", "_")
    mentor_biz = MENTOR_BIZ.get(
        mentor_key,
        "empresas con fundamentos sólidos, ventaja competitiva clara y crecimiento sostenible"
    )

    mentor_line   = f"Mentor: {mentor}." if mentor else ""
    existing_line = f"Ya posee: {', '.join(existing)}. NO incluir." if existing else ""

    data_str = json.dumps(candidates[:30], ensure_ascii=False)

    prompt = f"""Eres el asesor de inversión personalizado. Selecciona exactamente 5 SUGERENCIAS de exploración para esta semana (no son recomendaciones de compra — son ideas para que el usuario investigue más).

═══ PERFIL DEL USUARIO ═══
• Riesgo: {risk}
• Horizonte: {horizon_ctx}
• Conocimiento: {knowledge_ctx}
• Seguimiento: {engage_ctx}
• {mentor_line} {existing_line}

═══ TIPO DE NEGOCIO QUE BUSCA ═══
Según su perfil e inspiración de inversión, este usuario se inclina hacia:
{mentor_biz}

Selecciona empresas que REALMENTE encajen con esta descripción de negocio. Explica en cada pick por qué ese negocio específico es del tipo que busca.

═══ REGLAS ═══
- Exactamente 5 sugerencias
- Máximo 2 del mismo sector
- No sugerir tickers que ya posee
- Alineación con riesgo y horizonte
- El campo "why" debe explicar por qué ESE negocio encaja con el tipo buscado, no solo por qué está barato

═══ CANDIDATOS ═══
{data_str}

Responde SOLO con JSON válido:
{{
  "week_theme": "Tema de la semana en una frase breve",
  "business_profile": "En 1-2 oraciones: qué tipo de negocios se priorizaron esta semana y por qué encajan con el perfil del usuario",
  "picks": [
    {{
      "ticker": "AAPL",
      "name": "Apple",
      "sector": "Technology",
      "price": 185.50,
      "change_pct": 1.2,
      "score": 78,
      "why": "Por qué este negocio encaja con lo que busca este usuario (1-2 oraciones, enfocado en el tipo de negocio)",
      "catalyst": "Catalizador concreto a explorar en próximas semanas",
      "risk": "Principal riesgo en 10 palabras máximo"
    }}
  ],
  "mentor_note": "Perspectiva del mentor sobre estas sugerencias — 2 oraciones",
  "disclaimer": "Estas son sugerencias educativas basadas en tu perfil. No son asesoramiento financiero ni recomendaciones de compra. Siempre haz tu propia investigación antes de invertir."
}}

Sin texto fuera del JSON."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=1400,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    try:
        result = json.loads(raw)
    except Exception:
        import re
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        result = json.loads(m.group()) if m else {
            "week_theme": "Sugerencias de la semana",
            "picks": candidates[:5],
            "mentor_note": raw,
        }

    # Always guarantee disclaimer
    if "disclaimer" not in result:
        result["disclaimer"] = (
            "Estas son sugerencias educativas basadas en tu perfil. "
            "No son asesoramiento financiero ni recomendaciones de compra. "
            "Siempre haz tu propia investigación antes de invertir."
        )
    return result


# ──────────────────────────────────────────────────────────────
# FEATURE: Simulador ¿qué pasa si?
# ──────────────────────────────────────────────────────────────

async def simulate_whatif(
    scenario_type: str,
    scenario_params: dict,
    portfolio: list[dict],
    profile: UserProfile | None = None,
) -> dict:
    system_prompt = build_system_prompt(profile)
    portfolio_str = json.dumps(portfolio, ensure_ascii=False)

    if scenario_type == "swap":
        sell_ticker = scenario_params.get("sell_ticker", "")
        buy_ticker  = scenario_params.get("buy_ticker", "")
        prompt_detail = f"El usuario quiere VENDER todas sus acciones de {sell_ticker} y comprar {buy_ticker} con ese dinero."
    elif scenario_type == "add_monthly":
        amount   = scenario_params.get("amount", 0)
        years    = scenario_params.get("years", 5)
        prompt_detail = f"El usuario quiere invertir ${amount}/mes adicionales durante {years} años manteniendo su portafolio actual."
    elif scenario_type == "macro":
        event = scenario_params.get("event", "")
        prompt_detail = f"Evento macroeconómico hipotético: {event}. Analiza el impacto en el portafolio actual."
    elif scenario_type == "custom":
        prompt_detail = scenario_params.get("description", "Escenario personalizado del usuario.")
    else:
        prompt_detail = str(scenario_params)

    prompt = f"""El usuario tiene este portafolio actual:
{portfolio_str}

Escenario ¿qué pasa si?: {prompt_detail}

Responde SOLO con JSON válido en este formato:
{{
  "scenario_title": "Título descriptivo del escenario",
  "scenario_type": "{scenario_type}",
  "summary": "Resumen ejecutivo en 2-3 oraciones del impacto principal",
  "before": {{
    "total_value": 0,
    "risk_level": "Moderado",
    "top_sector": "Tech",
    "diversification_score": 6
  }},
  "after": {{
    "total_value_estimate": 0,
    "risk_level": "Alto",
    "top_sector": "Tech",
    "diversification_score": 7,
    "projected_1y": "+X%",
    "projected_5y": "+X%"
  }},
  "impacts": [
    {{"aspect": "Riesgo", "direction": "aumenta|disminuye|neutro", "detail": "Explicación breve"}},
    {{"aspect": "Diversificación", "direction": "aumenta|disminuye|neutro", "detail": "Explicación breve"}},
    {{"aspect": "Rendimiento esperado", "direction": "aumenta|disminuye|neutro", "detail": "Explicación breve"}},
    {{"aspect": "Exposición sectorial", "direction": "aumenta|disminuye|neutro", "detail": "Explicación breve"}}
  ],
  "pros": ["Pro 1", "Pro 2", "Pro 3"],
  "cons": ["Contra 1", "Contra 2", "Contra 3"],
  "mentor_verdict": "Veredicto del mentor en 2-3 oraciones: ¿lo haría o no? ¿Por qué?",
  "recommendation": "mantener_actual|proceder|proceder_con_cautela|no_recomendado"
}}

Usa los valores reales del portafolio para calcular estimaciones. Sin texto fuera del JSON."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=1000,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    try:
        return json.loads(raw)
    except Exception:
        import re
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group())
        return {"summary": raw, "scenario_type": scenario_type}


# ──────────────────────────────────────────────────────────────
# FEATURE: Reporte mensual de portafolio
# ──────────────────────────────────────────────────────────────

async def generate_monthly_report(
    portfolio: list[dict],
    performance: dict,
    profile: UserProfile | None = None,
) -> dict:
    system_prompt = build_system_prompt(profile)
    portfolio_str = json.dumps(portfolio, ensure_ascii=False)
    perf_str      = json.dumps(performance, ensure_ascii=False)

    mentor = profile.mentor if profile else "tu asesor"
    risk   = profile.risk_tolerance if profile else "moderado"

    prompt = f"""Genera el reporte mensual de portafolio para este usuario.

Perfil: riesgo {risk}, mentor: {mentor}
Portafolio actual: {portfolio_str}
Performance del mes: {perf_str}

Responde SOLO con JSON válido:
{{
  "month": "Junio 2026",
  "executive_summary": "2-3 oraciones del mes en términos simples",
  "performance": {{
    "total_return_pct": 0.0,
    "vs_sp500": "+X% / -X% vs S&P 500",
    "best_performer": {{"ticker": "X", "gain_pct": 0.0}},
    "worst_performer": {{"ticker": "X", "loss_pct": 0.0}}
  }},
  "metrics": {{
    "sharpe_ratio": 0.0,
    "volatility_pct": 0.0,
    "max_drawdown_pct": 0.0,
    "total_value": 0.0,
    "cash_invested": 0.0,
    "unrealized_gain": 0.0
  }},
  "sector_breakdown": [
    {{"sector": "Tech", "pct": 0, "color": "#3b82f6"}}
  ],
  "top_positions": [
    {{"ticker": "X", "name": "X", "shares": 0, "value": 0, "gain_pct": 0, "weight_pct": 0}}
  ],
  "risk_assessment": "Evaluación del riesgo actual del portafolio en 2 oraciones",
  "mentor_note": "Nota personal del mentor de 3-4 oraciones: qué hizo bien el usuario, qué cambiaría, qué oportunidades ve para el próximo mes",
  "action_items": [
    "Acción concreta sugerida 1",
    "Acción concreta sugerida 2",
    "Acción concreta sugerida 3"
  ],
  "learning_insight": "Un insight conductual: qué reveló el comportamiento del usuario este mes sobre su perfil real como inversor"
}}

Calcula los valores usando los datos del portafolio. Sin texto fuera del JSON."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=1200,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    try:
        return json.loads(raw)
    except Exception:
        import re
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group())
        return {"executive_summary": raw}


# ──────────────────────────────────────────────────────────────
# FEATURE: Diario de decisiones + análisis de sesgos
# ──────────────────────────────────────────────────────────────

async def analyze_decision_biases(
    decisions: list[dict],
    profile: UserProfile | None = None,
) -> dict:
    system_prompt = build_system_prompt(profile)
    decisions_str = json.dumps(decisions[-50:], ensure_ascii=False)  # last 50

    prompt = f"""Analiza el historial de decisiones de inversión de este usuario y detecta sus sesgos conductuales.

Decisiones registradas (JSON):
{decisions_str}

Detecta patrones reales. Solo reporta sesgos que tengan evidencia en los datos (mínimo 2-3 ocurrencias).

Responde SOLO con JSON válido:
{{
  "total_decisions": 0,
  "analysis_period": "Últimos X días",
  "overall_score": 0,
  "overall_label": "Inversor Racional / Inversor Emocional / Inversor en Desarrollo",
  "biases_detected": [
    {{
      "name": "Nombre del sesgo (ej: Aversión a la pérdida)",
      "severity": "alto|medio|bajo",
      "occurrences": 0,
      "description": "Qué hace exactamente el usuario que revela este sesgo",
      "cost_estimate": "Estimación del costo en $ o % de rendimiento perdido",
      "example": "Ejemplo concreto de una decisión que lo ilustra",
      "fix": "Qué hacer diferente la próxima vez (1-2 oraciones prácticas)"
    }}
  ],
  "strengths": [
    {{
      "name": "Fortaleza detectada",
      "description": "Evidencia de esta fortaleza en las decisiones"
    }}
  ],
  "patterns": {{
    "avg_hold_days": 0,
    "panic_sell_count": 0,
    "fomo_buy_count": 0,
    "ignored_alerts_count": 0,
    "acted_on_alerts_count": 0,
    "best_decision": "Descripción de la mejor decisión del período",
    "worst_decision": "Descripción de la peor decisión del período"
  }},
  "mentor_assessment": "Evaluación del mentor en 3-4 oraciones: cómo ve el perfil real vs declarado del usuario, y el consejo más importante para mejorar",
  "next_challenge": "Un reto específico para la próxima semana que ayude a corregir el sesgo más fuerte"
}}

Sin texto fuera del JSON."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=1500,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    try:
        return json.loads(raw)
    except Exception:
        import re
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group())
        return {"mentor_assessment": raw, "biases_detected": []}


async def summarize_news_article(title: str, content: str) -> str:
    """Summarize a financial news article in 4-8 sentences in Spanish."""
    has_content = bool(content and len(content) > 80)

    if has_content:
        source_block = f"Fragmento del artículo:\n{content[:3000]}"
        instruction = (
            "Basándote en el fragmento anterior, extrae la idea central y resume "
            "esta noticia en 4-6 oraciones en español para un inversor de largo plazo."
        )
    else:
        source_block = ""
        instruction = (
            "No se pudo obtener el cuerpo del artículo. Usa tu conocimiento sobre "
            "este titular para explicar la idea central y el contexto relevante en "
            "4-6 oraciones en español para un inversor de largo plazo."
        )

    prompt = f"""Titular: {title}
{chr(10) + source_block + chr(10) if source_block else ""}
{instruction}

Estructura esperada:
• Qué ocurrió o qué significa este titular
• Por qué importa para los mercados, la empresa o el sector
• Contexto relevante que ayude al inversor a entenderlo mejor

Sin frases introductorias como "Este artículo..." o "La noticia indica...". Directo al punto. Tono claro y educativo."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=420,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip()


async def analyze_paper_portfolio(
    positions: list[dict],
    trades: list[dict],
    total_return_pct: float,
    cash: float,
    portfolio_value: float,
) -> dict:
    """Analyze paper trading portfolio and return structured readiness verdict."""
    import json as _json

    num_positions  = len(positions)
    num_trades     = len(trades)
    buy_trades     = [t for t in trades if t.get("type") == "buy"]
    sell_trades    = [t for t in trades if t.get("type") == "sell"]
    tickers        = sorted({p.get("ticker", "") for p in positions})
    ticker_str     = ", ".join(tickers) if tickers else "ninguna"

    # Detect behavioral signals from trade history
    sell_count = len(sell_trades)
    rapid_sells = []
    for s in sell_trades:
        for b in buy_trades:
            if b.get("ticker") == s.get("ticker"):
                diff = abs((s.get("timestamp", 0) - b.get("timestamp", 0)) / 86400000)
                if diff < 3:
                    rapid_sells.append(s.get("ticker"))
                    break

    prompt = f"""Eres un coach de inversiones que analiza el portafolio de simulación (paper trading) de un usuario.

DATOS DEL PORTAFOLIO SIMULADO:
- Valor total: ${portfolio_value:,.2f} (empezó con $10,000)
- Retorno total: {total_return_pct:+.2f}%
- Efectivo disponible: ${cash:,.2f}
- Posiciones actuales ({num_positions}): {ticker_str}
- Total de operaciones: {num_trades} ({len(buy_trades)} compras, {sell_count} ventas)
- Ventas rápidas (<3 días tras compra): {len(rapid_sells)} ({', '.join(rapid_sells) if rapid_sells else 'ninguna'})

INSTRUCCIONES:
Analiza este portafolio y evalúa si el usuario está listo para invertir dinero real en acciones individuales.

Devuelve ÚNICAMENTE un JSON válido con esta estructura exacta (sin markdown, sin texto extra):
{{
  "verdict": "practice_more" | "promising" | "ready",
  "headline": "<frase corta y directa, máx 12 palabras>",
  "feedback": "<párrafo de 3-5 oraciones con análisis honesto del comportamiento>",
  "positives": ["<punto positivo 1>", "<punto positivo 2>"],
  "improvements": ["<área de mejora 1>", "<área de mejora 2>"],
  "disclaimer": "Invertir en acciones individuales conlleva riesgo de pérdida de capital. Realiza tu propia investigación antes de tomar cualquier decisión financiera."
}}

Criterios para el veredicto:
- "practice_more": < 5 operaciones, sin diversificación, retorno muy negativo (< -15%), o patrón de pánico frecuente
- "promising": comportamiento razonable pero con margen de mejora; puede continuar practicando unos meses más
- "ready": ≥ 10 operaciones con criterio, diversificación correcta, sin ventas de pánico, retorno entre -5% y positivo

Sé honesto, educativo y empático. No des consejos sobre acciones específicas."""

    response = await _claude(
        model=settings.claude_model,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text.strip()
    # Strip markdown code fences if model wraps it
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        return _json.loads(text)
    except Exception:
        return {
            "verdict": "promising",
            "headline": "Análisis disponible",
            "feedback": text,
            "positives": [],
            "improvements": [],
            "disclaimer": "Invertir en acciones individuales conlleva riesgo de pérdida de capital. Realiza tu propia investigación antes de tomar cualquier decisión financiera.",
        }
