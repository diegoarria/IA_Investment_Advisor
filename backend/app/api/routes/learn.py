import random
import re
import json
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Request
from app.api.deps import get_current_user_id
from app.core.database import get_supabase
from app.models.user import UserProfile
from app.services import ai_service
from app.core.limiter import limiter

router = APIRouter(prefix="/learn", tags=["learn"])

# ─── Tier limits ──────────────────────────────────────────────────────────

FREE_SIM_DAILY        = 5
FREE_DEBATE_DAILY     = 2
FREE_DEBATE_MAX_ROUNDS = 5
FREE_DIFFICULTIES     = {"principiante", "intermedio"}

PREMIUM_SIM_DAILY     = 50
PREMIUM_DEBATE_DAILY  = 20

def _is_premium(user_id: str) -> bool:
    p = _get_profile_raw(user_id)
    return bool(p and p.get("subscription_tier") == "premium")

def _get_profile_raw(user_id: str) -> dict | None:
    try:
        db = get_supabase()
        result = db.table("user_profiles").select("subscription_tier, trial_started_at").eq("user_id", user_id).execute()
        return result.data[0] if result.data else None
    except Exception:
        return None

def _is_trial_active(profile: dict | None) -> bool:
    """Returns True if user is within their 7-day free trial."""
    if not profile:
        return False
    ts = profile.get("trial_started_at")
    if not ts:
        return False
    from datetime import datetime, timezone, timedelta
    try:
        started = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) < started + timedelta(days=7)
    except Exception:
        return False

def _get_daily_usage(user_id: str) -> dict:
    """Fetch or create today's usage row from Supabase."""
    today = date.today().isoformat()
    db = get_supabase()
    try:
        result = db.table("user_daily_usage") \
            .select("sim_count, debate_count") \
            .eq("user_id", user_id).eq("date", today).execute()
        if result.data:
            return result.data[0]
    except Exception:
        pass
    return {"sim_count": 0, "debate_count": 0}

def _increment_daily(user_id: str, field: str):
    """Atomically increment a daily counter in Supabase."""
    today = date.today().isoformat()
    db = get_supabase()
    try:
        existing = db.table("user_daily_usage") \
            .select("sim_count, debate_count") \
            .eq("user_id", user_id).eq("date", today).execute()
        if existing.data:
            current = existing.data[0].get(field, 0)
            db.table("user_daily_usage") \
                .update({field: current + 1}) \
                .eq("user_id", user_id).eq("date", today).execute()
        else:
            db.table("user_daily_usage") \
                .insert({"user_id": user_id, "date": today, field: 1}).execute()
    except Exception:
        pass  # never block the user on a counter failure

def _check_daily(user_id: str, field: str, limit: int, noun: str):
    usage = _get_daily_usage(user_id)
    if usage.get(field, 0) >= limit:
        raise HTTPException(status_code=429, detail={
            "code": "daily_limit",
            "message": f"Alcanzaste el límite de {limit} {noun} diarios. Activa Premium para acceso ilimitado.",
            "limit": limit,
        })
    _increment_daily(user_id, field)

# ─── Scenarios by difficulty ───────────────────────────────────────────────

