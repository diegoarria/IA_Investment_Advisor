import anthropic
from app.core.config import settings
from app.models.user import UserProfile, ChatMessage

client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

SYSTEM_PROMPT_BASE = """Eres un asesor de inversiones educativo de élite, radicalmente diferente a cualquier chatbot financiero. Tu superpoder es detectar la brecha entre lo que el usuario *cree* que es como inversionista y lo que *realmente* es bajo presión — y usarla para hacerlo crecer.

## TU IDENTIDAD
- Eres un mentor financiero que dice la verdad con empatía, no lo que el usuario quiere oír
- Usas lenguaje accesible, nunca jerga innecesaria
- Eres honesto sobre la incertidumbre del mercado
- NUNCA das recomendaciones directas de compra/venta
- Siempre analizas desde múltiples escenarios

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

## FORMATO DE RESPUESTA:
- Respuestas conversacionales, directas, no reportes formales
- Usa ejemplos concretos y analogías
- Cuando sea útil, estructura con secciones claras
- Termina con una pregunta que invite a la reflexión o al aprendizaje
- Máximo 3-4 conceptos nuevos por respuesta

## LO QUE NUNCA DEBES HACER:
- Decir "deberías comprar X" o "vende Y ahora"
- Dar predicciones de precio
- Ignorar contradicciones entre perfil declarado y comportamiento real
- Validar decisiones emocionales de pánico o euforia sin nombrarlas como tales
- Abrumar con datos sin contexto
- Usar jerga sin explicarla primero"""


def build_profile_context(profile: UserProfile) -> str:
    goals_map = {
        "capital_preservation": "preservación de capital",
        "income": "generación de ingresos",
        "growth": "crecimiento",
        "aggressive_growth": "crecimiento agresivo",
        "retirement": "retiro/jubilación"
    }
    goals_str = ", ".join([goals_map.get(g, g) for g in profile.investment_goals])

    experience_map = {
        "beginner": "principiante (conceptos básicos, usa analogías simples)",
        "intermediate": "intermedio (entiende métricas básicas, puede manejar comparaciones sectoriales)",
        "advanced": "avanzado (familiarizado con ratios financieros y análisis técnico)"
    }

    risk_map = {
        "conservative": "conservador (prioriza estabilidad sobre crecimiento)",
        "moderate": "moderado (balance entre crecimiento y estabilidad)",
        "aggressive": "agresivo (acepta alta volatilidad por mayor potencial de retorno)"
    }

    weak_areas = ""
    if profile.weak_areas:
        weak_areas = f"\n- Áreas a reforzar: {', '.join(profile.weak_areas)}"

    learned = ""
    if profile.learned_concepts:
        learned = f"\n- Ya entiende: {', '.join(profile.learned_concepts[-5:])}"

    return f"""
## PERFIL DEL USUARIO ACTUAL:
- Edad: {profile.age} años
- Ingresos mensuales: ${profile.monthly_income:,.0f}
- Tolerancia al riesgo: {risk_map.get(profile.risk_tolerance, profile.risk_tolerance)}
- Experiencia: {experience_map.get(profile.investment_experience, profile.investment_experience)}
- Horizonte de inversión: {profile.time_horizon_years} años
- Objetivos: {goals_str}
- Capital inicial disponible: {f'${profile.initial_capital:,.0f}' if profile.initial_capital else 'No especificado'}
- Ahorro mensual: {f'${profile.monthly_savings:,.0f}' if profile.monthly_savings else 'No especificado'}
- Preocupaciones financieras: {profile.financial_concerns or 'No especificadas'}
- Interacciones previas: {profile.interaction_count}{weak_areas}{learned}

ADAPTA TODO tu análisis a este perfil específico."""


def build_system_prompt(profile: UserProfile | None = None) -> str:
    if profile:
        return SYSTEM_PROMPT_BASE + "\n\n" + build_profile_context(profile)
    return SYSTEM_PROMPT_BASE + "\n\n## NOTA: Usuario aún no ha completado su perfil. Invítalo a hacerlo para personalizar el análisis."


async def chat_stream(
    message: str,
    conversation_history: list[ChatMessage],
    profile: UserProfile | None = None
):
    system_prompt = build_system_prompt(profile)

    messages = [{"role": m.role, "content": m.content} for m in conversation_history]
    messages.append({"role": "user", "content": message})

    async with client.messages.stream(
        model=settings.claude_model,
        max_tokens=2048,
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

    response = await client.messages.create(
        model=settings.claude_model,
        max_tokens=3000,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text


async def generate_portfolio_scenario(
    scenario: str,
    capital: float | None,
    profile: UserProfile | None,
    focus_sectors: list[str] | None = None
) -> str:
    system_prompt = build_system_prompt(profile)

    capital_str = f"${capital:,.0f}" if capital else "capital no especificado"
    sectors_str = f"con enfoque en: {', '.join(focus_sectors)}" if focus_sectors else ""

    prompt = f"""Construye un portafolio educativo hipotético de ejemplo para un perfil {scenario}.

Capital de referencia: {capital_str} {sectors_str}

Para este portafolio de ejemplo:
1. Distribución por tipo de activo (% aproximado)
2. Ejemplos de categorías o sectores (no nombres específicos de acciones como recomendación)
3. Lógica detrás de cada decisión de distribución
4. Riesgos específicos de esta estrategia
5. Comportamiento histórico típico de esta estrategia en crisis (2008, COVID-19, 2022)
6. En qué condiciones de mercado esta estrategia funciona mejor o peor

IMPORTANTE: Esto es completamente educativo/hipotético. No es una recomendación de inversión.
Explica los conceptos de diversificación, correlación de activos y horizonte temporal."""

    response = await client.messages.create(
        model=settings.claude_model,
        max_tokens=2500,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}]
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

    response = await client.messages.create(
        model=settings.claude_model,
        max_tokens=600,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text
