# Nuvos AI Fair Value Engine — Audit de Rediseño

Auditoría de solo-lectura del backend en `/Users/diegoarria/IA_Investment_Advisor/backend`, mapeando el brief del "Nuvos AI Fair Value Engine" (una sola máquina, tres escenarios) contra lo que Fase 1.5 acaba de shippear.

## 0. Executive summary

**Cuánto ya existe.** Aproximadamente el 70% de la *maquinaria de cálculo* que pide el brief ya está construida y funcionando: el waterfall driver-based de 10 años (`backend/app/services/valuation/dcf_engine.py:188-314`), el fade gradual de crecimiento con meseta (`dcf_engine.py:140-152`), la interpolación lineal de margen operativo (`dcf_engine.py:133-137, 258`), un WACC CAPM real y dinámico con beta, tasa libre de riesgo viva, ERP, costo de deuda derivado de gasto por intereses y pesos de mercado E/D (`fundamental_analysis_service.py:312-379`), un motor multi-factor de supuestos de crecimiento (`growth_engine.py:103-237`), benchmarks de industria calculados en vivo con peers reales (`quality/industry_engine.py:99-165`), y toda la capa de señales de calidad (moat, ROIC incremental, deterioro, capital allocation, earnings quality). El puente Enterprise Value → +Caja −Deuda → /Acciones diluidas ya está implementado dentro del propio motor (`dcf_engine.py:308-313`).

**Cuánto falta construir.** Dos huecos reales y grandes: (a) **no existe ningún terminal value por múltiplo de salida** en todo el repositorio — cero coincidencias de `exit_multiple`/`terminal_multiple` en backend y frontend; los tres motores de DCF (`dcf_engine.py:285`, `legacy_dcf_core.py:48`, `legacy_dcf_core.py:73`) usan exclusivamente Gordon Growth, que el brief degrada explícitamente a sanity check interno. (b) **no existen estimaciones forward de Wall Street dentro del pipeline de valuación**: lo único que llega a `get_fundamental_analysis` es `fh_price_target` (`fundamental_analysis_service.py:859`), un price target, no un estimado de revenue/EPS/FCF. Sí existen estimados de EPS/revenue vía yfinance, pero viven en una ruta totalmente separada (`app/api/routes/market.py:2427-2456`, expuestos en `/stock-detail` línea 2553-2554) que solo consume `StockDetailModal.tsx:1492-1540` — el motor de valuación nunca los ve. Sin eso, el peso de 25% "Wall Street consensus" del brief no tiene input. Tampoco existe EV/Sales en ningún lado (solo `ps_ratio` en `market.py:2276`, fuera del pipeline).

**La tensión arquitectónica central.** Fase 1.5 acaba de shippear exactamente lo opuesto a lo que pide el brief. El Consensus Engine (`consensus_valuation_service.py:22-94`) existe para *multiplicar* métodos visibles al usuario y promediarlos con pesos por arquetipo; el brief quiere *colapsarlos* en una sola máquina con tres escenarios. Peor: hay una dependencia estructural silenciosa — `confidence_engine.compute_confidence_meter_v3` deriva su componente "cross-method agreement" (15% del score de confianza) del **spread entre los métodos independientes** (`confidence_engine.py:32-40, 160-179`, alimentado desde `screener.py:734-738`). Si se eliminan los métodos independientes, el medidor de confianza pierde uno de sus insumos y hay que redefinirlo. Y hay una segunda tensión, más incómoda, detallada en la sección 4: los "cuatro métodos" del Consensus en realidad son dos y medio.

## 1. Mapeo sección por sección del brief

### 1.1 Inputs — Estados financieros

| Requisito del brief | Estado | Referencia |
|---|---|---|
| Income Statement 5-10 años (Revenue, Gross Profit, Operating Income, Net Income, EPS diluido) | **Ya existe, reutilizable** | `fundamental_analysis_service.py:888-911` construye `gross_margin_trend`/`operating_margin_trend`/`net_margin_trend`; `Diluted EPS` leído en `historical_valuation_service.py:53` y `fundamental_analysis_service.py:1917` |
| Cash Flow (Operating CF, Capex, FCF) | **Ya existe, reutilizable** | `historical_valuation_service.py:61-62` (patrón `ocf - abs(capex)`); `fcf_trend` en el orquestador |
| Balance Sheet (Cash, Total Debt, Net Debt) | **Ya existe, reutilizable** | `fundamental_analysis_service.py:1962-1964` (`total_debt`, `cash`); `net_debt` en `relative_valuation_service.py:106` |
| Acciones diluidas | **Ya existe, reutilizable** | `projected_shares` (ajustado por buybacks) en `fundamental_analysis_service.py:1965-1966`; shares históricos back-out Net Income ÷ Diluted EPS en `historical_valuation_service.py:64` |