SCENARIOS = {
    "principiante": [
        {
            "id": "p_savings_2023", "title": "¿Dejar el dinero en el banco?", "date": "2023",
            "context": "Tienes $10,000 en una cuenta de ahorros que paga 0.5% anual. La inflación está al 4%. Tu amigo te dice que lo inviertas. Llevas 3 años sin invertir nunca.",
            "question": "¿Qué haces con tus $10,000?",
            "options": {"A": "Los dejo en el banco — es lo más seguro", "B": "Los meto en un fondo indexado S&P 500", "C": "Los pongo en un plazo fijo al 4.5%", "D": "Los divido: 50% plazo fijo, 50% fondo indexado"},
            "optimal": "D", "outcome": "Con 0.5% y 4% de inflación, en 10 años pierdes ~30% de poder adquisitivo. El plazo fijo cubre la inflación. El fondo indexado históricamente da 8-10% anual. La diversificación protege y hace crecer.",
            "lessons": {"A": "Perdiste poder adquisitivo cada año. El dinero 'seguro' en el banco fue tu mayor riesgo.", "B": "Correcto, pero toda la exposición al mercado puede ser estresante para alguien nuevo.", "C": "Cubriste la inflación, pero no creciste. Mejor que A pero limitado.", "D": "Perfecto para empezar. Proteges y creces simultáneamente."}, "returns": {"A": -3, "B": 120, "C": 35, "D": 77},
        },
        {
            "id": "p_crypto_friend", "title": "El tip de tu amigo", "date": "2021",
            "context": "Tu amigo te dice que compres una criptomoneda desconocida que 'va a x100'. Solo cuesta $0.001 y él ya ganó 400%. Tienes $2,000 ahorrados para pagar la universidad.",
            "question": "¿Qué haces?",
            "options": {"A": "Meto todos mis $2,000 — oportunidad única", "B": "Meto $200 que puedo perder y guardo los $1,800", "C": "No meto nada — ese dinero es para la universidad", "D": "Le pido más información antes de decidir"},
            "optimal": "C", "outcome": "El 95% de las criptomonedas 'milagro' llegan a cero. Los $2,000 para la universidad no son capital de inversión — son capital de emergencia con fecha límite.",
            "lessons": {"A": "Perdiste todo. Las monedas desconocidas con promesas de x100 son casi siempre estafas o altamente especulativas.", "B": "Razonable si te sobra. Pero el error es que $2,000 para universidad no 'sobra'.", "C": "Correcto. Regla de oro: nunca especules con dinero que necesitas.", "D": "Buena actitud, pero más información sobre una moneda basura sigue siendo basura."}, "returns": {"A": -100, "B": -10, "C": 0, "D": -90},
        },
    ],
    "intermedio": [
        {
            "id": "covid_crash_2020", "title": "Crash de COVID-19", "date": "Marzo 2020",
            "context": "El S&P 500 cayó 34% en 23 días. Tu portafolio de $50,000 ahora vale $33,000. Los medios hablan del fin del mundo financiero.",
            "question": "¿Qué haces con tu portafolio?",
            "options": {"A": "Vendo todo — no quiero perder más", "B": "No hago nada, espero a que pase", "C": "Compro más a precios de descuento", "D": "Vendo la mitad, espero con la otra"},
            "optimal": "C", "outcome": "El S&P 500 recuperó TODO en 5 meses y cerró 2020 con +18%. Fue la recuperación más rápida de la historia.",
            "lessons": {"A": "Vendiste en el fondo y te perdiste +67%.", "B": "Correcto pero pasivo.", "C": "Óptimo. Compraste cuando todos vendían.", "D": "Razonable pero dejaste retorno sobre la mesa."}, "returns": {"A": -34, "B": 18, "C": 67, "D": 28},
        },
        {
            "id": "bitcoin_2021", "title": "Bitcoin en $69,000", "date": "Nov 2021",
            "context": "Bitcoin llegó a $69,000. Tu cuñado triplicó su dinero. Tienes $15,000 para el enganche de una casa en 2 años.",
            "question": "¿Inviertes ese dinero en Bitcoin?",
            "options": {"A": "Meto todo — no puedo perderme esto", "B": "Meto 20% ($3,000) para no quedarme afuera", "C": "No — ese dinero no se toca, es para la casa", "D": "Primero aprendo más sobre crypto"},
            "optimal": "C", "outcome": "Bitcoin cayó de $69,000 a $16,000 (-76%) en 2022. El enganche se habría evaporado.",
            "lessons": {"A": "Perdiste $11,400. Sin enganche, sin casa.", "B": "Perdiste $2,280. Nunca especules con dinero con fecha límite.", "C": "Correcto. El horizonte importa tanto como el activo.", "D": "Correcto fue C independientemente de cuánto aprendieras."}, "returns": {"A": -76, "B": -15, "C": 5, "D": 5},
        },
        {
            "id": "dotcom_2000", "title": "Burbuja Dot-com", "date": "Enero 2000",
            "context": "Las acciones tech subieron 500% en 3 años. El NASDAQ está en máximos. Tienes $20,000 ahorrados.",
            "question": "¿Qué haces con tus $20,000?",
            "options": {"A": "Invierto todo en tech — el futuro es internet", "B": "Mitad en tech, mitad en S&P 500", "C": "No invierto, esto parece una burbuja", "D": "Solo compro tech con ganancias reales"},
            "optimal": "D", "outcome": "El NASDAQ colapsó 78% entre 2000-2002. Sin ingresos = $0. El índice no recuperó su máximo hasta 2015.",
            "lessons": {"A": "Perdiste $15,600.", "B": "Perdiste ~$7,000.", "C": "No perdiste nada. Reconociste la burbuja.", "D": "Mejor estrategia. Empresas con ganancias sobrevivieron."}, "returns": {"A": -78, "B": -35, "C": 0, "D": -20},
        },
    ],
    "dificil": [
        {
            "id": "d_turkey_2021", "title": "Crisis Lira Turca", "date": "Dic 2021",
            "context": "Eres inversor con $100,000. La lira turca cayó 44% en un año porque el banco central bajó tasas con 21% de inflación (decisión política). El índice turco BIST en dólares colapsó. Pero hay empresas exportadoras turcas con P/E de 3x y márgenes históricos.",
            "question": "¿Cómo posicionas tu portafolio respecto a Turquía?",
            "options": {"A": "Zero exposición — riesgo político inaceptable", "B": "Compro ETF de mercados emergentes con 5% de Turquía", "C": "Compro directamente exportadoras turcas (P/E 3x, ingresos en USD)", "D": "Short la lira y long exportadoras como hedge"},
            "optimal": "C", "outcome": "Las exportadoras turcas subieron 300-500% en los 18 meses siguientes al colapso. El P/E de 3x era absurdamente barato. El riesgo político era real pero estaba más que descontado.",
            "lessons": {"A": "El riesgo real ya estaba en el precio. Evitar por miedo te costó una oportunidad generacional.", "B": "Exposición mínima. Capturaste algo pero subestimaste el tamaño de la oportunidad.", "C": "Óptimo. Cuando el miedo empuja valuaciones a niveles absurdos, el riesgo/retorno se invierte a tu favor.", "D": "Sofisticado y correcto en teoría, pero el costo del short en mercados ilíquidos puede erosionar la ganancia."}, "returns": {"A": 0, "B": 15, "C": 380, "D": 200},
        },
        {
            "id": "d_svb_2023", "title": "Colapso de Silicon Valley Bank", "date": "Marzo 2023",
            "context": "Es viernes 10 de marzo 2023. SVB colapsó en 48h. Tienes $200,000 en acciones de bancos regionales: First Republic (FRC), Western Alliance (WAL), PacWest. Todas cayeron 30-50% hoy. El contagio podría seguir el fin de semana.",
            "question": "¿Qué haces antes de que cierren los mercados?",
            "options": {"A": "Vendo todo — si cayó SVB pueden caer todos", "B": "No vendo nada — el gobierno va a intervenir", "C": "Analizo balance: vendo FRC (más vulnerable), mantengo WAL y PacWest", "D": "Compro más — están en pánico irracional"},
            "optimal": "C", "outcome": "FRC quebró 2 meses después. WAL y PacWest cayeron más pero se recuperaron parcialmente. La clave era distinguir entre bancos con problemas estructurales reales vs contagio de pánico.",
            "lessons": {"A": "Vendiste WAL y PacWest en el fondo. Se recuperaron. FRC sí debiste vender.", "B": "El gobierno intervino en SVB/FRC depositantes pero accionistas perdieron TODO en FRC.", "C": "Correcto. El análisis fundamental en pánico es la ventaja competitiva real.", "D": "Demasiado agresivo. Comprar FRC fue un error — tenía problemas estructurales reales."}, "returns": {"A": -30, "B": -60, "C": 10, "D": -45},
        },
    ],
    "imposible": [
        {
            "id": "i_ltcm_1998", "title": "Colapso de LTCM", "date": "Sep 1998",
            "context": "Long-Term Capital Management (Nobel laureates managing it) tiene un apalancamiento de 25:1 sobre $125 billion en activos. La crisis rusa hizo colapsar sus modelos. La Fed convocó a los 14 bancos más grandes del mundo para un rescate. Tú eres el head of risk de Goldman Sachs en esa reunión. El rescate requiere $3.6B.",
            "question": "¿Cuánto capital comprometes Goldman en el rescate y por qué?",
            "options": {"A": "Zero — es un problema de LTCM, no nuestro", "B": "$300M — participación mínima, protegemos la relación", "C": "$300M con condiciones: acceso al libro de posiciones y derechos de veto en liquidación", "D": "$600M a cambio del 30% del portafolio durante liquidación ordenada"},
            "optimal": "C", "outcome": "Goldman contribuyó ~$300M con acceso privilegiado al libro. La información obtenida sobre las posiciones de LTCM valió órdenes de magnitud más que el rescate. Goldman salió de la crisis reforzado. La decisión correcta no era cuánto capital sino qué información obtenías a cambio.",
            "lessons": {"A": "El riesgo sistémico era real — LTCM colapsando desordenadamente hubiera afectado tus propias posiciones.", "B": "Participación sin información es la peor de las opciones. Pagas sin beneficio estratégico.", "C": "Correcto. En crisis sistémicas, la información es el activo real. El capital es el precio de entrada.", "D": "Demasiada exposición por retorno incierto. 30% en proceso de liquidación vale menos de lo que parece."}, "returns": {"A": -20, "B": 5, "C": 85, "D": 30},
        },
        {
            "id": "i_japan_1990", "title": "Burbuja de Japón 1990", "date": "Enero 1990",
            "context": "El Nikkei llegó a 38,916 en dic 1989. P/E promedio del mercado japonés: 60x. Precio de terrenos en Tokio equivalente a comprar toda California 4 veces. El BoJ subió tasas al 6%. Tienes un fondo de $500M con 40% en Japón.",
            "question": "¿Cómo posicionas los $200M en Japón ante estas señales?",
            "options": {"A": "Reduzco exposición Japón a 10%, roto a mercados emergentes de Asia", "B": "Mantengo 40% — el consenso del mercado es que Japón tiene fundamentos únicos", "C": "Short Nikkei vía futuros + Long Yen (carry trade invertido)", "D": "Reduzco a 5%, short Nikkei selectivo en sectores sobrevaluados (real estate, financials)"},
            "optimal": "D", "outcome": "El Nikkei cayó 80% en los siguientes 13 años. El mercado japonés no recuperó su máximo de 1989 hasta 2024 — 35 años después. Un P/E de 60x con tasas subiendo es la definición de burbuja terminal. D era óptimo por minimizar exposición y short selectivo donde la valuación era más absurda.",
            "lessons": {"A": "Correcto en dirección pero el 10% en Japón siguió perdiendo mucho. No aprovechaste el short.", "B": "Perdiste $160M de los $200M en Japón en los siguientes años.", "C": "El short Nikkei era correcto pero el Yen se apreció complicando el carry. Demasiado binario.", "D": "Óptimo. Minimiza pérdidas en longs y captura parte de la caída con shorts selectivos donde la burbuja era más obvia."}, "returns": {"A": -40, "B": -80, "C": 35, "D": 120},
        },
    ],
}

