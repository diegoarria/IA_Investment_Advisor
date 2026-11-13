"""
Nuvos Pulse — Fase 6B: el job mensual de captura. Definido aquí, NO
registrado en ningún scheduler — `worker.py` nunca importa ni llama a
`job_monthly_pulse_snapshot`, exactamente como pide la Fase 6B ("no
activar ningún cron de producción todavía"). Activarlo en el futuro es
una sola línea en `worker.py` (`scheduler.add_job(...)`, mismo patrón que
`job_monthly_report_email`) — una decisión explícita, nunca un efecto
secundario de este archivo existiendo.

Diseño (§8 de la Fase 6A.1/6B):
  - Ventana mensual: días 1-3 del mes, igual que `job_monthly_report_email`
    (mismo helper `_is_first_trading_day_of_month`, reutilizado sin
    duplicar la lógica de festivos/zona horaria).
  - No asume que el mercado está abierto el día de la ejecución — el
    propio motor de exposición (`combiner.value_position`) ya devuelve
    `verifiable=False` honestamente cuando no hay cotización disponible;
    este job no intenta adivinar ni sustituir eso.
  - Reintentos/resumibilidad: SIN cursor en memoria ni en Redis. Cada
    tick vuelve a derivar, desde `user_portfolio` y
    `portfolio_pulse_snapshots`, qué (usuario, portafolio) todavía no
    tiene una captura vigente para el `period_key` del mes en curso — un
    crash o redeploy entre lotes no pierde progreso, el siguiente tick
    simplemente re-lee el estado real.
  - Concurrencia/presupuesto FMP: envuelto en `fmp_background()` (mismo
    mecanismo que ya protege el backfill de 927 tickers) para que esta
    captura masiva nunca compita con tráfico de usuarios en vivo por el
    límite compartido de 280 llamadas/min.
  - Aislamiento entre usuarios: cada captura corre en su propio
    try/except — un fallo de un portafolio nunca interrumpe los demás.
  - Deshabilitado por defecto (PULSE_SNAPSHOT_ENABLED sin definir) —
    mismo patrón que el backfill de valuaciones.
"""
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


async def _pending_portfolios(period_key: str) -> list[dict]:
    """Every (user_id, portfolio_id) from `user_portfolio` that does NOT
    yet have a vigente `month_end` snapshot for `period_key`. Re-derived
    fresh on every call — this IS the resumability mechanism, not a
    cursor that could drift from reality."""
    from app.core.database import get_supabase, run_query

    db = get_supabase()
    portfolios_res = await run_query(db.table("user_portfolio").select("user_id, portfolio_id"))
    all_pairs = {(r["user_id"], r["portfolio_id"]) for r in (portfolios_res.data or [])}
    if not all_pairs:
        return []

    done_res = await run_query(
        db.table("portfolio_pulse_snapshots")
        .select("user_id, portfolio_id")
        .eq("snapshot_type", "month_end")
        .eq("period_key", period_key)
        .eq("is_current", True)
    )
    done_pairs = {(r["user_id"], r["portfolio_id"]) for r in (done_res.data or [])}

    pending = all_pairs - done_pairs
    return [{"user_id": uid, "portfolio_id": pid} for uid, pid in sorted(pending)]


async def job_monthly_pulse_snapshot():
    """Captura una fotografía `month_end` para cada portafolio que todavía
    no la tiene este `period_key`, en lotes pequeños y pausados, nunca
    toda la base en una sola ejecución. Gated por `PULSE_SNAPSHOT_ENABLED`
    — por defecto no hace nada.

    Env vars (todas opcionales):
      PULSE_SNAPSHOT_ENABLED        "true" para ejecutar de verdad (default: off)
      PULSE_SNAPSHOT_DRY_RUN        "true" solo registra cuántos portafolios
                                     faltan, cero llamadas externas, cero escrituras
      PULSE_SNAPSHOT_BATCH_SIZE     portafolios procesados por tick (default 25)
    """
    from app.core.fmp_budget import fmp_background
    from app.services.portfolio_exposure.pulse import capture_snapshot, period_key_for

    enabled = os.getenv("PULSE_SNAPSHOT_ENABLED", "false").strip().lower() == "true"
    dry_run = os.getenv("PULSE_SNAPSHOT_DRY_RUN", "false").strip().lower() == "true"
    if not enabled and not dry_run:
        return

    import pytz
    today = datetime.now(pytz.timezone("America/New_York")).date()
    if today.day > 3:
        return  # misma ventana de 3 días que job_monthly_report_email

    period_key = period_key_for(datetime.now(timezone.utc))
    batch_size = int(os.getenv("PULSE_SNAPSHOT_BATCH_SIZE", "25"))

    pending = await _pending_portfolios(period_key)
    if dry_run:
        logger.info("job_monthly_pulse_snapshot DRY RUN — period_key=%s pending=%d next_batch=%s",
                    period_key, len(pending), pending[:batch_size])
        return
    if not pending:
        return

    batch = pending[:batch_size]
    captured, failed = 0, 0
    # No se asume que el mercado está abierto hoy — `combiner.value_position`
    # ya marca honestamente cada posición sin cotización como no verificable;
    # este job solo persiste lo que el motor de exposición ya determinó.
    with fmp_background():
        for pair in batch:
            try:
                await capture_snapshot(pair["user_id"], pair["portfolio_id"], "month_end", period_key=period_key)
                captured += 1
            except Exception as exc:
                failed += 1
                logger.warning("job_monthly_pulse_snapshot: capture failed for %s/%s: %s", pair["user_id"], pair["portfolio_id"], exc)

    logger.info(
        "job_monthly_pulse_snapshot: period_key=%s batch=%d captured=%d failed=%d remaining_after_this_tick=%d",
        period_key, len(batch), captured, failed, max(0, len(pending) - len(batch)),
    )