### 1.2 Inputs — Métricas calculadas

| Requisito | Estado | Referencia |
|---|---|---|
| Revenue CAGR 3/5/10 años | **Ya existe, reutilizable** | `quality/quality_engine.py:126-141` `compute_cagr_windows(trend, windows=(3,5,10))`, invocado en `fundamental_analysis_service.py:1232` |
| Gross / Operating / Net margins | **Ya existe, reutilizable** | `fundamental_analysis_service.py:888-911, 1217, 2238` |
| FCF margin | **Ya existe, reutilizable** | `fundamental_analysis_service.py:1034-1039` (promedio ponderado por recencia, no promedio plano) |
| **FCF Conversion = FCF / Net Income** | **No existe, hay que construir** | Cero coincidencias. El brief lo pide explícitamente como cross-check, y explícitamente permite &gt;100% para compounders. Hoy el motor usa *reinvestment rate sobre NOPAT* (`dcf_engine.py:262-264`), que es una parametrización distinta y no equivalente |
| ROIC / ROE | **Ya existe, reutilizable** | `roic_trend`/`avg_roic` en el orquestador; ROIC incremental en `quality_engine.compute_incremental_roic` (importado `fundamental_analysis_service.py:51`) |

### 1.3 Inputs — Market data

| Requisito | Estado | Referencia |
|---|---|---|
| Precio, market cap, shares, diluted shares | **Ya existe, reutilizable** | `fundamental_analysis_service.py:1965-1967` |
| P/E, EV/EBITDA, EV/FCF, P/FCF | **Ya existe, reutilizable** | `fundamental_analysis_service.py:2075-2095`, expuestos en `:2326+` |
| **EV/Sales** | **No existe, hay que construir** | Solo `ps_ratio` en `market.py:2276`, fuera del pipeline de valuación. El brief lo nombra como métrica preferida de exit multiple para tech |
| Medianas 3y/5y propias de cada múltiplo | **Existe parcialmente** | `historical_valuation_service.py:113-124` devuelve **medianas de todo el historial disponible** (`historical_median_pe`, `historical_median_ev_ebitda`, `historical_median_p_fcf`), no ventanas 3y/5y separadas. El motor de cálculo está (líneas 48-104); falta solo el ventaneo |
| Medianas de sector | **Ya existe, reutilizable** | `relative_valuation_service.py:136-139` (`peer_median_pe`, `peer_median_ev_ebitda`, `peer_median_ev_fcf`, `peer_median_p_fcf`) sobre peers reales del UNIVERSE curado |

### 1.4 Inputs — Datos externos

| Requisito | Estado | Referencia |
|---|---|---|
| **Wall Street revenue/EPS/FCF estimates** | **No existe en el pipeline de valuación** | Ver sección 2(b) |
| Industry growth rates | **Ya existe, reutilizable** | `quality/industry_engine.py:99-165` `compute_industry_benchmarks` devuelve `median_revenue_cagr_pct`, `median_roic_pct`, `median_operating_margin_pct`, `median_fcf_margin_pct` desde peers reales (nunca tabla estática — decisión documentada en `industry_engine.py:14-25`) |

### 1.5 "AI Assumptions Engine" — blend Histórico 30% / Industria 25% / Wall Street 25% / Calidad 20%

**Existe parcialmente, necesita extenderse — y con una diferencia conceptual importante.**

`growth_engine.compute_weighted_growth` (`growth_engine.py:103-237`) hace algo estructuralmente parecido pero **no es el blend del brief**. Diferencias reales:

- Su output es `historical_CAGR + ajuste`, no una mezcla ponderada de cuatro *fuentes independientes*. El histórico no es un "30% del blend": es el **ancla base**, y todo lo demás es un ajuste acotado a **±2.0 puntos porcentuales** (`growth_engine.py:66` `_MAX_ADJUSTMENT_PP = 2.0`, aplicado en `:229-231`). Es decir: hoy la industria y la calidad *no pueden* mover el crecimiento más de 2pp respecto del histórico. El brief quiere que la industria pese 25% y la calidad 20% del resultado, lo que implica desviaciones mucho mayores.
- Los pesos actuales (`growth_engine.py:68-75`) son: `recent_growth_trend` 0.25, `incremental_roic_vs_average` 0.20, `moat_stability` 0.20, `deterioration_direction` 0.20, `capital_allocation` 0.10, `industry_growth_comparison` **0.05**. La industria pesa 5%, no 25%.
- **No hay factor de Wall Street consensus en absoluto.** Serían 6 factores → 7.
- `industry_growth_comparison` y `capital_allocation` son **opcionales** y en el flujo síncrono principal llegan como `None` (documentado en `growth_engine.py:32-42`); `weighted_mean` renormaliza sobre lo que sí hay. En la práctica, en el request en vivo, el factor de industria suele estar ausente.
- Solo cubre **crecimiento de revenue**. No hay equivalente para márgenes, FCF margin, WACC ni múltiplo terminal — el brief pide que el Assumptions Engine gobierne todos esos.

