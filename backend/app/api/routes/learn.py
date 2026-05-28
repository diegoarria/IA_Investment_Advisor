import random
import re
import json
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.models.user import UserProfile
from app.services import ai_service

router = APIRouter(prefix="/learn", tags=["learn"])

# ─── Historical Scenarios ──────────────────────────────────────────────────

SCENARIOS = [
    {
        "id": "covid_crash_2020",
        "title": "Crash de COVID-19",
        "date": "Marzo 2020",
        "context": "El S&P 500 cayó 34% en 23 días. Los mercados globales colapsaron ante la incertidumbre del COVID-19. Tu portafolio de $50,000 ahora vale $33,000. Los medios hablan del fin del mundo financiero.",
        "question": "¿Qué haces con tu portafolio?",
        "options": {"A": "Vendo todo — no quiero perder más", "B": "No hago nada, espero a que pase", "C": "Compro más a precios de descuento", "D": "Vendo la mitad, espero con la otra"},
        "optimal": "C",
        "outcome": "El S&P 500 recuperó TODO en 5 meses y cerró 2020 con +18%. Fue la recuperación más rápida de la historia. Quien compró en el fondo con $10,000 adicionales terminó el año con $67,000.",
        "lessons": {
            "A": "Cristalizaste una pérdida del 34% y te perdiste la recuperación más rápida de la historia. Vendiste exactamente en el fondo.",
            "B": "No perdiste más, pero tampoco aprovechaste la oportunidad histórica de comprar en el fondo. Correcto pero pasivo.",
            "C": "Perfecto. Compraste cuando todos vendían por miedo. Esta es la esencia del value investing — ser codicioso cuando otros son miedosos.",
            "D": "Razonable pero incompleto. Protegiste capital pero desaprovechaste gran parte de la oportunidad histórica.",
        },
        "returns": {"A": -34, "B": 18, "C": 67, "D": 28},
    },
    {
        "id": "dotcom_2000",
        "title": "Burbuja Dot-com",
        "date": "Enero 2000",
        "context": "Las acciones tech subieron 500% en 3 años. Tu amigo invirtió $10,000 en una startup de internet sin ingresos y ya vale $45,000. El NASDAQ está en máximos históricos. Tienes $20,000 ahorrados.",
        "question": "¿Qué haces con tus $20,000?",
        "options": {"A": "Invierto todo en tech — el futuro es internet", "B": "Mitad en tech, mitad en S&P 500", "C": "No invierto, esto parece una burbuja", "D": "Solo compro tech con ganancias reales"},
        "optimal": "D",
        "outcome": "El NASDAQ colapsó 78% entre 2000-2002. Empresas sin ingresos cayeron a $0. El índice no recuperó su máximo hasta 2015 — 15 años después.",
        "lessons": {
            "A": "Perdiste $15,600 (78%). Muchas acciones tech individuales cayeron 90-100% y nunca se recuperaron.",
            "B": "Perdiste ~$7,000. El S&P también cayó 50%, pero el NASDAQ fue devastador.",
            "C": "No perdiste nada. Reconociste las señales de burbuja. Pero te perdiste los años previos del rally.",
            "D": "La mejor estrategia. Empresas como Microsoft cayeron pero sobrevivieron. Las sin ingresos desaparecieron.",
        },
        "returns": {"A": -78, "B": -35, "C": 0, "D": -20},
    },
    {
        "id": "bitcoin_2021",
        "title": "Bitcoin en $69,000",
        "date": "Noviembre 2021",
        "context": "Bitcoin llegó a $69,000. Todos hablan de crypto. Tu cuñado triplicó su dinero. Tienes $15,000 ahorrados para el enganche de una casa que quieres comprar en 2 años.",
        "question": "¿Inviertes ese dinero en Bitcoin?",
        "options": {"A": "Meto todo — no puedo perderme esto", "B": "Meto 20% ($3,000) para no quedarme afuera", "C": "No — ese dinero no se toca, es para la casa", "D": "Primero aprendo más sobre crypto antes de decidir"},
        "optimal": "C",
        "outcome": "Bitcoin cayó de $69,000 a $16,000 (-76%) en 2022. El mercado crypto tardó 2+ años en recuperarse parcialmente. El enganche de tu casa se habría evaporado.",
        "lessons": {
            "A": "Perdiste $11,400 (76%). Sin enganche, sin casa. El horizonte de inversión importa tanto como el activo.",
            "B": "Perdiste $2,280 del capital especulativo. Regla de oro: nunca especules con dinero que necesitas en menos de 3 años.",
            "C": "Correcto. El horizonte de inversión determina el riesgo apropiado. Para metas en 2 años = cero especulación.",
            "D": "Aprender es bueno, pero la respuesta correcta era C independientemente de cuánto aprendieras.",
        },
        "returns": {"A": -76, "B": -15, "C": 5, "D": 5},
    },
    {
        "id": "gfc_2008",
        "title": "Crisis Financiera 2008",
        "date": "Septiembre 2008",
        "context": "Lehman Brothers acaba de quebrar. Los bancos están colapsando. El S&P cayó 40% en meses. Tu portafolio de $80,000 vale $48,000. Tu asesor dice que puede ser una depresión como 1929.",
        "question": "¿Qué haces?",
        "options": {"A": "Vendo todo y meto en dólares/efectivo", "B": "Rebalanceo comprando más acciones con mi efectivo", "C": "No toco nada — sigo mi plan de largo plazo", "D": "Paso todo a oro y commodities"},
        "optimal": "B",
        "outcome": "El S&P 500 tocó fondo en marzo 2009 y luego subió 400% en la siguiente década. Quien mantuvo o compró más en el fondo multiplicó su dinero. El oro también subió pero menos.",
        "lessons": {
            "A": "Perdiste el rally del 400%. Para 2019 tu $48,000 en cash seguía siendo ~$48,000. En acciones habría sido ~$240,000.",
            "B": "Óptimo. Compraste cerca del fondo con disciplina. Doloroso emocionalmente, brillante financieramente.",
            "C": "Muy bueno. Mantener el plan cuando hay pánico es extremadamente difícil y extremadamente correcto.",
            "D": "El oro subió de $700 a $1,900 (170%), bueno pero muy inferior al S&P 500 en la recuperación.",
        },
        "returns": {"A": 0, "B": 420, "C": 400, "D": 170},
    },
]


