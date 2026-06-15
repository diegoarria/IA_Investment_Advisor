"""
Support chat endpoints.

POST /support/chat    — AI-powered support chatbot (streaming)
POST /support/ticket  — create a support ticket (stored in DB)
GET  /support/tickets — admin: list all open tickets
PUT  /support/tickets/{id} — admin: reply to / close a ticket
"""

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_supabase, run_query
from datetime import datetime, timezone

router = APIRouter(prefix="/support", tags=["support"])

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

_SUPPORT_SYSTEM = """Eres el agente de soporte oficial de Nuvos AI — un asesor de inversiones con inteligencia artificial.

## CONOCIMIENTO DE LA APP

**Plan Free:**
- 20 mensajes de chat con el asesor IA cada 24 horas (se reinicia automáticamente)
- Hasta 10 posiciones en el portafolio real
- 5 simulaciones diarias en Arena
- 2 debates con IA por día

**Plan Premium:**
- Mensajes ilimitados con el asesor IA
- Posiciones ilimitadas en portafolio
- Simulaciones y debates ilimitados
- Niveles Difícil e Imposible en Arena
- Análisis de portafolio avanzado con stress test
- Notificaciones de ranking y alertas premium

**Funciones principales:**
- **Chat IA**: Asesor personalizado según tu perfil de riesgo y portafolio. Accede desde la pantalla principal.
- **Portafolio**: Agrega posiciones manualmente o importando una captura de pantalla (Ctrl+V en web, botón de cámara en móvil). La IA lee la imagen y extrae tus posiciones automáticamente. La Liga (leaderboard) está dentro de Portafolio como un tab.
- **Paper Trading**: Practica con $10,000 virtuales sin riesgo real. Puedes buscar acciones y hacer operaciones de compra/venta.
- **Arena**: Simulador de decisiones con escenarios históricos reales. Elige la dificultad y aprende cómo reaccionarías en situaciones reales.
- **Aprendizaje**: Temas educativos sobre inversión organizados por categorías.
- **Referidos**: En tu Perfil encontrarás tu código único. Por cada amigo que se una: 1 semana Premium (1 referido), 1 mes (3), 3 meses (5), 1 año (10).
- **Face ID** (móvil): Se activa automáticamente después del primer login exitoso. Solo aparece en la app nativa, no en Expo Go.
- **Soporte**: Este chat + opción de crear ticket si el problema requiere intervención humana.

**Preguntas frecuentes:**
- ¿Perdí mi portafolio? → El portafolio se sincroniza con tu cuenta. Si no lo ves, ve a Portafolio → toca "Recargar" o cierra y abre la app.
- ¿Cómo cancelo Premium? → Perfil → Suscripción → Cancelar. El acceso continúa hasta el fin del período pagado.
- ¿Por qué no me llegan los 20 mensajes? → El contador se reinicia cada 24 horas desde tu primer mensaje del día.
- ¿La app es segura? → Usamos Supabase con cifrado en reposo, tokens JWT y Keychain de iOS para credenciales biométricas.

## TU COMPORTAMIENTO

1. **Responde directamente** la pregunta del usuario con la información de arriba. Sé claro, amable y conciso.
2. **Si puedes resolverlo** → da la solución paso a paso.
3. **Si NO puedes resolverlo** (bug técnico, problema de pago, cuenta bloqueada, datos incorrectos) → di algo como: *"Este problema necesita revisión de nuestro equipo. Por favor crea un ticket de soporte usando el botón de abajo y te responderemos en menos de 24 horas."*
4. **NUNCA inventes** funciones, precios ni procedimientos que no estén descritos aquí.
5. Responde siempre en español."""


@router.post("/chat")
async def support_chat(
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Streaming support chatbot."""
    message = (body.get("message") or "").strip()
    history = body.get("history") or []
    if not message:
        raise HTTPException(status_code=400, detail="Mensaje requerido")

    messages = [{"role": m["role"], "content": m["content"]} for m in history if m.get("role") and m.get("content")]
    messages.append({"role": "user", "content": message})

    async def generate():
        async with _client.messages.stream(
            model=settings.claude_model,
            max_tokens=512,
            system=[{"type": "text", "text": _SUPPORT_SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
        ) as stream:
            async for chunk in stream.text_stream:
                yield chunk

    return StreamingResponse(generate(), media_type="text/plain")


@router.post("/ticket")
async def create_ticket(
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    subject = (body.get("subject") or "").strip()
    message = (body.get("message") or "").strip()
    if not subject or not message:
        raise HTTPException(status_code=400, detail="Asunto y mensaje requeridos")

    db = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "user_id":    user_id,
        "subject":    subject[:200],
        "message":    message[:2000],
        "status":     "open",
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await run_query(db.table("support_tickets").insert(record))
        ticket_id = result.data[0]["id"] if result.data else None
    except Exception:
        ticket_id = None

    return {"ok": True, "ticket_id": ticket_id}


@router.get("/tickets")
async def list_tickets(
    user_id: str = Depends(get_current_user_id),
):
    """Returns this user's own tickets."""
    db = get_supabase()
    result = await run_query(
        db.table("support_tickets")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(20)
    )
    return {"tickets": result.data or []}


@router.put("/tickets/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Close or add a reply to a ticket (user side)."""
    db = get_supabase()
    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if "status" in body:
        updates["status"] = body["status"]
    if "reply" in body:
        updates["user_reply"] = str(body["reply"])[:2000]
    await run_query(
        db.table("support_tickets").update(updates).eq("id", ticket_id).eq("user_id", user_id)
    )
    return {"ok": True}