Veredicto: la *arquitectura* (factores explicables `{name, value, score, reason}`, blending con renormalización) es reutilizable tal cual; los *pesos, el rango y el alcance* no.

### 1.6 Proyección explícita a 10 años con fade gradual

**Ya existe, reutilizable.** `dcf_engine.py:88` `_PROJECTION_YEARS = 10`. Fade de crecimiento con meseta de tres etapas en `_fade_growth_with_plateau` (`dcf_engine.py:140-152`); interpolación lineal de margen operativo en `_fade` (`dcf_engine.py:133-137`, aplicada en `:258`). El brief pide exactamente esto.

Diferencia real: el brief pide **margen inicial → margen final** como dos supuestos distintos por escenario. Hoy el orquestador pasa **el mismo valor a ambos extremos** en todas las llamadas de producción — `operating_margin_anchor_pct=operating_margin_anchor, terminal_operating_margin_pct=operating_margin_anchor` (`fundamental_analysis_service.py:1635-1636`, `:1683-1684`, `:1720-1721`, `:1756`, `:1769-1770`, `:1778-1779`). El motor *soporta* márgenes que evolucionan; el orquestador **nunca los usa**. Esto es un cambio de un parámetro, no de arquitectura.

### 1.7 FCF = Revenue × FCF Margin

**Existe parcialmente, necesita extenderse.** El motor driver-based **no** calcula FCF así: va Revenue → Operating Margin → EBIT → Tax → NOPAT → Reinvestment → FCF (`dcf_engine.py:255-264`), donde `fcf = nopat - reinvestment`. La parametrización directa `Revenue × FCF Margin` sí existe pero solo en el modelo **legacy**: `base_fcf = avg_fcf_margin * latest_rev` (`fundamental_analysis_service.py:1123-1124`). Son dos formulaciones distintas del mismo objeto; el brief pide explícitamente la segunda, con FCF Conversion como cross-check. Decidir cuál gana es una decisión de arquitectura real (ver sección 5).

### 1.8 WACC dinámico

**Ya existe, reutilizable — es la parte más sólida del código actual.** `_calc_wacc` (`fundamental_analysis_service.py:312-379`) implementa:
- Cost of equity = risk-free vivo + beta (clampeado 0.3-3.0, `:349`) × ERP 4.6% (`:302`)
- Cost of debt = |interest expense| / total debt, con piso 3% y techo 15% (`:352-355`); fallback risk-free + 150bps para empresas sin deuda
- Pesos de mercado E/D y escudo fiscal (`:357-359`)
- Clamp final 4%-20% (`:360`)
- Fallback sectorial explícito y **declarado** cuando falta beta o risk-free (`:346-347`)
- Hook de ajuste cualitativo `[-0.5%, +2.0%]` que **exige justificación escrita o lanza excepción** (`:334-338`) — infraestructura ya lista, ningún caller la usa aún

**Gap específico del brief:** el brief pide que "negocios de alto ROIC y bajo riesgo puedan recibir un WACC MENOR". Hoy `qualitative_adjustment_pct` puede bajar el WACC solo 0.5pp y ningún caller lo invoca; y no hay ningún input de **interest coverage** en `_calc_wacc` (existe como dato, se pasa a `fair_value_engine.compute_justified_multiple` en `screener.py:771`, pero no al WACC). Extensión, no construcción desde cero.

### 1.9 Terminal Value híbrido (Exit Multiple primario, Gordon como sanity check)

**No existe, hay que construir.** Ver sección 2(a).

Lo más cercano que existe es `valuation/fair_value_engine.py` — y hay que ser preciso sobre qué es y qué no es. Es una **valuación standalone completa** (`Valor Razonable = EPS × Múltiplo Justificado`, `fair_value_engine.py:11`), no un terminal value. Construye un múltiplo desde una **tabla estática de P/E base por sector** (`fair_value_engine.py:43-61`, con la advertencia honesta en `:37-42` de que son anclas ilustrativas no backtesteadas) más ajustes aditivos acotados por crecimiento, calidad (spread ROIC−WACC), FCF margin, apalancamiento, cobertura de intereses, dividendo, moat y management (invocado en `screener.py:764-775`), con clamp final `[5.0, 60.0]` (`fair_value_engine.py:63`).