def _get_profile(user_id: str) -> UserProfile | None:
    try:
        db = get_supabase()
        result = db.table("user_profiles").select("*").eq("user_id", user_id).execute()
        if result.data:
            return UserProfile(**result.data[0])
    except Exception:
        pass
    return None


@router.post("/scenario")
async def get_scenario(user_id: str = Depends(get_current_user_id)):
    s = random.choice(SCENARIOS)
    return {
        "id": s["id"],
        "title": s["title"],
        "date": s["date"],
        "context": s["context"],
        "question": s["question"],
        "options": s["options"],
    }


@router.post("/scenario/result")
async def scenario_result(request: dict, user_id: str = Depends(get_current_user_id)):
    scenario_id = request.get("scenario_id", "")
    user_choice = request.get("choice", "")
    scenario = next((s for s in SCENARIOS if s["id"] == scenario_id), None)
    if not scenario:
        return {"error": "Scenario not found"}
    return {
        "outcome": scenario["outcome"],
        "user_choice": user_choice,
        "optimal": scenario["optimal"],
        "lesson": scenario["lessons"].get(user_choice, ""),
        "return_pct": scenario["returns"].get(user_choice, 0),
        "optimal_return_pct": scenario["returns"].get(scenario["optimal"], 0),
        "is_optimal": user_choice == scenario["optimal"],
        "all_returns": scenario["returns"],
    }


@router.post("/debate")
async def start_debate(request: dict, user_id: str = Depends(get_current_user_id)):
    thesis = request.get("thesis", "").strip()
    if not thesis:
        return {"error": "Thesis required"}

    profile = _get_profile(user_id)
    prompt = f"""Eres un analista financiero experto debatiendo CONTRA la siguiente tesis de inversión.
Sé riguroso, usa datos reales, pero nunca condescendiente — tu objetivo es fortalecer el pensamiento crítico del usuario.

TESIS: "{thesis}"

Estructura tu respuesta así:
1. **Lo que tiene sentido** (1-2 oraciones — reconoce los puntos válidos)
2. **Los 3 contraargumentos más fuertes** (con datos y hechos reales)
3. **La pregunta que debes poder responder** (una pregunta difícil que el usuario debe resolver si su tesis es sólida)

Máximo 280 palabras. Sé directo y específico."""

    response = ""
    async for chunk in ai_service.chat_stream(
        message=prompt, conversation_history=[], profile=profile, mentor=None,
    ):
        response += chunk

    return {
        "debate_id": str(abs(hash(thesis)) % 100000),
        "response": response,
        "thesis": thesis,
    }


@router.post("/debate/reply")
async def debate_reply(request: dict, user_id: str = Depends(get_current_user_id)):
    thesis = request.get("thesis", "")
    previous = request.get("previous_debate", "")
    user_response = request.get("user_response", "")
    round_num = request.get("round", 1)

    profile = _get_profile(user_id)
    prompt = f"""Continuamos el debate de inversión (ronda {round_num}).

TESIS ORIGINAL: "{thesis}"
TU ARGUMENTO ANTERIOR: {previous[:500]}
RESPUESTA DEL USUARIO: "{user_response}"

Ahora:
1. Evalúa honestamente si refuta tus argumentos anteriores
2. Si hay puntos débiles en su respuesta, presiónalos con más datos
3. Si su argumento es sólido, reconócelo y eleva el debate con el siguiente nivel de dificultad
4. **Veredicto parcial**: ¿qué tan sólida es la tesis? (X/10 con 1 oración de justificación)

Máximo 220 palabras."""

    response = ""
    async for chunk in ai_service.chat_stream(
        message=prompt, conversation_history=[], profile=profile, mentor=None,
    ):
        response += chunk

    return {"response": response, "round": round_num + 1}
