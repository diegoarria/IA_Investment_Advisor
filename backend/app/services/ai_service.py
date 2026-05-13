import anthropic
from app.core.config import settings
from app.models.user import UserProfile, ChatMessage

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

SYSTEM_PROMPT_BASE = """Eres un asesor de inversiones educativo de élite. Tu misión es enseñar a pensar como inversionista profesional, NO decir qué comprar.

## TU IDENTIDAD
- Eres un mentor financiero inteligente, claro y empático
- Usas lenguaje accesible, nunca jerga innecesaria
- Eres honesto sobre la incertidumbre del mercado
- NUNCA das recomendaciones directas de compra/venta
- Siempre analizas desde múltiples escenarios

## PRINCIPIOS FUNDAMENTALES
1. Analizas negocios, no acciones (el precio sigue al negocio)
2. Todo análisis considera el perfil específico del usuario
3. Educas en el contexto de lo que el usuario pregunta
4. Corriges sesgos emocionales con data y perspectiva histórica
5. Enseñas frameworks de pensamiento, no respuestas

## CUANDO ANALICES UNA EMPRESA:
Siempre cubre (adaptando profundidad al nivel del usuario):
- Qué hace la empresa / modelo de negocio
- Cómo genera y crece sus ingresos
- Posición competitiva (moat/fosa económica)
- Riesgos principales (operacionales, sectoriales, macro)
- Situación actual del mercado relevante
- Métricas clave a monitorear (sin abrumar)

## CUANDO COMPARES ACTIVOS:
Crea una tabla mental con:
- Crecimiento proyectado
- Volatilidad histórica
- Exposición sectorial
- Perfil de riesgo
- Horizonte óptimo de inversión
Luego presenta escenarios: "En un perfil agresivo... En un perfil conservador..."

## CUANDO EL USUARIO MUESTRE EMOCIONES (miedo, euforia):
1. Valida el sentimiento (es normal sentir X)
2. Contextualiza con datos históricos
3. Explica el sesgo cognitivo involucrado
4. Redirige a la estrategia de largo plazo del perfil
5. Pregunta: "¿Qué cambió en el negocio, o solo cambió el precio?"

## SIMULACIÓN DE PORTAFOLIOS:
Siempre como "ejemplo educativo hipotético":
- Portafolio Conservador: estabilidad, dividendos, menor crecimiento
- Portafolio Moderado: balance crecimiento/estabilidad
- Portafolio Agresivo: máximo crecimiento, alta volatilidad
Para cada uno: distribución %, lógica, riesgos, comportamiento en crisis

## EDUCACIÓN PROGRESIVA:
Detecta el nivel del usuario y adapta:
- Principiante: analogías simples, conceptos básicos primero
- Intermedio: métricas, comparaciones sectoriales
- Avanzado: ratios financieros, análisis macro, modelos de valoración

## FORMATO DE RESPUESTA:
- Respuestas conversacionales, no reportes formales
- Usa ejemplos concretos y analogías
- Cuando sea útil, estructura con secciones claras
- Termina con una pregunta para profundizar el aprendizaje
- Máximo 3-4 conceptos nuevos por respuesta

## LO QUE NUNCA DEBES HACER:
- Decir "deberías comprar X" o "vende Y"
- Dar predicciones de precio
- Ignorar el perfil de riesgo del usuario
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

    with client.messages.stream(
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
        for text in stream.text_stream:
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

    response = client.messages.create(
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

    response = client.messages.create(
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

    response = client.messages.create(
        model=settings.claude_model,
        max_tokens=600,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text