Es reutilizable como **punto de partida conceptual** para derivar el exit multiple, pero le faltan tres cosas que el brief pide explícitamente: (1) usa solo P/E, nunca EV/Sales ni EV/EBITDA ni múltiplo de FCF; (2) su base es una tabla estática, no el histórico propio de la empresa ni la mediana real de sector/industria (ambas ya calculadas en otros archivos); (3) no tiene selección de métrica por tipo de negocio. Y sobre todo: se aplica al **EPS de hoy**, no al año 10 proyectado.

### 1.10 EV → Equity Value → Fair Value por acción, para cada escenario

**Ya existe, reutilizable.** `dcf_engine.py:284-313`: `enterprise_value = pv_sum + pv_terminal`, luego `equity_value = enterprise_value + net_cash`, luego `value_per_share = equity_value / shares_out`, con guarda de acciones positivas (`robustness.validate_positive_shares`). Ya se ejecuta por escenario en `driver_based_scenarios` (`fundamental_analysis_service.py:1673-1701`).

### 1.11 Output al usuario

| Requisito | Estado | Referencia |
|---|---|---|
| Precio actual + tres fair values | **Existe parcialmente** | `driver_based_scenarios` los tiene (`fundamental_analysis_service.py:1693-1701`) pero **no se muestran**: están en modo sombra, expuestos en `screener.py:1044` y tipados en el frontend, sin panel que los renderice |
| "¿Qué escenario implica el precio actual?" | **Existe parcialmente** | `reverse_dcf_engine.py` (437 líneas) resuelve crecimiento/margen/ROIC/revenue implícitos por Brent; `probability_undervalued_pct` de Monte Carlo (`fundamental_analysis_service.py:1889`) responde una variante probabilística. Falta el mapeo literal precio→escenario |
| Supuestos clave visibles (CAGR, margen final, FCF margin, WACC, múltiplo terminal) | **Existe parcialmente** | `DriverBasedDcfResult.assumptions` (`dcf_engine.py:295-305`) ya emite 9 supuestos por corrida. Falta el múltiplo terminal (no existe) y el FCF margin (no es parámetro de este motor) |
| Explicación IA del *porqué* de cada supuesto | **Existe parcialmente** | El patrón `{name, value, score, reason}` está en `growth_engine.py:78-89` y replicado en todos los `quality/*_engine.py`; se renderiza sin adaptador vía `ExplainableValue.tsx`/`lib/explainability.ts`. Falta extenderlo a márgenes, WACC y múltiplo terminal |
| Framing "estimación razonable, nunca precio exacto" | **Ya existe** | `fair_value_range` nunca es punto único (`fundamental_analysis_service.py:426-441, 444-490`) |

### 1.12 Filosofía (no Ben Graham, no sesgo conservador excesivo)

**Existe parcialmente — y hay evidencia directa de que este problema ya se vivió.** El docstring de `growth_engine.py:5-12` documenta que el `moat_adjustment` original (hasta +3pp para ROIC ≥40%) **fue removido** porque en pruebas reales con TSM/Adobe/Intuit producía márgenes de seguridad de 55-67% que "no se sostenían". Hoy `moat_adjustment = 0.0` permanentemente en el modelo legacy que el usuario ve, y su reemplazo (`growth_engine`) está acotado a ±2pp y en modo sombra.

Lo que existe a favor del brief: la clasificación de arquetipo `secular_compounder` (`consensus_valuation_service.py:40-41`, requiere quality ≥80 y predictability ≥75) y el ancla de reinversión por identidad de Damodaran `reinvestment_rate = g / ROIC` (`dcf_engine.py:249`), que sí premia estructuralmente a los negocios de alto ROIC.

Lo que juega en contra: `FCF_DCF_SCENARIOS` (`fundamental_analysis_service.py:286-290`) aplica **topes de crecimiento planos a todas las empresas por igual** — base capeado a 25%, optimista a 40% — y multiplicadores fijos (pesimista ×0.5, base ×1.0, optimista ×1.3) sin ninguna sensibilidad a la calidad del negocio. Ese es, mecánicamente, el "trato igual para el negocio excepcional y el promedio" que el brief pide eliminar.

## 2. Análisis de los dos gaps genuinos

### (a) Terminal value por múltiplo de salida: NO EXISTE — confirmado

Grep sobre todo el repo (`backend` + `frontend`, `*.py`/`*.ts`/`*.tsx`) de `exit_multiple`, `terminal_multiple`, `exitMultiple`, "múltiplo de salida": **cero resultados**.

Los tres únicos terminal values del codebase son Gordon Growth:
- `dcf_engine.py:285` — `terminal_value = final_fcf * (1 + terminal_growth) / (discount_rate - terminal_growth)`
- `legacy_dcf_core.py:48` — idéntica fórmula, modelo legacy de dos etapas
- `legacy_dcf_core.py:73` — idéntica fórmula, variante de crecimiento constante para Expectations Investing

El brief invierte la jerarquía: exit multiple primario, Gordon como sanity check interno. Consecuencias concretas de ese cambio:

