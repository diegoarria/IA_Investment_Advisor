"""
Financial Memory Graph (FMG) Service
=====================================
The permanent, intelligent financial memory of each Nuvos AI user.

Architecture:
  - fmg_memories           → beliefs, preferences, rules, lessons, biases
  - fmg_behavioral_patterns → recurring behavioral patterns with confidence
  - fmg_events             → immutable timeline of milestones & emotional events
  - fmg_portfolio_snapshots → daily wealth snapshots for longitudinal analysis

Every interaction enriches the graph. Nothing is ever deleted.
The graph becomes Nuvos AI's primary moat after 6+ months of use.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import anthropic

from app.core.database import get_supabase, run_query

log = logging.getLogger(__name__)

# Use Haiku for extraction — cheap, fast, good enough for structured JSON
_EXTRACTION_MODEL = "claude-haiku-4-5-20251001"
_MAX_CONTENT_LEN  = 600   # chars of each message fed to extractor
_MIN_CONFIDENCE   = 0.6   # only store patterns above this threshold


# ── Extraction ────────────────────────────────────────────────────────────────

_EXTRACTION_SYSTEM = """Eres un extractor de conocimiento financiero. Tu única tarea es analizar intercambios de conversación entre un usuario y Nuvos AI, y extraer información nueva y relevante sobre el usuario COMO INVERSIONISTA.

Reglas estrictas:
1. SOLO extrae si hay evidencia EXPLÍCITA en el texto. No inventes ni inferas sin base clara.
2. Sé conservador — menos es más. Un dato de calidad vale más que diez mediocres.
3. El contenido de cada memory debe tener máximo 120 caracteres.
4. Los pattern_key deben estar en snake_case inglés.
5. Si no hay nada genuinamente nuevo o relevante, devuelve {"nothing_new": true}.

Tipos de memory válidos:
- belief: Creencia sobre inversiones ("No invertiría en empresas sin moat")
- preference: Preferencia personal ("Prefiere dividendos sobre recompras")
- rule: Regla propia ("Nunca invertir más del 5% en crypto")
- lesson: Lección aprendida de experiencia ("Aprendió a no hacer timing del mercado")
- bias: Sesgo detectado ("Tiende a sobre-ponderar tech")
- goal: Meta financiera concreta ("Quiere jubilarse antes de los 45")
- insight: Insight sobre su situación ("Su mayor riesgo es la concentración en AAPL")

Devuelve SOLO JSON válido, sin texto adicional."""

_EXTRACTION_USER_TMPL = """Analiza este intercambio y extrae conocimiento nuevo sobre el usuario.

MENSAJE DEL USUARIO:
{user_msg}

RESPUESTA DE NUVOS AI:
{assistant_msg}

Devuelve JSON con este schema exacto:
{{
  "memories": [
    {{"type": "<tipo>", "content": "<texto conciso, max 120 chars>"}}
  ],
  "patterns": [
    {{"key": "<snake_case>", "description": "<qué hace o cómo piensa>", "positive": <true/false>}}
  ],
  "events": [
    {{"type": "<milestone|emotional|decision|learning>", "title": "<título corto>", "description": "<detalle opcional>"}}
  ],
  "nothing_new": false
}}

