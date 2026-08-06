# Fase 1.5 — Auditoría del Motor de Valuación de Nuvos AI

Auditoría previa al rediseño completo del motor de valuación, per el brief de
Fase 1.5. Cubre backend (`backend/app/services/`) y frontend
(`frontend/web/src/`). No se implementó ningún cambio — este documento es
insumo para decidir el alcance del rediseño.

---

## 0. Resumen ejecutivo

El hallazgo más importante de esta auditoría **no es que el motor actual sea
débil** — es que **una parte significativa de lo que el brief pide ya existe,
construido y probado, pero corriendo en paralelo sin llegar nunca a
producción ni al frontend**:

- Un **DCF driver-based completo** (Revenue → Margen Operativo → EBIT → NOPAT
  → Reinversión → FCF, con fade lineal año a año y consistencia terminal vía
  la identidad de Damodaran) ya está construido en
  `backend/app/services/valuation/dcf_engine.py`. Se calcula en cada
  request (`driver_based_valuation`) pero **nunca se muestra en el
  frontend** — cero referencias en `frontend/web/src`.
- Una **simulación Monte Carlo de 2000 corridas** (distribución real de
  probabilidad del valor intrínseco, ancladas en volatilidad histórica real)
  ya está construida y se calcula en cada request (`monte_carlo`) — pero
  **tampoco se muestra nunca**: existe la clave `"monte_carlo"` en el sistema
  de niveles de detalle del frontend, pero ningún componente la usa.
- Un **motor de consenso de valoración** (`consensus_valuation_service.py`)
  que combina DCF + Relativo + Histórico con pesos por arquetipo de negocio
  ya existe — pero vive fuera del flujo principal y no llega al chat/Arthur.
- La infraestructura de explicabilidad visual (`ExplainableValue.tsx`) ya es
  genérica y reutilizable sin cambios para cualquier motor nuevo.

Es decir: **antes de diseñar módulos nuevos desde cero, el primer movimiento
de alto impacto es conectar lo que ya está construido pero desconectado.**
Eso no reemplaza el trabajo de diseño que pide el brief (Growth Engine
ponderado, Reverse DCF 2.0, comparación con plataformas externas, backtest de
estrategia) — esas partes sí son nuevas — pero cambia radicalmente el punto de
partida.

---

## 1. Qué funciona bien (conservar)

- **FCF normalizado por margen ponderado por recencia**
  (`fundamental_analysis_service.py:945-950,1035`): en vez de usar el FCF
  absoluto del último año (vulnerable a un pico/valle de capex puntual), usa
  `avg_fcf_margin_ponderado_por_recencia × revenue_último_año`. Es una forma
  real, ya implementada, de exactamente lo que el brief pide como "Normalized
  FCF Engine" — falta generalizarla a más variantes (TTM/3y/5y/ajustado), pero
  la base es sólida.
- **WACC vía CAPM real** (`fundamental_analysis_service.py:294-356`): beta real
  del proveedor, risk-free rate en vivo, costo de deuda real (interest
  expense/total debt), con fallback sectorial declarado explícitamente como
  fallback. Bien fundamentado, no es una tabla fija disfrazada de fórmula.
- **Fade lineal del crecimiento** (no salto discreto) del modelo legacy
  (`legacy_dcf_core.py:26-37`) — el crecimiento decae linealmente año a año
  desde el año 1 hasta el terminal, ya evita el defecto de "crecimiento alto
  10 años y salto brusco a perpetuidad" que el brief señala como problema.
  (El `dcfCalculator.ts` del **frontend**, en cambio, sí tiene ese defecto —
  ver sección 2.)
- **Escenarios con caps diferenciados por escenario**
  (`FCF_DCF_SCENARIOS`, líneas 262-281): no son solo multiplicadores lineales
  — cada escenario tiene su propio techo de crecimiento, lo que sí genera
  diferenciación real en casos de crecimiento crudo muy alto.