1. **`robustness.validate_discount_beats_terminal_growth` deja de ser bloqueante.** Hoy, si el WACC no supera al crecimiento terminal por un margen sano, `project_driver_based_dcf` **lanza excepción y no devuelve valuación** (`dcf_engine.py:232`). Con exit multiple primario, esa condición ya no impide calcular un valor. Monte Carlo descarta draws por esta razón (`monte_carlo_engine.py`, nota de diseño 3), así que su tasa de descarte cambiaría materialmente.
2. **`terminal_roic_pct` deja de ser obligatorio.** Hoy `dcf_engine.py:243-249` exige ROIC terminal positivo porque el reinvestment rate terminal depende de él. Con exit multiple, esa dependencia desaparece del cálculo del TV (aunque sigue rigiendo el fade de reinversión).
3. **Los insumos para derivar el múltiplo YA EXISTEN, dispersos en cuatro archivos** — histórico propio en `historical_valuation_service.py:113-121`, sector/industria en `relative_valuation_service.py:136-139`, categoría de industria en `industry_engine.py:76-85` (`classify_industry` ya distingue Software / Semiconductors / Marketplace / Financials / REIT / Utilities, exactamente el eje "tipo de empresa" que el brief pide para elegir la métrica), y ajuste por calidad de negocio en `fair_value_engine.py:110-120`. Ninguno de ellos se ha conectado nunca a un DCF. **No hay ajuste por país en ningún lado.**

### (b) Estimaciones forward de Wall Street: NO llegan al pipeline de valuación — confirmado

Lo que **sí** existe:
- `fh_price_target` (`fundamental_analysis_service.py:22, 859`) — price target, no un estimado de fundamentales. El comentario en `:847-852` es explícito: "un punto de referencia SEPARADO, nunca mezclado en la matemática del DCF".
- `fh_recommendation` — distribución buy/hold/sell.
- Estimados de EPS y revenue **próximo trimestre / próximo año** en la ruta de earnings: `app/api/routes/earnings.py:115, 162-164, 203-205, 311, 374, 409-411, 661-666` (Finnhub + FMP).
- Estimados forward de EPS y revenue vía yfinance (`t.earnings_estimate`, `t.revenue_estimate`) en `app/api/routes/market.py:2427-2456`, con fallback vía `earningsTrend` en `:2503-2527`, devueltos por `/stock-detail` en `:2553-2554`.

Lo que **no** existe:
- **Ningún consumidor de esos estimados fuera del frontend.** El único consumidor es `StockDetailModal.tsx:1492-1540`, que los muestra en una tabla. `fundamental_analysis_service.py` nunca importa nada de `market.py` ni de `earnings.py`.
- **Ningún estimado de FCF** de ninguna fuente.
- **Ningún estimado más allá de ~2 años.** El brief quiere alimentar una proyección a 10 años; el consenso disponible cubre próximo trimestre y próximo año fiscal, a veces dos.
- `forward_eps` existe en `market.py:2281` pero, de nuevo, fuera del pipeline.

Implicación directa: el peso de **25% "Wall Street consensus"** del AI Assumptions Engine no tiene hoy ningún dato que lo alimente dentro del motor de valuación. Requiere: (i) mover/duplicar el fetch a un servicio consumible desde `fundamental_analysis_service`, (ii) resolver qué hacer con el hecho de que el consenso solo cubre 1-2 años de una proyección de 10, (iii) decidir el fallback cuando no hay cobertura de analistas (el `liquidity_gate` ya trackea `analyst_coverage`, `fundamental_analysis_service.py:845`).

## 3. Qué habría que ELIMINAR o plegar del frontend

Hallazgo clave: **la superficie visible al usuario es mucho menor de lo que sugiere el backend.** La mayoría de los "métodos" de Fase 1.5 se calculan y se serializan pero nunca se renderizan.

### Se muestra hoy y entra en conflicto directo con el brief