Si no hay nada nuevo: {{"nothing_new": true}}"""


_FREE_MEMORY_TYPES = {"belief", "preference"}
_ALL_MEMORY_TYPES  = {"belief", "preference", "rule", "lesson", "bias", "goal", "insight"}
_FREE_MAX_MEMORIES = 10


async def extract_from_conversation(
    user_id: str,
    user_message: str,
    assistant_response: str,
    user_name: str | None = None,
    is_premium: bool = False,
) -> None:
    """
    Extract knowledge from one conversation turn and store it in the FMG.
    Called as a fire-and-forget background task after each AI response.
    Failures are silently swallowed — never block the chat flow.

    Free tier: only belief + preference types, max 10 active memories, no patterns/events.
    Premium: full extraction — all types, unlimited memories, patterns, events.
    """
    try:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            return

        user_msg      = user_message[:_MAX_CONTENT_LEN]
        assistant_msg = assistant_response[:_MAX_CONTENT_LEN]

        client = anthropic.Anthropic(api_key=api_key)
        prompt = _EXTRACTION_USER_TMPL.format(
            user_msg=user_msg,
            assistant_msg=assistant_msg,
        )

        def _call():
            return client.messages.create(
                model=_EXTRACTION_MODEL,
                max_tokens=512,
                system=_EXTRACTION_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )

        response = await asyncio.to_thread(_call)
        raw = response.content[0].text.strip()

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        data = json.loads(raw)
        if data.get("nothing_new"):
            return

        db = get_supabase()
        tasks = []

        # ── Memories ──────────────────────────────────────────────────────
        allowed_types = _ALL_MEMORY_TYPES if is_premium else _FREE_MEMORY_TYPES
        mems_to_add: list[tuple[str, str]] = []
        for mem in data.get("memories", [])[:5]:
            mem_type    = mem.get("type", "insight")
            mem_content = (mem.get("content") or "").strip()[:200]
            if mem_content and mem_type in allowed_types:
                mems_to_add.append((mem_type, mem_content))

        if mems_to_add and not is_premium:
            # Enforce free cap — count current active memories
            count_res = await run_query(
                db.table("fmg_memories")
                .select("id")
                .eq("user_id", user_id)
                .eq("is_active", True)
                .limit(_FREE_MAX_MEMORIES + 1)
            )
            slots = _FREE_MAX_MEMORIES - len(count_res.data or [])
            mems_to_add = mems_to_add[:max(0, slots)]

        for mem_type, mem_content in mems_to_add:
            tasks.append(_upsert_memory(db, user_id, mem_type, mem_content))

        # ── Patterns & events — premium only ──────────────────────────────
        if is_premium:
            for pat in data.get("patterns", [])[:3]:
                key  = (pat.get("key") or "").strip().lower().replace(" ", "_")[:50]
                desc = (pat.get("description") or "").strip()[:200]
                positive = bool(pat.get("positive", False))
                if key and desc:
                    tasks.append(_upsert_pattern(db, user_id, key, desc, positive))

            for evt in data.get("events", [])[:2]:
                evt_type = evt.get("type", "learning")
                title    = (evt.get("title") or "").strip()[:150]
                desc_txt = (evt.get("description") or "").strip()[:300]
                if title and evt_type in (
                    "milestone","emotional","decision",
                    "first_investment","goal_achieved","goal_changed",
                    "pattern_detected","learning"
                ):
                    tasks.append(_insert_event(db, user_id, evt_type, title, desc_txt))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    except Exception as exc:
        log.debug("FMG extraction skipped: %s", exc)


async def _upsert_memory(db, user_id: str, mem_type: str, content: str) -> None:
    try:
        existing = await run_query(
            db.table("fmg_memories")
            .select("id, times_reinforced")
            .eq("user_id", user_id)
            .eq("type", mem_type)
            .eq("content", content)
            .limit(1)
        )
        if existing.data:
            row = existing.data[0]
            await run_query(
                db.table("fmg_memories")
                .update({
                    "times_reinforced": row["times_reinforced"] + 1,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("id", row["id"])
            )
        else:
            await run_query(
                db.table("fmg_memories").insert({
                    "user_id":   user_id,
                    "type":      mem_type,
                    "content":   content,
                    "source":    "conversation",
                    "confidence": 1.0,
                    "times_reinforced": 1,
                    "is_active": True,
                })
            )
    except Exception as exc:
        log.debug("FMG memory upsert failed: %s", exc)


async def _upsert_pattern(
    db, user_id: str, key: str, description: str, positive: bool
) -> None:
    try:
        existing = await run_query(
            db.table("fmg_behavioral_patterns")
            .select("id, times_observed, confidence")
            .eq("user_id", user_id)
            .eq("pattern_key", key)
            .limit(1)
        )
        now = datetime.now(timezone.utc).isoformat()
        if existing.data:
            row = existing.data[0]
            new_count = row["times_observed"] + 1
            # Confidence increases with each observation (Bayesian-ish)
            new_conf  = min(0.98, row["confidence"] + (1 - row["confidence"]) * 0.15)
            await run_query(
                db.table("fmg_behavioral_patterns")
                .update({
                    "description":     description,
                    "times_observed":  new_count,
                    "confidence":      round(new_conf, 3),
                    "last_detected_at": now,
                })
                .eq("id", row["id"])
            )
        else:
            await run_query(
                db.table("fmg_behavioral_patterns").insert({
                    "user_id":          user_id,
                    "pattern_key":      key,
                    "description":      description,
                    "confidence":       0.5,
                    "times_observed":   1,
                    "is_positive":      positive,
                    "first_detected_at": now,
                    "last_detected_at":  now,
                })
            )
    except Exception as exc:
        log.debug("FMG pattern upsert failed: %s", exc)


async def _insert_event(
    db, user_id: str, event_type: str, title: str, description: str
) -> None:
    try:
        await run_query(
            db.table("fmg_events").insert({
                "user_id":    user_id,
                "event_type": event_type,
                "title":      title,
                "description": description or None,
                "occurred_at": datetime.now(timezone.utc).isoformat(),
            })
        )
    except Exception as exc:
        log.debug("FMG event insert failed: %s", exc)


# ── Public event logger (called from other routes) ────────────────────────────

async def log_event(
    user_id: str,
    event_type: str,
    title: str,
    description: str = "",
    metadata: dict | None = None,
) -> None:
    """
    Manually log a timeline event from any part of the system.
    e.g. first portfolio position added, goal achieved, etc.
    """
    try:
        db = get_supabase()
        await run_query(
            db.table("fmg_events").insert({
                "user_id":    user_id,
                "event_type": event_type,
                "title":      title,
                "description": description or None,
                "metadata":   metadata or {},
                "occurred_at": datetime.now(timezone.utc).isoformat(),
            })
        )
    except Exception as exc:
        log.debug("FMG log_event failed: %s", exc)


# ── Portfolio snapshot (called daily from worker) ─────────────────────────────

async def take_portfolio_snapshot(user_id: str) -> None:
    """
    Save today's portfolio value as a permanent snapshot.
    Called once per day per user from the background worker.
    """
    try:
        db = get_supabase()
        today = datetime.now(timezone.utc).date().isoformat()

        # Check if already snapshotted today
        existing = await run_query(
            db.table("fmg_portfolio_snapshots")
            .select("id")
            .eq("user_id", user_id)
            .eq("snapshot_date", today)
            .limit(1)
        )
        if existing.data:
            return

        # Fetch current portfolio
        res = await run_query(
            db.table("user_portfolio").select("positions").eq("user_id", user_id)
        )
        if not res.data:
            return

        raw = res.data[0].get("positions", [])
        if isinstance(raw, dict) and "_v" in raw:
            raw = raw.get("positions", [])
        if not isinstance(raw, list) or not raw:
            return

        total_value     = 0.0
        sector_totals: dict[str, float] = {}

        for pos in raw:
            qty   = float(pos.get("quantity", 0) or 0)
            price = float(pos.get("current_price") or pos.get("avg_price") or 0)
            value = qty * price
            total_value += value
            sector = pos.get("sector") or "Other"
            sector_totals[sector] = sector_totals.get(sector, 0) + value

        sector_weights: dict[str, float] = {}
        if total_value > 0:
            sector_weights = {
                k: round(v / total_value, 4) for k, v in sector_totals.items()
            }
        top_sector = max(sector_totals, key=sector_totals.get) if sector_totals else None

        await run_query(
            db.table("fmg_portfolio_snapshots").insert({
                "user_id":        user_id,
                "snapshot_date":  today,
                "total_value":    round(total_value, 2),
                "positions_count": len(raw),
                "top_sector":     top_sector,
                "sector_weights": sector_weights,
            })
        )
    except Exception as exc:
        log.debug("FMG snapshot failed for %s: %s", user_id, exc)


# ── AI context builder ────────────────────────────────────────────────────────

async def get_fmg_context(user_id: str) -> str | None:
    """
    Build the FMG context block injected into every AI conversation.
    Returns None if the user has no FMG data yet (early users).
    """
    try:
        db = get_supabase()

        memories_res, patterns_res, events_res, snapshots_res = await asyncio.gather(
            run_query(
                db.table("fmg_memories")
                .select("type, content, times_reinforced")
                .eq("user_id", user_id)
                .eq("is_active", True)
                .order("times_reinforced", desc=True)
                .limit(20)
            ),
            run_query(
                db.table("fmg_behavioral_patterns")
                .select("description, confidence, times_observed, is_positive")
                .eq("user_id", user_id)
                .gte("confidence", _MIN_CONFIDENCE)
                .order("confidence", desc=True)
                .limit(8)
            ),
            run_query(
                db.table("fmg_events")
                .select("event_type, title, occurred_at")
                .eq("user_id", user_id)
                .order("occurred_at", desc=True)
                .limit(5)
            ),
            run_query(
                db.table("fmg_portfolio_snapshots")
                .select("snapshot_date, total_value, top_sector")
                .eq("user_id", user_id)
                .order("snapshot_date", desc=True)
                .limit(2)
            ),
            return_exceptions=True,
        )

        memories  = [] if isinstance(memories_res, Exception)  else (memories_res.data  or [])
        patterns  = [] if isinstance(patterns_res, Exception)   else (patterns_res.data  or [])
        events    = [] if isinstance(events_res, Exception)     else (events_res.data    or [])
        snapshots = [] if isinstance(snapshots_res, Exception)  else (snapshots_res.data or [])

        if not memories and not patterns and not events:
            return None

        parts: list[str] = ["## 🧠 MEMORIA FINANCIERA PERMANENTE DEL USUARIO\n"]
        parts.append("*Esta información fue aprendida en conversaciones anteriores. Úsala para dar respuestas más personalizadas.*\n")

        # Group memories by type
        by_type: dict[str, list[str]] = {}
        for m in memories:
            t = m["type"]
            by_type.setdefault(t, []).append(m["content"])

        labels = {
            "belief":     "💭 Creencias sobre inversiones",
            "preference": "⭐ Preferencias",
            "rule":       "📏 Reglas propias",
            "lesson":     "📚 Lecciones aprendidas",
            "bias":       "⚠️  Sesgos detectados",
            "goal":       "🎯 Metas financieras",
            "insight":    "💡 Insights sobre su situación",
        }
        for mem_type, label in labels.items():
            items = by_type.get(mem_type, [])
            if items:
                parts.append(f"\n### {label}")
                for item in items[:5]:
                    parts.append(f"- {item}")

        if patterns:
            parts.append("\n### 🔄 Patrones de comportamiento")
            for p in patterns:
                sign  = "✅" if p["is_positive"] else "⚠️ "
                conf  = int(p["confidence"] * 100)
                count = p["times_observed"]
                parts.append(f"- {sign} {p['description']} (confianza {conf}%, observado {count}x)")

        if events:
            parts.append("\n### 📅 Últimos eventos registrados")
            for e in events:
                date = e["occurred_at"][:10]
                parts.append(f"- [{date}] {e['title']}")

        if len(snapshots) >= 2:
            latest = snapshots[0]
            prev   = snapshots[1]
            try:
                change = latest["total_value"] - prev["total_value"]
                sign   = "+" if change >= 0 else ""
                parts.append(
                    f"\n### 💰 Patrimonio en portafolio"
                    f"\n- Valor actual: ${latest['total_value']:,.0f}"
                    f"\n- Vs. snapshot anterior: {sign}${change:,.0f}"
                )
                if latest.get("top_sector"):
                    parts.append(f"- Sector dominante: {latest['top_sector']}")
            except Exception:
                pass

        return "\n".join(parts)

    except Exception as exc:
        log.debug("FMG context build failed: %s", exc)
        return None


# ── Snapshot all active users (called from worker) ────────────────────────────

async def snapshot_all_active_users() -> None:
    """
    Take a portfolio snapshot for every user who has positions today.
    Called once per day from the background worker at market close.
    """
    try:
        db = get_supabase()
        result = await run_query(
            db.table("user_portfolio").select("user_id").limit(5000)
        )
        if not result.data:
            return

        user_ids = [r["user_id"] for r in result.data]
        log.info("FMG: snapshotting %d users", len(user_ids))

        # Process in batches to avoid hammering Supabase
        batch_size = 50
        for i in range(0, len(user_ids), batch_size):
            batch = user_ids[i : i + batch_size]
            await asyncio.gather(
                *[take_portfolio_snapshot(uid) for uid in batch],
                return_exceptions=True,
            )
            await asyncio.sleep(0.5)

    except Exception as exc:
        log.error("FMG snapshot_all_active_users failed: %s", exc)