DIFFICULTY_DEBATE_PROMPTS = {
    "principiante": """Eres un mentor financiero amigable debatiendo contra la tesis del usuario.
Sé ALENTADOR y educativo. Reconoce lo que tiene de válido. Haz preguntas simples y directas.
Máximo 1 contraargumento principal. Termina con una pregunta fácil de responder.
Máximo 180 palabras. Tono: como un profesor paciente.""",

    "intermedio": """Eres un analista financiero experto debatiendo CONTRA la tesis del usuario.
Sé riguroso, usa datos reales, pero educativo — tu objetivo es fortalecer el pensamiento crítico.
3 contraargumentos sólidos con datos. Termina con una pregunta difícil.
Máximo 280 palabras.""",

    "dificil": """Eres un portfolio manager senior de un hedge fund debatiendo CONTRA la tesis del usuario.
Usa métricas financieras avanzadas (P/E, EV/EBITDA, WACC, ciclos macro). Sé despiadado con los datos.
Presiona cada suposición débil. Cita investigaciones o precedentes históricos específicos.
4 contraargumentos con datos cuantitativos. Termina con 2 preguntas que el usuario DEBE responder.
Máximo 350 palabras.""",

    "imposible": """Eres un CIO de un fondo macro global de $50B debatiendo CONTRA la tesis del usuario.
Opera en el nivel de Bridgewater, Soros, o Druckenmiller. Usa modelos macro, análisis de flujos de capital, correlaciones históricas y escenarios de tail risk.
Destruye cada supuesto de la tesis con evidencia empírica y modelos cuantitativos.
Asume que el usuario es un profesional avanzado — no expliques conceptos básicos.
5 contraargumentos de nivel institucional. Exige que el usuario justifique con datos.
Máximo 400 palabras. Sin piedad.""",
}