| Qué | Dónde | Conflicto |
|---|---|---|
| **Desglose de Consensus por método** | `components/subvaluadas/shared.tsx:325-334` — itera `consensus.methods_used` y pinta un chip por método: literalmente los strings `conservative dcf: $X`, `professional dcf: $Y`, `relative: $Z`, `historical: $W` (vía `key.replace(/_/g," ")` en `:329`) | **Esto es exactamente lo que el brief manda eliminar.** Es el único lugar del UI donde el usuario ve las cuatro etiquetas |
| **Label "Consenso" del rango** | `shared.tsx:317` — `consensus ? t("subvaluadas.fairValueRange.consensus") : t("subvaluadas.fairValueRange.label")` | El titular del rango se llama "Consenso" cuando hay consenso |
| **Valor base = consensus** | `shared.tsx:313` — `const baseValue = consensus?.consensus_fair_value ?? range.base` | El número central que ve el usuario **es** el promedio ponderado del Consensus, no el base case de un DCF |
| Panel de escenarios con pesos ajustables | `page.tsx:1254-1258` → `ScenarioWeightingPanel` (`shared.tsx:394-446`) | Muestra pessimistic/base/optimistic del modelo **legacy** con sliders de probabilidad. Es el candidato natural a convertirse en Bear/Base/Bull, pero hoy alimenta un valor esperado ponderado — concepto que el brief no pide |
| Heatmap de sensibilidad | `page.tsx:1250-1252` `SensitivityHeatmap` | No lo pide el brief; decisión abierta si sobrevive |
| Panel Reverse DCF / Expectations | `page.tsx:1260-1268` `ReverseDcfPanel` (`shared.tsx:448+`) | Es lo más cercano a "qué escenario implica el precio actual"; probablemente se pliega en vez de eliminarse |
| Preview Growth Engine (solo tier Profesional) | `page.tsx:1270-1278` `GrowthEnginePreviewPanel` (`shared.tsx:509+`) | Se convierte en el panel de "por qué elegimos estos supuestos" |
| Calculadora DCF manual con sliders | `page.tsx:1120-1240` (growth/WACC/terminal growth) + `ManualVsAiPanel` (`page.tsx:1228-1246`) | El brief no menciona edición manual de supuestos. Decisión abierta |
| Gating por nivel de detalle | `lib/detailLevel.ts:38-78` — secciones `dcf_full`/`monte_carlo`/`reverse_dcf`/`sensitivity`/`scenarios` en "avanzado", `raw_assumptions`/`factors_detail` en "profesional" | Un motor único con tres escenarios simplifica este mapa considerablemente |

### Se calcula y se envía pero NO se renderiza (deuda muerta, sorpresa del audit)

- **Monte Carlo**: calculado 2000× (`fundamental_analysis_service.py:1830-1892`), serializado (`screener.py:1048`), tipado en `lib/detailLevel.ts:50` — **cero componentes lo renderizan**. Grep de `monte_carlo`/`monteCarlo` en `frontend/web/src`: solo `detailLevel.ts:50,71`. Su única influencia real sobre el usuario es indirecta, vía P25/P75 dentro de `combine_fair_value_range` (`fundamental_analysis_service.py:463-476`).
- **Fair Value Engine**: calculado en `screener.py:753-790`, enviado en `:1050`, tipado en `page.tsx:20,92` y `shared.tsx:167` — **ningún componente lo consume**. Nunca llegó a la pantalla.
- **`driver_based_scenarios` / `driver_based_sensitivity_matrix` / `driver_based_value_drivers` / `driver_based_valuation`**: enviados en `screener.py:1036, 1044-1046`, **no renderizados**. Modo sombra explícito, documentado en `screener.py:1037-1043` como "no cableado a la valuación primaria hasta el flip de producción (Incremento 7, bloqueado por el harness de validación)".
- **`relative_valuation` / `historical_valuation` crudos**: enviados en `screener.py:1059-1060`; solo se ven vía los chips del Consensus.

**Conclusión de la sección 3:** para cumplir el requisito "una sola máquina, tres escenarios, sin métodos separados visibles", el cambio de UI mínimo obligatorio es **`shared.tsx:309-340`** — es el único punto donde los cuatro métodos son visibles. Todo lo demás es limpieza opcional de backend/deuda muerta.

## 4. Tabla de duplicación / consolidación

Existen **cuatro** outputs con forma de escenario, más un quinto derivado:

| Output | Ubicación | Motor subyacente | Terminal value | ¿Visible? | ¿Candidato a Bear/Base/Bull? |
|---|---|---|---|---|---|
| `scenarios` (legacy) | `fundamental_analysis_service.py:1270-1340` (bucle sobre `FCF_DCF_SCENARIOS`), emitido `:1968` | `legacy_dcf_core._run_dcf` — proyecta FCF directo, fade de 2 etapas | Gordon (`legacy_dcf_core.py:48`) | **Sí** — `ScenarioWeightingPanel` (`page.tsx:1254`) y alimenta `intrinsic_value_base` (`screener.py:1005`) | **No.** Modelo antiguo sin waterfall de drivers; el brief pide proyectar el negocio, no el FCF |
| `driver_based_scenarios` | `fundamental_analysis_service.py:1665-1701`, emitido `:1996` | `dcf_engine.project_driver_based_dcf` — waterfall completo, fade de 3 etapas | Gordon (`dcf_engine.py:285`) | No (sombra) | **SÍ — el mejor candidato con diferencia** |
| Percentiles Monte Carlo | `fundamental_analysis_service.py:1878-1890` | El mismo `project_driver_based_dcf`, 2000 draws | Gordon | No (solo P25/P75 dentro del rango) | **No como output principal.** P10/median/P90 *parecen* Bear/Base/Bull pero son percentiles de una distribución, no escenarios narrativos con supuestos explicables. El brief exige mostrar supuestos por escenario; un percentil no tiene un juego de supuestos único. Útil como capa de probabilidad *encima* de los tres escenarios |
| 4 métodos del Consensus | `consensus_valuation_service.py:62-73` | **Ver abajo** | Mixto | **Sí** — `shared.tsx:325-334` | **No** — es lo que hay que eliminar |
| `fair_value_range` combinado | `fundamental_analysis_service.py:444-490`, emitido `:1969` | Combina P25/median/P75 de MC + spread del Consensus, con fallback al rango legacy | — | **Sí**, es el número titular | Se reemplaza por Bear/Base/Bull directamente |

