# Fase 4 — Experiencia de Usuario, Personalización y Plataforma de Decisiones

Resumen de arquitectura al cierre de Fase 4 (13 incrementos). Ver el plan
completo en `/Users/diegoarria/.claude/plans/stateful-painting-flurry.md`
para el detalle increment-by-increment; este documento es la vista de
conjunto que queda cuando ese plan deje de ser el punto de referencia activo.

## Qué es (y qué no es) Fase 4

Fases 1-3 construyeron tres motores backend: Valuación, Calidad, e
Investigación. Fase 4 **no agregó lógica financiera nueva** — tomó lo ya
calculado por esos motores y lo convirtió en una experiencia usable:
dashboard reorganizado, explicabilidad, comparaciones, timeline, checklist,
watchlist inteligente, alertas, journal, personalización. El único backend
nuevo que sí se escribió en esta fase es *puente* (persistencia de
preferencias, endpoints de lectura en lote desde caché existente, jobs que
conectan una señal ya detectada con el sistema de notificaciones) — nunca
un nuevo cálculo financiero.

## Los 13 incrementos, en una línea cada uno

| # | Nombre | Qué agregó |
|---|--------|------------|
| 1 | Fundación | `components/ui/` primitivos, `researchEngineApi`, Nivel de Detalle (store + columna `detail_level`) |
| 2 | Dashboard Principal | `ExecutiveSummaryPanel` + reorganización de `/subvaluadas` por nivel de detalle |
| 3 | Explainability Engine | `ExplainableValue` — popover de explicación sobre `factors[]`/claims ya calculados |
| 4 | Comparaciones | `PeerComparisonChart` — visualización de barras sobre Peer Comparison (Fase 2) |
| 5 | Timeline interactiva | `CompanyTimeline` sobre `company_timeline_events` (Change Detection, Fase 3) |
| 6 | Historial de valuaciones | `ThesisHistoryPanel` + `get_user_thesis_history` |
| 7 | Manual vs. IA | `ManualVsAiPanel` — comparación del DCF manual vs. el automático |
| 8 | Investment Checklist | `InvestmentChecklistPanel` + tablas `user_checklist_items`/`checklist_completions`/`investable_marks` |
| 9 | Watchlist Inteligente | `POST /watchlist/batch-scores` (cache-only) + 6 columnas nuevas en `AdvancedStockTable` |
| 10 | Alertas Inteligentes | `smart_alerts_service.py` — 5 toggles reales (de 8 posibles) puenteados a `send_push` |
| 11 | Investment Journal | página `/journal`, adoptar/editar tesis, Thesis Tracker expuesto en UI |
| 12 | Personalización | página `/settings`, 5 preferencias con efecto real en superficies per-request |
| 13 | Cierre | code-splitting, `useCachedFetch`, auditoría de accesibilidad, este documento |

## Decisiones de arquitectura que persisten después de Fase 4

- **`DetailLevel` (4 niveles) vs. `UserLevel` (3, inferido) vs. view-mode
  básico/avanzado**: tres conceptos deliberadamente separados. `UserLevel`
  alimenta `FinancialTip`; `DetailLevel` controla qué SECCIONES se
  muestran en `/subvaluadas`; el view-mode controla densidad en
  watchlist/portfolio. No fusionar.
- **Caché compartida por ticker, nunca por usuario**: `nif_dashboard:v1:*`
  y `quick_analysis:v2:*` (`screener.py`) son cachés GLOBALES por
  `ticker+lang`, compartidas entre todos los usuarios. Toda la
  personalización de Incremento 12 (retorno requerido, margen de
  seguridad mínimo) fue deliberadamente diseñada para NUNCA tocar estas
  cachés — solo alimentan superficies per-request (calculadora manual,
  resaltado de UI, gates de checklist). Si algún día se quiere
  personalizar el DCF automático de verdad, eso requiere claves de caché
  por usuario — un cambio arquitectónico real, no una tarea de UX.
- **`smart_alert_state`**: dedup de notificaciones por
  `(user_id, ticker, category)`, mismo patrón que
  `saved_valuations.notified_milestones`. Dos tablas previas
  (`thesis_drift_state`, `valuation_alert_state`, migraciones 026/028)
  quedaron sin usar — quedan documentadas como código muerto, no se
  reutilizaron ni se borraron en esta fase.
- **`ReorderableSection` vs. `DashboardSection`**: dos listas de secciones
  deliberadamente separadas (`src/lib/personalization.ts` vs.
  `src/lib/detailLevel.ts`). `DashboardSection` controla VISIBILIDAD
  (17 secciones, atadas a los datos que cada motor ya expone);
  `ReorderableSection` controla ORDEN y solo cubre 4 bloques que son
  hermanos JSX independientes (`checklist`, `nif`, `timeline`,
  `thesis_history`) — la grilla NIF de 4 pilares se mueve como un solo
  bloque, no pilar por pilar, porque partirla más habría sido una
  restructuración real, no un reorder.