DIFFICULTY_DEBATE_REPLY = {
    "principiante": "Evalúa amablemente si responde el argumento. Anímalo. Veredicto /10 con palabras de aliento. Máximo 150 palabras.",
    "intermedio": "Evalúa honestamente. Si hay puntos débiles presiónalos. Veredicto /10. Máximo 220 palabras.",
    "dificil": "Sé exigente. Si la respuesta tiene errores técnicos, señálalos con datos. Veredicto /10 justificado. Máximo 300 palabras.",
    "imposible": "Nivel institucional. Destruye respuestas débiles con evidencia. Solo acepta argumentos con datos cuantitativos. Veredicto /10, exige más si es bajo. Máximo 350 palabras.",
}


def _get_profile(user_id: str) -> UserProfile | None:
    try:
        db = get_supabase()
        result = db.table("user_profiles").select("*").eq("user_id", user_id).execute()
        if result.data:
            return UserProfile(**result.data[0])
    except Exception:
        pass
    return None


# ─── Scenario endpoints ────────────────────────────────────────────────────

@router.post("/scenario")
@limiter.limit("15/minute")
async def get_scenario(request: Request, body: dict = None, user_id: str = Depends(get_current_user_id)):
    difficulty = (body or {}).get("difficulty", "intermedio").lower()
    premium = _is_premium(user_id)

    if not premium and difficulty not in FREE_DIFFICULTIES:
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "Los niveles Difícil e Imposible son exclusivos de Premium.",
        })
    if premium:
        _check_daily(user_id, "sim_count", PREMIUM_SIM_DAILY, "simulaciones")
    else:
        _check_daily(user_id, "sim_count", FREE_SIM_DAILY, "simulaciones")

    pool = SCENARIOS.get(difficulty, SCENARIOS["intermedio"])
    s = random.choice(pool)
    return {
        "id": s["id"], "title": s["title"], "date": s["date"],
        "context": s["context"], "question": s["question"], "options": s["options"],
        "difficulty": difficulty,
    }