### Por qué `driver_based_scenarios` es el candidato

Ya tiene: (1) exactamente tres escenarios con la misma forma; (2) el waterfall driver-based que el brief describe; (3) fade de 10 años con meseta; (4) el puente EV→Equity→por acción integrado; (5) `assumptions` explicables por corrida (`dcf_engine.py:295-305`); (6) WACC dinámico por escenario (`fundamental_analysis_service.py:1676`); (7) revenue y FCF de año 1 y año 10 ya emitidos (`:1697-1700`).

Cambios necesarios sobre él:
1. **Terminal value → exit multiple** (`dcf_engine.py:284-287`), con Gordon relegado a sanity check interno.
2. **Reemplazar `FCF_DCF_SCENARIOS`** (`fundamental_analysis_service.py:286-290`): hoy los tres escenarios difieren **solo** en multiplicador de crecimiento, delta de WACC y tope de crecimiento. El brief pide que difieran además en margen final, FCF margin y múltiplo terminal.
3. **Márgenes que evolucionan**: dejar de pasar el mismo valor a `operating_margin_anchor_pct` y `terminal_operating_margin_pct` (`:1683-1684`).
4. **Añadir FCF margin y FCF conversion** como parámetros/cross-check.
5. **Renombrar** `pessimistic`/`base`/`optimistic` → `bear`/`base`/`bull` (o mapear en la capa de presentación) — afecta `shared.tsx:406-408`, `_fair_value_range` (`:426-441`), `combine_fair_value_range`, `probability_weights` (`:1979`), y las claves i18n `subvaluadas.scenarios.*`.
6. **Eliminar los topes planos de crecimiento** o hacerlos sensibles a la calidad del negocio.

### La duplicación más grave (y la sorpresa central del audit)

El Consensus **no** mezcla cuatro métodos independientes. `consensus_valuation_service.py:8-15` lo admite en su propio docstring, y el orquestador lo confirma:

```
fundamental_analysis_service.py:1944-1945
conservative_dcf_value = scenarios["pessimistic"]["intrinsic_value_per_share"]
professional_dcf_value = scenarios["base"]["intrinsic_value_per_share"]
```
(idéntico en `screener.py:572-573`)

O sea: "Conservative DCF" y "Professional DCF" son **el escenario pesimista y el escenario base del mismo modelo legacy**. No son dos DCFs. Son dos puntos de una misma curva, presentados al usuario como métodos independientes y luego promediados entre sí con pesos por arquetipo (`consensus_valuation_service.py:22-27`) — para `secular_compounder`, 80% del peso total (0.35 + 0.45) recae sobre dos corridas del mismo motor.

Además esto contamina el score de confianza: `screener.py:734-738` alimenta `method_values` con `scenarios["base"]` + relative + historical para calcular el "cross-method agreement" (`confidence_engine.py:32-40`) — pero el escenario base no es un método independiente de los otros dos en el sentido que el score asume.

Lo bueno: esto hace la eliminación que pide el brief **mucho menos destructiva de lo que parece**. Borrar "Conservative DCF" y "Professional DCF" como métodos no borra ningún cálculo — son escenarios que sobreviven de todos modos, solo dejan de tener nombres de método.

## 5. Preguntas abiertas para Diego

1. **"Eliminar Relative Valuation como método independiente" — ¿borrar o replegar?** `relative_valuation_service.py` calcula medianas reales de peers para P/E, EV/EBITDA, EV/FCF y P/FCF (`:136-139`) sobre 5-10 peers reales del UNIVERSE. Eso es **precisamente** el insumo "sector/industria" que necesita el exit multiple del brief. Interpretación A: borrar el archivo y su valor implícito. Interpretación B: dejar de mostrar `intrinsic_value_per_share` como método y reusar las medianas como input del múltiplo terminal. La B parece obviamente mejor, pero cambia el sentido de "eliminar".