- **Reverse DCF ya resuelto con root-finding real** (Brent's method), en 3
  variantes (`reverse_dcf_engine.py`): crecimiento implícito con fade,
  margen FCF implícito a crecimiento fijo, y una variante "Expectations
  Investing" (Rappaport) con tasa constante sobre Owner Earnings. Con
  `sanity_check_reverse_dcf` comparando contra el CAGR histórico propio.
- **Motores de Fase 2 (Quality/Moat/Capital Allocation/Deterioration/Industry)**
  — deterministas, sin LLM, ya exponen exactamente las señales que un Growth
  Engine ponderado necesitaría (ver sección 4).
- **Matriz de sensibilidad real** (`fundamental_analysis_service.py:1350-1368`):
  cada celda es una corrida DCF real (WACC × crecimiento FCF), no
  interpolación — y el frontend ya la consume directamente sin recalcular
  nada client-side.
- **`ExplainableValue.tsx`**: patrón genérico (summary/factors/confidence/
  source/changeNote) ya probado en 4+ lugares distintos, sin acoplamiento a
  dominio — reutilizable sin cambios para cualquier motor nuevo.
- **`select_discount_rate(wacc, required_return, use_required_return)`**
  (`dcf_engine.py:275-291`): el toggle WACC-vs-retorno-requerido ya existe
  como función pura, nunca mezcla ambos — ya conectado parcialmente en Fase 4
  Incremento 12 (default de la calculadora manual).

---

## 2. Qué no funciona (problemas reales, confirman el diagnóstico del brief)

- **El crecimiento futuro SÍ depende casi exclusivamente del CAGR histórico**
  de un solo período (`fundamental_analysis_service.py:1049-1104`): el
  "moat adjustment" que sumaba hasta +3pp por ROIC alto fue **removido**
  (comentario en el propio código, líneas 1074-1087) porque combinado con el
  techo de terminal growth generaba márgenes de seguridad de 55-67%
  irrealmente inflados en TSM/Adobe/Intuit. El sistema quedó, de hecho, MÁS
  dependiente del pasado de lo que estaba, no menos. No incorpora guidance,
  ROIC actual, TAM, ni industria — esto último está documentado explícitamente
  como hueco conocido en el propio código.
- **`dcfCalculator.ts` (frontend) es un DCF de crecimiento CONSTANTE**, sin
  fade — más simple que el propio modelo legacy del backend. Es una
  simplificación deliberada para recalcular en vivo con los sliders sin
  llamar al backend, pero el usuario ve dos comportamientos matemáticos
  distintos (el número que carga inicialmente del backend, con fade, vs. el
  que se mueve cuando toca los sliders, sin fade) sin que eso se explique en
  ningún lado.
- **El modelo principal asume FCF y Revenue creciendo a la misma tasa**
  siempre (documentado explícitamente en el código) — no hay un verdadero
  desglose Revenue→Margen→EBIT→NOPAT→Reinversión→FCF en el modelo que
  realmente se usa en producción. Ese desglose SÍ existe (`dcf_engine.py`)
  pero no es la fuente de verdad — ver sección 0.
- **Terminal growth es una tabla fija por sector**, no depende de ROIC/
  reinversión terminal de la empresa real, en el modelo principal. (El motor
  driver-based paralelo sí impone la identidad de Damodaran
  `reinversión_terminal = crecimiento_terminal / ROIC_terminal`, pero no
  alimenta el número que ve el usuario.)
- **No hay modelo de dilución** — solo reducción de share count vía
  recompras (inferidas indirectamente, no un dato directo de "acciones
  recompradas por año" de ningún proveedor). Una empresa que diluye (SBC neto
  positivo) no tiene ningún ajuste correspondiente; se usa el share count
  actual estático.
- **Deuda y caja neta son estáticas** del último balance — no se proyecta
  repago de deuda ni acumulación de caja futura.
- **`ReverseDcfPanel` (frontend) solo muestra crecimiento implícito** — el
  backend ya resuelve más (margen FCF implícito a crecimiento fijo), pero no
  se muestra. No hay ROIC implícito, múltiplo implícito, ni WACC implícito
  mostrados en ningún lado — el brief pide exactamente estos.
- **`ScenarioWeightingPanel` no recalcula el DCF al ponderar** — repondera 3
  números fijos que ya vienen del backend. No genera un rango de valor
  razonable (low/high) a partir de la ponderación, solo un punto
  (`expectedValue`).
- **El "Fair Value Engine" (múltiplo justificado) es v1 rule-based**, no
  calibrado con backtest histórico — el propio docstring
  (`fair_value_engine.py:13-23`) ya dice que ese calibrado es *"a dedicated
  Fase 1.5 project, out of scope here"*. Es decir, el equipo ya sabía que esta
  fase vendría.
- **El `fair_value_range` que ve el usuario hoy es una banda derivada SOLO
  del DCF propio** (min/max de escenarios) — el "segundo punto de vista" real
  (Relativo + Histórico + Fair Value Engine + Consenso) existe pero vive
  fuera de `get_fundamental_analysis()`, solo para el flujo de
  quick-analysis — no llega al flujo de chat/Arthur.
- **`ManualVsAiPanel` está hardcodeado a exactamente 3 supuestos**
  (growth/wacc/terminalGrowth, tipo unión cerrada) — no escalará a los ~10
  factores ponderados que pide un nuevo Growth Engine sin reescribir el tipo,
  las traducciones i18n, y la firma de `buildManualVsAiComparison`.

---

## 3. Qué debería eliminarse

- **El "moat adjustment" removido** (`moat_adjustment_pct` siempre en `0.0`)
  — el campo se mantiene solo por compatibilidad de schema. Si el nuevo
  Growth Engine reemplaza `growth_buildup`, este campo fantasma debería
  eliminarse limpiamente, no quedar como un vestigio con valor fijo.
- **`FinalResultPanel`** (`shared.tsx:465-517`) — código muerto: construye un
  rango low/high a partir de 2 métodos pero no está referenciado en
  `page.tsx` desde el refactor de `ExecutiveSummaryPanel` (Fase 4,
  Incremento 2). Cualquier lógica de "rango de valor razonable" que valga la
  pena de ahí debería migrarse al nuevo diseño; el componente en sí debería
  borrarse.
- **La duplicación de comportamiento matemático entre `dcfCalculator.ts` y el
  DCF real del backend** — no necesariamente eliminar la calculadora en vivo
  (es una buena UX), pero si el nuevo motor tiene fade lineal en producción,
  la calculadora del frontend debería implementar el mismo fade, no un
  modelo distinto y más simple.

---

## 4. Qué puede reutilizarse (sin recalcular nada)

### 4.1 Ya construido, solo falta conectar (el hallazgo de mayor apalancamiento)

- **`dcf_engine.py`'s `project_driver_based_dcf`** — el motor driver-based
  completo que el brief pide para "Driver-Based Forecast Engine" ya existe.
  Reutiliza: `recency_weighted_average` (primitiva genérica ya factorizada),
  `_fade` (fade lineal genérico, reutilizable para revenue/margen/reinversión
  simultáneamente), `compute_reinvestment_rate_anchor`, y la identidad de
  Damodaran para consistencia terminal.
- **`monte_carlo_engine.py`** — simulación de 2000 corridas ya ancladas en
  volatilidad histórica real cuando existe. Es la base natural para el
  "rango de valor razonable" que pide el brief (percentiles de la
  distribución en vez de 3 escenarios fijos), y ya está calculado en cada
  request sin usarse.
- **`consensus_valuation_service.py`** — combina Conservative DCF +
  Professional DCF + Relativo + Histórico con pesos por arquetipo de negocio
  (financials/secular_compounder/cyclical/balanced), reliability real por
  método. Es, casi literalmente, el "Fair Value Engine" (punto 7 del brief)
  que se pide construir — ya existe, solo está desconectado del flujo
  principal.
- **`relative_valuation_service.py`** — mediana de múltiplos de peers reales
  (mínimo 5, nunca inventa), ya integrado en `consensus_valuation_service`.

### 4.2 Señales de Fase 2 ya calculadas, directamente aplicables a un nuevo Growth Engine

Sin recalcular nada, un Growth Engine ponderado podría consumir hoy mismo:

| Señal | Fuente | Motor |
|---|---|---|
| ROIC incremental (retorno sobre capital nuevo) | `quality_engine.py:65-87` | Quality |
| ROIC premium vs. mediana real de industria | `moat_engine.py:86-96` | Moat |
| Estabilidad de ROIC/margen (coef. de variación) | `moat_engine.py:110-124` | Moat |
| CAGR multi-ventana (3y/5y/10y) | `quality_engine.py:126-142` | Quality |
| Dirección de tendencia (mejorando/deteriorando) de ROIC, márgenes, ingresos | `deterioration_engine.py` | Deterioration |
| Capital allocation score (timing real de buybacks, consistencia de dividendo) | `capital_allocation_engine.py` | Capital Allocation |
| Benchmarks reales de industria (ROIC/margen/CAGR medianos de peers) | `industry_engine.py` | Industry |

Ninguna de estas conexiones existe hoy en `growth_buildup`
(`fundamental_analysis_service.py`), que sigue siendo, en producción, solo
CAGR histórico simple + 0.

### 4.3 Infraestructura de UI reutilizable sin cambios

- `ExplainableValue.tsx` — genérico, cero cambios necesarios.
- `src/lib/explainability.ts` — funciones adaptadoras puras; reutilizables si
  el nuevo motor emite factores en el mismo shape `{name, value, score,
  reason}` (trivial de cumplir).
- Patrón visual "nunca un solo número" de `ExecutiveSummaryPanel.tsx` —
  probado en 4+ valores distintos, extensible.
- `SensitivityHeatmap` — ya migrado a consumir datos reales del backend, el
  patrón visual (heatmap coral→gold→teal) es reutilizable para cualquier
  matriz nueva.
- `select_discount_rate` — el toggle WACC-vs-retorno-requerido, ya
  parcialmente conectado (Fase 4, Incremento 12).

---

## 5. Qué conviene rediseñar completamente

- **Growth Engine ponderado real** — hoy no existe ninguna combinación
  ponderada de factores; hay que construirlo desde cero, pero consumiendo las
  señales de la sección 4.2 (no recalculándolas).
- **La fuente de verdad del DCF en producción** — decidir si
  `project_driver_based_dcf` (ya construido) reemplaza al modelo legacy
  fade-simple, o si se rediseña un tercer modelo de 3 etapas (alto
  crecimiento → desaceleración → estable) como pide explícitamente el brief.
  El motor driver-based actual es de 2 etapas (año-1 → terminal, fade
  lineal) — el modelo de 3 etapas con desaceleración GRADUAL entre etapa 1 y
  2 (no solo hacia el terminal) es trabajo nuevo real.
- **Reverse DCF 2.0** — el root-finding (Brent's method) ya está resuelto y
  es reutilizable como técnica, pero hay que extenderlo a las preguntas
  nuevas: margen operativo implícito, ROIC implícito, ingresos implícitos,
  ya no solo crecimiento y margen FCF.
- **`ManualVsAiPanel`** — reescribir el tipo cerrado a una lista dinámica de
  N comparaciones.
- **Comparación con plataformas externas de valuación** (Simply Wall St,
  GuruFocus, ValueInvesting.io, Seeking Alpha, etc.) — **no existe absolutamente
  nada hoy**. El propio prompt de Arthur declara explícitamente que no tiene
  acceso a fuentes de terceros más allá del consenso de analistas de Wall
  Street. Esto es feature nueva de punta a punta: fetch, caché, tipo de
  datos, componente.
- **Backtest de estrategia de valuación** ("qué hubiera pasado comprando
  infravaloradas vs. sobrevaloradas vs. S&P 500") — **no existe**. Lo más
  cercano (`historical_backtest_service.py`) es un backtest de la
  composición ACTUAL del portafolio del usuario contra el S&P 500 histórico
  — arquitectura y propósito distintos. Reutilizable como pieza:
  `compute_ticker_annual_returns` y la tabla `SP500_ANNUAL_RETURNS`
  (1985-2025) — pero la lógica de "comprar/vender según señal de valuación
  histórica" no existe en ningún lado, y requeriría datos históricos de
  valuación por fecha que hoy no se almacenan (solo se cachea el último
  estado, no una serie histórica de "esta empresa estaba infravalorada en
  tal fecha según Nuvos").
- **Confidence Engine 2.0** — hoy pondera predictibilidad/calidad/
  completcompletitud de datos/dispersión/liquidez. El brief pide agregar
  consistencia del management y calidad de estados financieros — esto último
  ya tiene una señal parcial (`data_validation` flags de inconsistencias
  contables por año, `fundamental_analysis_service.py:716-735`) que hoy solo
  se usa para advertir en el prompt del LLM, no para el Confidence Score.

---

## 6. Decisión de arquitectura pendiente (para la sesión de diseño)

El brief pide 11 módulos. Mapeo de cada uno al estado real:

| # | Módulo del brief | Estado |
|---|---|---|
| 1 | Normalized FCF Engine | Existe una variante (margen ponderado por recencia); falta generalizar a múltiples métodos explícitos y elegibles |
| 2 | Growth Engine (multi-factor) | No existe — construir desde cero, consumiendo señales ya calculadas (sección 4.2) |
| 3 | Driver-Based Forecast Engine | **Ya existe** (`dcf_engine.py`) — decidir si se promueve a fuente de verdad |
| 4 | Modelo de 3 etapas | Parcialmente — hay fade lineal de 2 etapas; la desaceleración gradual de 3 etapas es nueva |
| 5 | Buyback Engine | Existe una versión (inferencia indirecta vía FCF/share CAGR); falta modelar dilución también |
| 6 | Reverse DCF 2.0 | Existe la técnica (root-finding) y 2 de 6 variables pedidas; faltan 4 |
| 7 | Fair Value Engine (2do método) | **Ya existe** (`consensus_valuation_service.py` + `fair_value_engine.py`) — desconectado del flujo principal |
| 8 | Rango de valor razonable (no punto único) | Parcialmente — Monte Carlo ya calculado y sin usar es la pieza que falta conectar |
| 9 | Explainability Engine | Infraestructura visual ya lista (`ExplainableValue.tsx`); falta que el nuevo motor emita el shape correcto |
| 10 | Sensitivity Engine | **Ya existe y funciona bien** (matriz real, ya en frontend) |
| 11 | Confidence Engine 2.0 | Existe v1/v2; faltan 2 de las señales pedidas (consistencia de management, calidad de estados financieros) |

**Conclusión:** de los 11 módulos pedidos, **2 ya existen completos y
desconectados** (Driver-Based Forecast Engine, Fair Value Engine/segundo
método), **1 ya funciona bien tal cual** (Sensitivity Engine), y el resto son
extensiones reales de algo parcial o trabajo genuinamente nuevo. Esto cambia
la secuencia recomendada de trabajo: la primera fase de alto
impacto/bajo riesgo es *conectar* antes de *construir*.

---

## 7. Próximos pasos

Este documento no incluye plan de implementación ni diseño de arquitectura
final — eso corresponde a la siguiente sesión, una vez confirmado el alcance.
Preguntas abiertas para decidir antes de diseñar:

1. ¿El motor driver-based (`dcf_engine.py`) reemplaza al legacy como fuente
   de verdad, o coexisten con un criterio explícito de cuándo usar cada uno?
2. ¿El "rango de valor razonable" final se basa en percentiles de Monte
   Carlo, en el spread de consenso multi-método, o en ambos combinados?
3. ¿Comparación con plataformas externas y backtest de estrategia entran en
   el alcance de esta fase, o se separan en una fase 1.6 dado que son
   features nuevas de punta a punta sin ninguna pieza reutilizable de peso?
4. ¿Se valida el nuevo modelo contra el actual con una muestra de empresas
   antes de reemplazar producción (como pide el brief), y con qué criterio de
   éxito?

---

## 8. Decisiones de arquitectura confirmadas (2026-08-06)

Diego confirmó las 4 preguntas de la sección 7 más una quinta decisión.
Estas decisiones gobiernan toda la implementación de Fase 1.5:

1. **`dcf_engine.py::project_driver_based_dcf` reemplaza al modelo legacy
   (`legacy_dcf_core.py::_run_dcf`) como única fuente de verdad en
   producción.** El modelo legacy se conserva solo para regresión/
   validación, nunca como output de producción.
2. **Valor Razonable = Monte Carlo (percentiles) + Consensus Engine**
   (DCF + valoración relativa + múltiplos históricos). Nunca un valor
   único — siempre un rango respaldado por múltiples metodologías.
3. **Fuera de alcance de esta fase**: comparación con plataformas externas
   (AlphaSpread, GuruFocus, Simply Wall St) y backtesting de estrategia de
   valuación. Ambas pasan a una Fase 1.6 independiente.
4. **Gate de validación antes de reemplazar producción**: el nuevo motor se
   valida contra una muestra amplia multi-sector. El criterio de éxito NO es
   "replica al modelo anterior" — es mayor coherencia financiera, mayor
   estabilidad trimestre a trimestre, menos valoraciones extremas, mejor
   explicación de supuestos, y una distribución más razonable de márgenes de
   seguridad.
5. **Reutilizar primero, nunca reescribir motores sólidos** — consolidar bajo
   una arquitectura modular con una única fuente de verdad para toda la
   aplicación (web + mobile + backend).

---

## 9. Inventario de cálculos financieros duplicados

Búsqueda exhaustiva en backend completo + frontend web + frontend mobile
(dos apps sin paquete compartido — todo lo duplicado entre ellas fue copiado
a mano). Formato pedido: cálculo → dónde vive hoy → fuente de verdad futura.

### 9.1 Núcleo de valuación (prioridad alta — esto es lo que Fase 1.5 debe consolidar)

| Cálculo | Archivo(s) actuales | Fuente de verdad futura | Nota |
|---|---|---|---|
| **DCF / valor intrínseco** | `legacy_dcf_core.py::_run_dcf` (backend, producción hoy) · `valuation/dcf_engine.py::project_driver_based_dcf` (backend, calculado pero no usado en producción) · `frontend/web/src/lib/dcfCalculator.ts` (calculadora manual interactiva) · `frontend/mobile/src/lib/dcfCalculator.ts` (copia byte-a-byte de web, solo el comentario difiere) · `saved_valuation_service.py` (reproduce deliberadamente la fórmula de `dcfCalculator.ts`, no la de `_run_dcf`, para que "Mis Valoraciones Guardadas" coincida con lo que el usuario vio) | **`dcf_engine.py::project_driver_based_dcf`** (decisión #1 ya confirmada) | El legacy queda solo para regresión. Los DCF client-side (web/mobile) deben pasar a usar el fade lineal real en vez de crecimiento constante — ver 9.3. `saved_valuation_service.py` debe migrar a la misma fórmula para dejar de tener una 4ª variante. |
| **WACC / tasa de descuento** | `fundamental_analysis_service.py::_calc_wacc` (única implementación real) | **Ya consolidado** — extraer a un módulo propio (`valuation/wacc_engine.py`) es más un tema de organización que de deduplicación real | Confirmado por grep exhaustivo: no hay ninguna otra implementación de CAPM/WACC en el backend. `dcf_engine.py::select_discount_rate` es solo un toggle WACC-vs-retorno-requerido, no recalcula. |
| **Growth / CAGR** | `valuation/numeric_helpers.py::_cagr` (única implementación) | **Ya consolidado** — pero la FÓRMULA de crecimiento futuro (`growth_buildup`, hoy CAGR simple) es la pieza que sí hay que rediseñar (GrowthEngine, decisión ya tomada de construirlo nuevo) | No confundir "la primitiva CAGR está consolidada" con "el growth buildup ya es multi-factor" — no lo es, ver auditoría sección 2. |
| **Reverse DCF** | `valuation/reverse_dcf_engine.py` (backend, única implementación real — 3 variantes de root-finding) | **`valuation/reverse_dcf_engine.py`**, extendido con las 4 variables nuevas que pide el brief (margen operativo implícito, ROIC implícito, ingresos implícitos, FCF implícito) | Frontend (web y mobile) solo consume campos ya resueltos — confirmado, no hay reimplementación client-side. |
| **Fair Value / segundo método de valuación** | `valuation/fair_value_engine.py` (múltiplo justificado v1) · `relative_valuation_service.py` (Método 3, peers) · `historical_valuation_service.py` (Método 4, histórico propio) · `consensus_valuation_service.py` (combina los 3 + DCF con pesos por arquetipo) | **`consensus_valuation_service.py`** como orquestador; los 3 métodos que combina se mantienen como sub-módulos (no son redundantes entre sí — son metodologías distintas por diseño) | Esto ya es la arquitectura correcta (decisión #2) — el trabajo real es CONECTARLO al flujo principal, no consolidar más. |

### 9.2 Fórmulas puntuales duplicadas (prioridad media)

| Cálculo | Archivo(s):línea | Fuente de verdad futura | Nota |
|---|---|---|---|
| **Margen de seguridad** | `fundamental_analysis_service.py:633` · `fundamental_analysis_service.py:1185-1187` · `relative_valuation_service.py:124-127` · `historical_valuation_service.py:108-111` · `screener.py:765-768` · `saved_valuation_service.py:89` (⚠️ único con denominador `/price` en vez de `/intrinsic`) | Nuevo helper único `numeric_helpers.py::calc_margin_of_safety(intrinsic, price)` | **Bug real encontrado, no solo redundancia**: `saved_valuation_service.py:89` calcula `(intrinsic-price)/price`, los otros 5 sitios calculan `(intrinsic-price)/intrinsic` — el "% margen de seguridad" mostrado en Valoraciones Guardadas hoy NO es matemáticamente comparable con el resto de la app. Corregir al consolidar. |
| **Confidence Score** | `confidence_engine.py::_confidence_score` (v1) · `confidence_engine.py::compute_confidence_meter_v2` (v2, cross-method) · `fundamental_analysis_service.py:649-650` (3ª fórmula, solo para sector financiero, basada en volatilidad de ROE) | `confidence_engine.py` como único módulo, con la variante financiera **renombrada** (ej. `confidence_score_financial_sector`) en vez de compartir la clave `"confidence_score"` | Bug de nombre, no de lógica: las 3 fórmulas son legítimas para sus contextos, pero la 3ª se exporta bajo el mismo campo JSON que la v1/v2, así que downstream no puede distinguir cuál se está leyendo. |
| **FCF = CFO + Capex (auto-derivación cuando el proveedor no lo entrega)** | `financial_data_service.py:249-256` · `market_data_service.py:917-918` | `financial_data_service.py` (alimenta el motor de valuación real) | `market_data_service.py` alimenta el snapshot del LLM/chat — mismo cálculo, dos sitios; extraer `derive_fcf(cfo, capex)` compartido. |

### 9.3 Frontend/mobile — duplicación cross-plataforma

| Cálculo | Archivo(s) | Fuente de verdad futura | Nota |
|---|---|---|---|
| **DCF manual (calculadora interactiva)** | `web/src/lib/dcfCalculator.ts` (con tests) · `mobile/src/lib/dcfCalculator.ts` (copia idéntica, sin tests propios) | Idealmente un paquete compartido; si no es viable ahora, al menos actualizar ambos para usar el fade lineal real (consistente con `dcf_engine.py`) en vez de crecimiento constante | Es el caso de mayor riesgo real de "code drift": el propio comentario del archivo mobile admite que se mantiene igual "por inspección visual", sin red de tests cruzados. |
| **Margen de seguridad — inline, 3ª copia de la misma fórmula ya existente en el propio archivo** | `web/src/app/subvaluadas/page.tsx:727` · `mobile/app/subvaluadas/index.tsx:398` | La función `margenDeSeguridad()` que YA EXISTE en `dcfCalculator.ts` al lado — hoy no se usa | Fix trivial, alto impacto: elimina una 3ª reimplementación de la misma resta/división sin tocar ninguna lógica nueva. |
| **Ponderación de escenarios (`ScenarioWeightingPanel`)** | `web/src/components/subvaluadas/shared.tsx:355-367` · `mobile/src/components/subvaluadas/shared.tsx:295-307` | N/A — es un promedio ponderado de UI sobre 3 valores ya calculados por el backend, no una fórmula de valuación | Duplicación cross-plataforma legítima de una fórmula trivial (`Σ valor×peso_normalizado`), no requiere consolidación backend. |

### 9.4 Fuera del núcleo de valuación (no prioritario para Fase 1.5, mencionado para completitud)

| Cálculo | Archivo(s) | Nota |
|---|---|---|
| Score de tolerancia al riesgo (quiz de perfil) | `web/src/app/profile/edit/page.tsx` · `mobile/src/lib/profileStore.ts` | Duplicación cross-plataforma, regla de negocio de onboarding, no de valuación. |
| Delta de madurez de inversor | `web/src/lib/store.ts` · `mobile/src/lib/profileStore.ts` | Ídem. |
| Retorno de período (índices en Home) | `web/src/components/HomeMarketOverview.tsx` · `mobile/app/(tabs)/home.tsx` | Fórmula trivial `(last-first)/first`, duplicación cross-plataforma. |
| Interés compuesto (simulador de portfolio) | `web/src/app/portfolio/page.tsx` · `mobile/app/(tabs)/portfolio.tsx` | Simulador "qué pasaría si" 100% hipotético, no toca datos reales de valuación de empresas. |

### 9.5 Confirmado como YA consolidado (sin acción)

Terminal growth (`_sector_terminal_growth`, único), Composite/Ranking score
(`_composite_ranking_score`, único), Share count proyectado/buyback rate
(único), Sensitivity matrix/escenarios (`FCF_DCF_SCENARIOS`/
`EXCESS_RETURN_SCENARIOS`, único par), Monte Carlo (`monte_carlo_engine.py`,
único), jobs de `worker.py` (solo leen campos ya calculados, nunca
recalculan).