@router.post("/scenario/result")
async def scenario_result(request: dict, user_id: str = Depends(get_current_user_id)):
    scenario_id = request.get("scenario_id", "")
    user_choice = request.get("choice", "")
    difficulty = request.get("difficulty", "intermedio")

    all_scenarios = [s for pool in SCENARIOS.values() for s in pool]
    scenario = next((s for s in all_scenarios if s["id"] == scenario_id), None)
    if not scenario:
        return {"error": "Scenario not found"}

    xp = {"principiante": 10, "intermedio": 25, "dificil": 50, "imposible": 100}.get(difficulty, 25)
    bonus_xp = xp if user_choice == scenario["optimal"] else 0

    return {
        "outcome": scenario["outcome"],
        "user_choice": user_choice,
        "optimal": scenario["optimal"],
        "lesson": scenario["lessons"].get(user_choice, ""),
        "return_pct": scenario["returns"].get(user_choice, 0),
        "optimal_return_pct": scenario["returns"].get(scenario["optimal"], 0),
        "is_optimal": user_choice == scenario["optimal"],
        "all_returns": scenario["returns"],
        "xp_earned": xp + bonus_xp,
        "difficulty": difficulty,
    }


# ─── Debate endpoints ──────────────────────────────────────────────────────

@router.post("/debate")
@limiter.limit("10/minute")
async def start_debate(request: Request, body: dict, user_id: str = Depends(get_current_user_id)):
    thesis = body.get("thesis", "").strip()
    difficulty = body.get("difficulty", "intermedio").lower()
    if not thesis:
        return {"error": "Thesis required"}
    premium = _is_premium(user_id)

    if not premium and difficulty not in FREE_DIFFICULTIES:
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "Los niveles Difícil e Imposible son exclusivos de Premium.",
        })
    if premium:
        _check_daily(user_id, "debate_count", PREMIUM_DEBATE_DAILY, "debates")
    else:
        _check_daily(user_id, "debate_count", FREE_DEBATE_DAILY, "debates")

    profile = _get_profile(user_id)
    system = DIFFICULTY_DEBATE_PROMPTS.get(difficulty, DIFFICULTY_DEBATE_PROMPTS["intermedio"])
    prompt = f"""{system}

TESIS DEL USUARIO: "{thesis}"

Responde directamente con tus contraargumentos. Sin introducción meta."""

    response = ""
    async for chunk in ai_service.chat_stream(
        message=prompt, conversation_history=[], profile=profile, mentor=None,
    ):
        response += chunk

    return {
        "debate_id": str(abs(hash(thesis)) % 100000),
        "response": response, "thesis": thesis, "difficulty": difficulty,
    }