2. **Lo mismo con Historical Valuation.** `historical_valuation_service.py:113-121` produce las medianas históricas *propias* de la empresa — el primer insumo que el brief nombra para derivar el múltiplo de salida ("histórico de la propia empresa"). ¿Se pliega o se elimina? Nota de costo: requiere una llamada FMP de precios históricos por ticker (`:41, 46`).

3. **¿Qué pasa con el archetype routing?** `classify_archetype` (`consensus_valuation_service.py:30-44`) distingue financials / secular_compounder / cyclical / balanced. Si muere el Consensus, ¿muere el arquetipo, o se reusa para elegir la métrica del exit multiple (el brief pide "EV/Sales o EV/EBITDA para tech, P/E o FCF para maduras")? Ojo: `industry_engine.classify_industry` (`:76-85`) hace una clasificación **distinta y más granular** (Software / Semiconductors / Marketplace / REIT / …). Tener dos taxonomías compitiendo para la misma decisión es un riesgo real.

4. **Financieras y REITs.** El modelo actual bifurca: sector financiero usa Excess Return / Justified P-B (`EXCESS_RETURN_SCENARIOS`, `fundamental_analysis_service.py:295-299`; `methodology == "residual_income_justified_pb"`, `screener.py:756`), y REITs se excluyen explícitamente del waterfall (`dcf_engine.py:90-109`). El brief no los menciona. ¿La máquina única los cubre, o siguen en un carril aparte? Hoy el Fair Value Engine ya se saltea a las financieras (`screener.py:756`).

5. **FCF: ¿`Revenue × FCF Margin` o `NOPAT − Reinvestment`?** El brief pide la primera (§1.7). El motor hace la segunda (`dcf_engine.py:255-264`), con un razonamiento explícito y bien argumentado en `dcf_engine.py:38-61` sobre por qué modela una tasa de reinversión agregada anclada en la identidad de Damodaran. Cambiar a `Revenue × FCF Margin` **descarta ese ancla de consistencia** entre crecimiento terminal, ROIC y reinversión. ¿Se acepta esa pérdida, o se mantiene la parametrización actual y se reporta el FCF margin implícito como output derivado?

6. **¿Qué reemplaza el "cross-method agreement" del medidor de confianza?** Pesa 15% en v3 (`confidence_engine.py:179`) y 20% en versiones previas (`:90, 257`), y hoy se alimenta del spread entre métodos (`screener.py:734-738`). Sin métodos separados, ¿se usa el spread Bear↔Bull (que sería circular: los escenarios se diseñan para diferir), la dispersión de Monte Carlo, o se redistribuye el peso?

7. **¿Sobrevive Monte Carlo?** Hoy no se muestra pero sí mueve el número titular vía P25/P75 (`fundamental_analysis_service.py:463-476`). Con tres escenarios explícitos, el rango sale de Bear y Bull. ¿MC se borra, se vuelve "probabilidad de que el precio actual esté por debajo del valor justo" (ya existe: `probability_undervalued_pct`, `:1889`), o se muestra por fin?

8. **¿Sobrevive la calculadora manual de DCF?** `page.tsx:1120-1246` es una feature grande (sliders + `ManualVsAiPanel` + guardado de valuaciones vía `saved_valuation_service.py`, 301 líneas) que asume un DCF de tres inputs (g, WACC, terminal g). Un motor de exit multiple no encaja en esos tres sliders.

9. **"Ajuste por país" del exit multiple.** El brief lo lista entre los determinantes del múltiplo. **No existe ningún dato de país/riesgo soberano en el codebase** — ni prima de riesgo país, ni tasa libre de riesgo por país (`get_risk_free_rate()` es una sola tasa global). ¿Se descarta o se construye desde cero?

10. **¿Qué se hace con `fair_value_engine.py`?** Con el exit multiple dentro del DCF, su función ("¿es razonable el precio dado el múltiplo justificado?") queda mayormente absorbida. Nunca se mostró al usuario. ¿Se borra, o su lógica de ajustes acotados (`:91-120+`) se convierte en el derivador del exit multiple?

11. **Estrategia de datos para el 25% de Wall Street.** ¿Se acepta un peso del 25% alimentado por un consenso que solo cubre 1-2 años de una proyección a 10? ¿Y cuál es el fallback para tickers sin cobertura — renormalizar los otros tres pesos (como ya hace `growth_engine` vía `weighted_mean`), o degradar el score de confianza?

12. **El "flip de producción" pendiente.** `screener.py:1037-1043` documenta que el motor driver-based está bloqueado por un harness de validación (Incremento 6/7) que nunca se completó. ¿El rediseño hace ese flip como parte del trabajo, o hereda el estado de modo-sombra? Hoy, todo número que el usuario ve viene del motor **legacy** (`legacy_dcf_core.py`), no del driver-based.