- **`useCachedFetch`**: hook genérico (Incremento 13) que formaliza el
  patrón stale-while-revalidate. Solo `useFxRate` fue refactorizado para
  usarlo — el caché de precios de `watchlist/page.tsx` (el otro caso real
  encontrado en la auditoría) se dejó como está deliberadamente: su lógica
  multi-fuente es más compleja que el contrato de este hook y no valía el
  riesgo de regresión en el incremento de cierre. Cualquier página nueva
  que necesite este patrón debería usar el hook, no reinventarlo.

## Rendimiento (Parte M)

- `next/dynamic` aplicado a: `StockDetailModal` (~1900 líneas, 3 sitios de
  uso), `PricingModal`, y 5 paneles de `/subvaluadas`
  (`PeerComparisonChart`, `CompanyTimeline`, `ThesisHistoryPanel`,
  `InvestmentChecklistPanel`, `ManualVsAiPanel`) — todos ya estaban detrás
  de gates `isPremium`/`isSectionVisible`, así que dividirlos en chunks
  separados no introduce layout shift.
- **Deliberadamente NO se dividió** `PaywallModal` (usado en 13+ páginas —
  el costo de tocar 13 archivos en el incremento de cierre no
  compensaba la ganancia de un componente de 328 líneas) ni los paneles
  `ScenarioWeightingPanel`/`ReverseDcfPanel`/`SensitivityHeatmap`, que
  viven mezclados con exports que sí se necesitan de entrada dentro de
  `components/subvaluadas/shared.tsx` — dividirlos requeriría partir ese
  archivo primero. Recomendado para una futura pasada de rendimiento
  dedicada, no aquí.
- **Virtualización: sin objetivo real.** Se auditaron
  `PeerComparisonChart` (peer_count típico de 5-10, limitado por
  `relative_valuation_service.py`) y watchlist (`FREE_LIMIT = 25`) — no
  hay ninguna lista en la app que hoy renderice más de ~50 filas sin
  paginación/límite ya existente. No se implementó virtualización.

## Accesibilidad (Parte N)

Auditoría dirigida sobre los componentes nuevos de Fase 4 (no una
auditoría completa de toda la app). Encontrado y corregido:
- `aria-label` faltante en botones de cerrar solo-ícono:
  `StockDetailModal`, `PaywallModal`, `PricingModal`.
- Botón de eliminar item en `InvestmentChecklistPanel` solo se revelaba en
  `:hover` — agregado `group-focus-within:opacity-100 focus:opacity-100`
  para que también aparezca navegando con teclado.
- Los primitivos de `components/ui/` (`ExpandableSection`,
  `DetailLevelToggle`, `ExplainableValue`) ya tenían `aria-expanded`,
  `role="radio"`/`aria-checked`, y `aria-label` correctos desde que se
  construyeron — sin hallazgos ahí.

## Parte P — Notas de diseño (NO implementado)

Recomendaciones para una fase futura, explícitamente fuera de alcance de
Fase 4:

- **Portafolios múltiples con atribución cruzada**: hoy `all_portfolios`
  (sync.py) ya soporta múltiples portfolio_id, pero no hay ninguna vista
  que compare/atribuya performance ENTRE portafolios de un mismo usuario.
- **ETFs**: el universo de datos actual (`fundamental_analysis_service`,
  NIF, DCF) asume acciones individuales con estados financieros propios —
  un ETF necesitaría un motor de datos completamente distinto (holdings,
  expense ratio, tracking error), no una extensión de los engines
  existentes.
- **Screeners avanzados**: el screener actual (`undervalued_screener_service`)
  filtra sobre un universo curado fijo (`UNIVERSE` en `screener.py`) con
  un solo criterio de ranking (`composite_score`). Un screener avanzado
  real necesitaría filtros combinables arbitrarios sobre el universo
  completo del mercado, lo cual es un cambio de infraestructura de datos,
  no solo de UI.
- **Backtesting**: no existe ningún dato histórico de decisiones/tesis con
  granularidad suficiente para backtestear una estrategia hoy — el
  `investment_decisions`/Investment Graph capturan eventos, no series de
  tiempo de portafolios hipotéticos. Requeriría diseño de datos nuevo
  antes de cualquier UI.

Ninguno de estos se diseñó en detalle — son notas para decidir alcance en
una futura fase, no compromisos.