@router.post("/debate/reply")
async def debate_reply(request: dict, user_id: str = Depends(get_current_user_id)):
    thesis = request.get("thesis", "")
    previous = request.get("previous_debate", "")
    user_response = request.get("user_response", "")
    round_num = request.get("round", 1)
    difficulty = request.get("difficulty", "intermedio").lower()
    premium = _is_premium(user_id)

    if not premium and round_num > FREE_DEBATE_MAX_ROUNDS:
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": f"Los usuarios free tienen hasta {FREE_DEBATE_MAX_ROUNDS} rondas por debate. Activa Premium para debates ilimitados.",
        })

    profile = _get_profile(user_id)
    reply_instruction = DIFFICULTY_DEBATE_REPLY.get(difficulty, DIFFICULTY_DEBATE_REPLY["intermedio"])

    prompt = f"""Continuamos el debate (ronda {round_num}, dificultad: {difficulty.upper()}).

TESIS: "{thesis}"
TU ARGUMENTO ANTERIOR: {previous[:600]}
RESPUESTA DEL USUARIO: "{user_response}"

{reply_instruction}"""

    response = ""
    async for chunk in ai_service.chat_stream(
        message=prompt, conversation_history=[], profile=profile, mentor=None,
    ):
        response += chunk

    return {"response": response, "round": round_num + 1, "difficulty": difficulty}


# ─── Streak & Hall of Fame ─────────────────────────────────────────────────

@router.post("/streak/sync")
async def sync_streak(request: dict, user_id: str = Depends(get_current_user_id)):
    streak = request.get("streak", 0)
    last_learn_date = request.get("last_learn_date", "")
    try:
        db = get_supabase()
        db.table("user_profiles").update({
            "streak_count": streak,
            "last_learn_date": last_learn_date,
        }).eq("user_id", user_id).execute()
    except Exception:
        pass
    return {"synced": True}


@router.get("/hall-of-fame")
async def get_hall_of_fame(user_id: str = Depends(get_current_user_id)):
    try:
        db = get_supabase()
        result = (
            db.table("user_profiles")
            .select("name, streak_count")
            .order("streak_count", desc=True)
            .limit(20)
            .execute()
        )
        entries = [
            {"name": r.get("name", "Anónimo"), "streak": r.get("streak_count", 0)}
            for r in result.data if r.get("streak_count", 0) > 0
        ]
        return {"leaderboard": entries}
    except Exception:
        return {"leaderboard": []}
