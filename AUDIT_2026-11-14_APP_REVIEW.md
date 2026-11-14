# Auditoría integral Nuvos — App Review readiness (iniciada 2026-11-14)

Rama: `etf-phase0-asset-classification`. Este documento se actualiza a medida que avanza la auditoría — no representa un estado final.

## Leyenda
- **PASS** — verificado con evidencia (código + test real ejecutado).
- **FAIL** — bug reproducido, corregido o pendiente.
- **BLOCKED** — no se pudo verificar (sin dispositivo físico, credenciales, etc).
- **N/A** — funcionalidad inexistente o requisito no aplicable.

---

## Línea base de tests (Fase 0)

| Suite | Resultado | Evidencia |
|---|---|---|
| `frontend/mobile` (jest) | **129/129 PASS** (12 suites) | ejecutado 2026-11-14 |
| `frontend/web` (vitest) | **287/287 PASS** (25 suites) | ejecutado 2026-11-14 |
| `backend` (pytest, ENV_FILE=.env.development, Supabase local) | **2492/2492 PASS, 0 fallos, 0 omitidos** (418.06s, corrida final tras todos los cambios de hoy) | Progresión real durante la auditoría: 2486 (línea base) → 2490 (+4, tests de `delete_account`) → **2492 (+2, tests de BRK.B)**. Más el test de integración real `test_delete_account_integration.py` (2/2, corrido aparte contra Supabase local real, incluido en el 2492). 25 warnings, todos de deprecación (no funcionales): Pydantic v2 `class Config` style, `gotrue`→`supabase_auth` rename, `datetime.utcnow()` (decisions.py:57), FastAPI `@app.on_event` (main.py:25). **P3**, no corregidos en este pase — cosméticos, sin riesgo de rechazo de Apple ni de corrección. |

TypeScript mobile: **13 errores preexistentes**, no relacionados con los cambios de hoy (desajustes de tipos de `@types/react-navigation`/RefObject en `app/(tabs)/_layout.tsx`, `chat.tsx`, `learn.tsx`, `support.tsx`, `_layout.tsx`, `monthly-report.tsx`, `wrapped.tsx`). No bloquean el build de Expo (Babel solo despoja tipos). Severidad: **P3**, documentado, no corregido en este pase (fuera de alcance de los 3 motivos de rechazo de Apple).

---

## ⚠️ Distinción importante — estado real de los 3 motivos de rechazo

**Los 3 tienen corrección de código implementada y verificada con test unitario/mockeado. Ninguno tiene cierre end-to-end todavía.** Un test con mocks (Supabase mockeado, SDK de RevenueCat mockeado) prueba que la LÓGICA hace lo que promete, nunca que el sistema real (Supabase Auth + Postgres, StoreKit real, el SO denegando un permiso en una pantalla física) se comporta igual. No se declara ninguno de los 3 como "listo para reenviar a Apple" sin lo que falta abajo:

1. **Notificaciones (4.5.4):** PASS de unit test confirmado. Pendiente: **validación manual en un iPad/iPhone físico** con el permiso realmente denegado desde el sistema operativo (no simulado) — confirmar que ninguna pantalla se queda bloqueada, ningún loading infinito, ningún re-prompt, navegando la app completa.
2. **Eliminación de cuenta (5.1.1v):** los tests con mocks (`test_delete_account.py`) prueban la lógica de orden/atomicidad del código Python, **no una transacción distribuida real** — Supabase Auth (GoTrue) y la base Postgres de `user_profiles`/etc. son dos sistemas distintos sin una transacción ACID conjunta entre ellos. Ver análisis detallado abajo. Pendiente: prueba de integración contra Supabase LOCAL real (no mocks) + grabación en dispositivo físico.
3. **RevenueCat (2.1b/3.1.1):** se agregó el botón de Restore Purchases a `PaywallModal.tsx`, pero **un botón visible no es lo mismo que una restauración funcional** — nunca se ha ejecutado una restauración real (requiere Sandbox/TestFlight). Mantener BLOCKED todo lo que dependa del dashboard de RevenueCat o de una compra/restauración real.

---

## Los 3 motivos de rechazo de Apple (14 nov 2026)

### 1. Guideline 4.5.4 — Notificaciones push obligatorias
**FAIL → FIXED, verificado con test real.** Causa raíz: `registerPushToken()` corría en un `useEffect` dependiente de `pathname` (`app/_layout.tsx`), así que su Alert de permiso (o el de "ve a Ajustes" si ya estaba denegado) **reaparecía en cada navegación** hasta que el usuario cedía — indistinguible de exigir el permiso.

Fix: la decisión de qué mostrar se extrajo a una función pura `decidePushPromptAction(status, alreadyPromptedThisSession)` en `src/lib/pushPermissionPrompt.ts`, conectada al componente real (`app/_layout.tsx`'s `registerPushToken`) — no es una reimplementación paralela, es la lógica real de producción.

Test: `src/lib/pushPermissionPrompt.test.ts`, **6/6 PASS**. Casos cubiertos: (a) `undetermined`+ya preguntado→`skip` (regresión exacta del bug: antes del fix esto devolvía `show_rationale` sin importar el estado de sesión), (b) `denied`+ya preguntado→`skip`, (c) primera vez `undetermined`→`show_rationale`, (d) primera vez `denied`→`show_settings_hint`, (e) `granted`→`register` siempre sin UI, (f) ninguna combinación produce una acción bloqueante (todas las acciones son no-bloqueantes, nunca cierran el paso a otras pantallas).

Suite completa mobile tras el fix: **135/135 PASS** (13 suites, antes 129/129 en 12 — 0 regresiones).

Verificado además por lectura de código: `onboarding/index.tsx` no solicita push en ningún punto; ninguna pantalla condiciona función alguna a `Notifications.getPermissionsAsync()`.

**Guideline 4.5.4 — cerrado a nivel de lógica unitaria (PASS con test real), NO cerrado end-to-end.** Pendiente: validación manual en iPad/iPhone físico con el permiso realmente denegado desde el SO (Ajustes), navegando la app completa, confirmando que ninguna pantalla bloquea y que no reaparece el aviso.

### 2. Guideline 2.1(b) — IAP no enviados a revisión
**N/A para código.** Es una tarea externa en App Store Connect (ya resuelta por Diego manualmente: grupo + 4 suscripciones consolidados en un Draft Submission y adjuntados a la versión). No hay cambio de código posible aquí.

### 3. Guideline 5.1.1(v) — Sin opción de eliminar cuenta
**FAIL → FIXED.** El backend (`DELETE /api/auth/account`) ya era robusto (atómico vía RPC `delete_user_data` sobre ~50 tablas, revoca Plaid, borra el usuario de Supabase Auth con cliente fresco para evitar contaminación de sesión — ver comentario in-line de 2026-10-20). El problema real era de UI: un link pequeño al fondo de Perfil, ya pasado por alto una vez (build 36) y otra vez (build 46).
Fix: `DeleteAccountModal.tsx` (nuevo, global, montado en `_layout.tsx`), con entrada en **Sidebar** y **Perfil**. Exige escribir la palabra de confirmación exacta. Nunca cierra sesión ni oculta un error salvo que el servidor confirme el borrado real. Incluye el aviso explícito (pedido por Apple) de que borrar la cuenta NO cancela una suscripción activa de Apple, con link a gestión de suscripción. Commits `92ae3ab8` + working tree (nota de suscripción, pendiente commit).

**Verificación de integración REAL (no mockeada) — Supabase local, nunca producción:**
`tests/test_delete_account_integration.py` (nuevo), **2/2 PASS**. Crea y destruye su propio usuario real en Supabase local en cada test (limpieza verificada, cero usuarios de prueba huérfanos al final). Prueba la pregunta exacta que pediste: **Supabase Auth (GoTrue) y Postgres NO son una transacción distribuida — son dos sistemas separados.**

- **La "ventana huérfana" es real y observable:** justo después de correr el RPC `delete_user_data` (que sí borra de verdad las filas en Postgres, confirmado por SELECT), el usuario de Auth **sigue existiendo** — confirmado con una llamada real a `get_user_by_id`. Esto no es un bug, es la naturaleza de dos sistemas sin transacción conjunta — pero ahora está probado, no solo documentado en un comentario.
- **La recuperación por reintento es real:** simulando exactamente esa falla parcial (deteniéndose ahí a propósito) y luego reintentando desde cero, el segundo intento completa la eliminación sin error — exactamente el comportamiento que depende un usuario que reintenta "Eliminar cuenta" tras una conexión caída.
- Hallazgo incidental durante la construcción de este test: la API admin de GoTrue **lanza** `AuthApiError` para un usuario inexistente en vez de devolver `user=None` — documentado en el propio archivo de test para que nadie repita el error de asumir lo contrario.

**Verificación con mocks (complementaria, prueba el ORDEN del código Python, no la semántica distribuida):**
- Backend: `tests/test_delete_account.py`, **4/4 PASS**, contra Supabase mockeado. Verifica el contrato exacto que el propio código promete en sus comentarios:
  1. Éxito completo: Plaid revocado (si aplica) → RPC `delete_user_data` → borrado del auth user → `{"message": "Cuenta eliminada"}`.
  2. **Si el RPC atómico falla, el auth user JAMÁS se borra** (nunca libera el email con datos huérfanos) — HTTP 500, `admin.delete_user` nunca invocado.
  3. Si el RPC tiene éxito pero borrar el auth user falla, sigue siendo un error real (nunca éxito falso) — estado documentado de "reintento seguro".
  4. Un fallo de revocación en Plaid (API caída) nunca bloquea el resto del borrado.
- Frontend: `src/lib/deleteAccountConfirm.test.ts` (nuevo), **5/5 PASS** — la palabra de confirmación debe coincidir exactamente (case-insensitive, tolera espacios), un near-miss ("ELIMINA", "ELIMINARR") nunca habilita el botón destructivo, la palabra en el idioma equivocado tampoco.
- Suite completa mobile tras estos cambios: **140/140 PASS** (14 suites).

**Guía de prueba manual en dispositivo físico (para la grabación que pide Apple):**
1. Abrir Nuvos en un iPhone físico, iniciar sesión con una cuenta de prueba real (NO la cuenta demo de App Review — esa debe seguir existiendo para futuras revisiones).
2. Abrir el Sidebar (botón de menú) → confirmar que "Eliminar mi cuenta" es visible sin necesidad de scroll.
3. Grabación empieza aquí: tocar "Eliminar mi cuenta".
4. Confirmar que aparece el modal con: explicación de que la acción es permanente, el aviso de que NO cancela la suscripción de Apple + link a "Gestionar mi suscripción", el campo de texto y el botón deshabilitado.
5. Escribir algo incorrecto (ej. "eliminar cuenta") → confirmar que el botón sigue deshabilitado.
6. Borrar y escribir exactamente "ELIMINAR" → confirmar que el botón se habilita (cambia de opacidad).
7. Tocar el botón → confirmar el spinner de "Eliminando...".
8. Confirmar que la app cierra sesión automáticamente y regresa a la pantalla de login.
9. Intentar iniciar sesión de nuevo con el mismo correo/contraseña → debe fallar (cuenta ya no existe) — esto demuestra que el borrado fue real, no cosmético.
10. (Opcional, recomendado para la nota a Apple) Repetir el mismo flujo entrando por Perfil → "Eliminar mi cuenta" en vez del Sidebar, para mostrar ambos puntos de entrada.

**Guideline 5.1.1(v) — CERRADO en lo verificable por código, incluida integración real contra Supabase local.** Pendiente únicamente la grabación física (requiere a Diego con un iPhone real).

---

## RevenueCat / IAP — verificación

| Elemento | Resultado | Evidencia / Nota |
|---|---|---|
| `isRevenueCatSupported()` — solo iOS, nunca Expo Go | **PASS** | `revenuecat.ts`: `Platform.OS === "ios" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient` |
| Todas las llamadas nativas (`purchasePackage`, `getOfferings`, `restorePurchases`) tienen timeout duro | **PASS** (fix de sesión anterior, hoy confirmado que sigue íntegro) | `withTimeout()` en los 3 call sites |
| Backend es la fuente de verdad del tier, no un booleano local | **PASS** | `billing.py::revenuecat_webhook` + `core/subscription.py::is_premium_active()` — single source of truth documentado, consolidado desde 8 reimplementaciones divergentes previas |
| Restore Purchases accesible desde **toda** pantalla de compra | **FAIL → FIXED** | `PaywallModal.tsx` NO tenía botón de restaurar (solo `PricingModal.tsx` lo tenía) — agregado hoy, mismo patrón, mismo mensaje de resultado |
| Expiración/cancelación manejada server-side | **PASS** | Webhook distingue `CANCELLATION` (mantiene acceso hasta `premium_until`) de `EXPIRATION` (downgrade real), con guarda contra pisar una suscripción Stripe activa (`subscription_source != "revenuecat"` → ignora) |
| Sincronización frontend/backend tras compra | **PASS** | `pollUntilPremium()` en `useSubscribeCheckout.ts` + `cache_delete` en cada escritura del webhook (evita el flicker de caché entre workers de gunicorn, bug ya documentado y resuelto en sesiones previas) |
| Correspondencia exacta Product ID (ASC) ↔ Package identifier (RevenueCat) ↔ Entitlement ID | **BLOCKED** | Esto vive en el dashboard de RevenueCat (Offering → Packages → Products), fuera del repo. Lo que el código asume: `offering.monthly`/`offering.annual` (ids reservados de RC) para Premium, `duo_monthly`/`duo_annual` (ids custom) para Duo; entitlements `"premium"`/`"duo"`. **Diego debe confirmar en el dashboard de RevenueCat que estos packages están enlazados a `com.nuvosai.app.premium.monthly.sub`, `.premium.anual.sub`, `.duo.mensual.sub`, `.duo.anual.sub` respectivamente** — un desenlace incorrecto ahí no se detecta por código, solo probando una compra real en Sandbox. |
| Compra real, renovación, upgrade/downgrade, compra interrumpida | **BLOCKED** | Requiere Sandbox tester de Apple + TestFlight — no reproducible en este entorno de auditoría. |
| Información de precio/periodo/renovación/cancelación visible en la UI de suscripción | **PASS** | `PricingModal.tsx`/`PaywallModal.tsx` muestran precio mensual vs. anual, nota de facturación, y ahora también los links legales + Restore. |

**RevenueCat — estado real, sin inflar:** el botón de Restore Purchases ahora es **visible y accesible** desde ambas pantallas de compra (PASS, verificado por código/UI). Que la restauración **funcione de verdad** contra StoreKit real — reciba la respuesta de Apple, llame a `fetchStatus()`, actualice el tier en backend — es **BLOCKED**: nunca se ejecutó una restauración real en este pase, solo se confirmó que el botón existe, llama a `restorePurchases()`, y que esa función (ver tabla anterior) tiene su propio timeout y manejo de error/éxito. Agregar el botón NO equivale a una restauración exitosa comprobada. El mapeo de Product ID/Package/Entitlement también sigue BLOCKED (dashboard de RevenueCat, fuera del repo).

---

## Hallazgos adicionales verificados (evidencia real, no solo lectura de código)

| Área | Resultado | Evidencia |
|---|---|---|
| RevenueCat/entitlements: ¿backend es la fuente de verdad, no un booleano local? | **PASS** | `billing.py::revenuecat_webhook` escribe `user_profiles.subscription_tier`; `core/subscription.py::is_premium_active()` es el único punto de verdad, consolidado desde ~8 reimplementaciones divergentes que existían antes (ver docstring del propio archivo). |
| Compra StoreKit sin timeout (causa del rechazo 2.1(a) del 6 nov) | **FIXED** (sesión anterior) | `revenuecat.ts`: `withTimeout()` en `purchasePackage`/`getOfferings`/`restorePurchases`. |
| ETFs nunca entran al DCF de empresas individuales | **PASS** | `research_engine.py` líneas 54-55, 112-113, 228-229, 407-408: gate `is_etf` → HTTP 422 antes de cualquier cálculo. |
| División por cero en conversión de divisas del portafolio | **PASS** | `portfolio_exposure/combiner.py:83`: guarda explícita `rate_portfolio_to_usd == 0` antes de dividir; además `None`/NaN/Infinity guard en `simulate_addition` (línea ~478). |
| Loop Login↔Onboarding↔Home | **PASS** | `app/index.tsx`: un 404 con perfil local cacheado NUNCA reenvía a onboarding (evita wipe de sesión si el onboarding se interrumpió); solo un 401 real limpia tokens. Comentarios in-line documentan el incidente real que motivó esta protección (2026-09-23 y anterior). |
| Earnings: mezcla de periodos trimestral/anual | **PASS (parcial)** | `earnings.py::_fetch_revenue_for_period` hace match exacto de `period` (fecha ISO) con fallback acotado a 10 días — no mezcla arbitrariamente. Revisión más profunda de GAAP vs non-GAAP pendiente. |
| Sign in with Apple / Google — Guideline 4.8 | **N/A** | La app NO ofrece login social de ningún tipo (solo email/password) — 4.8 solo aplica si se ofrece un login de terceros sin ofrecer también Apple. Confirmado por grep, no existe ningún SDK de Google/Apple Sign-In en el repo. |

---

## 3. Arthur y límites de costo de IA

| Elemento | Resultado | Evidencia |
|---|---|---|
| Reintentos ante error de proveedor están acotados, nunca infinitos | **PASS** | `chat.py::_resilient_reply`: exactamente 2 intentos (modelo primario + Haiku), cada uno con `asyncio.wait_for(..., timeout=75)`, luego 1 fallback a un proveedor distinto (GPT-mini) con `timeout=45`, y si todo falla, 503 (que el cliente reintenta con backoff propio). Nunca un loop sin límite. |
| Protección de costo real (no solo conteo de mensajes) | **PASS** | `cost_guard.py`: trackea gasto real mes/día desde `llm_usage_log`, clasifica en 5 niveles (NORMAL→HARD_STOP), degrada a modelo barato antes de bloquear. Falla abierto ante error de monitoreo (decisión de negocio documentada, no bug). |
| Prevención de doble envío / llamadas duplicadas desde el cliente | **PASS** | `chat.tsx`: `sendMessage()` retorna temprano si `streaming` es true (línea 605); el input se deshabilita y el botón de enviar cambia a "detener" mientras transmite — imposible disparar un segundo request desde la UI durante uno en curso. |
| Rate limits en las rutas de chat | **PASS** | `@limiter.limit("20/minute")` en `/chat/stream`, `30/minute` en `/chat/message`, `10/minute` en la variante pública (más restrictiva, sin auth). |
| Arthur no debe inventar cifras/fuentes/precios | **BLOCKED (parcial)** | No verificable por test automatizado sin un juicio humano o LLM-evaluador sobre respuestas reales — requiere revisión manual de transcripts o un eval dedicado, fuera de alcance de este pase. El prompt/guardrails existen (ver `project_security_audit_sep2026` en memoria — ya se revisaron en una sesión previa), pero no hay verificación nueva aquí. |

## 4. Portafolio y Patrimonio

| Elemento | Resultado | Evidencia |
|---|---|---|
| Aislamiento entre usuarios (IDOR) en portfolio-exposure | **PASS** | `portfolio_exposure.py`: `user["id"]` viene SIEMPRE de `get_current_user` (sesión verificada), nunca de un parámetro del cliente; un `portfolio_id` ajeno da 404 indistinguible de "no existe" (documentado a propósito, evita filtrar qué IDs existen). |
| División por cero / NaN en patrimonio (`patrimonio.tsx`) | **PASS** | Cada cálculo de porcentaje (`totalGainPct`, `dayGainPct`, `gainPct` por posición ×2) está guardado con `cost > 0 ? ... : 0`. La única división sin guard explícito (`gain / PAPER_INITIAL_CASH`) es segura porque el denominador es una constante fija del módulo, no un dato que pueda ser cero. |
| División por cero en conversión de divisas (portfolio_exposure) | **PASS** (ya verificado arriba en la sección de RevenueCat/backend) | `combiner.py:83`: guarda explícita antes de dividir por `rate_portfolio_to_usd`. |
| Sincronización portafolio/watchlist entre dispositivos | **PASS (verificado en sesiones de auditoría previas)** | Ver memoria del proyecto: `project_watchlist_sync_race` (fix 2026-09-15), `project_watchlist_never_disappear_consolidation` (4ª pasada, 2026-10-03), `project_portfolio_sync_race` (fix 2026-07-01). No se re-verificó en este pase — se registra como ya cerrado previamente, no como verificado hoy. |

## Clasificación de los 13 errores preexistentes de TypeScript (mobile)

Inspeccionados individualmente, no solo contados. Los dos tipos de error que PODRÍAN implicar riesgo real se verificaron a mano:

- **`'appState.current'/'appStateRef.current' possibly null`** (`(tabs)/_layout.tsx:427`, `(tabs)/chat.tsx:276`) — inspeccionado: ambos refs se inicializan con `useRef(AppState.currentState)` / `{ current: AppState.currentState }`, un valor real no-nulo siempre, nunca `null` en runtime. El tipo de la librería simplemente quedó más estricto tras una actualización — **falso positivo, cero riesgo**.
- **`ListEmptyComponent` no acepta `Element | null`** (`learn.tsx:448`) — inspeccionado: la rama `else` del ternario retorna `null`, que `FlatList` maneja sin problema en runtime (simplemente no renderiza nada); el tipo de `@types` no contempla ese valor — **falso positivo, cero riesgo**.
- El resto (10 errores: `Tabs`/`Stack` children, `RefObject` vs `Ref`, `TextInputType.focus`, `ScrollView.scrollToEnd`, `CaptureTarget` de la librería de screenshots) son todos el mismo patrón: desfases de definiciones de tipos entre `react-navigation`/`react-native`/`expo`/librerías de captura y la versión de TypeScript (6.0.3) — nunca afectan el bundle real (Babel solo despoja tipos, Metro no corre `tsc`).

**Conclusión: los 13 son P3, ninguno corregido** — forzar los tipos (con `!`, downgrades de `@types`, o casts) sería únicamente ruido cosmético sin beneficio funcional, y el propio pedido de auditoría pide evitar refactorizaciones innecesarias.

**Importante, explícito: `npx tsc --noEmit -p .` en `frontend/mobile` NO pasa hoy — termina con 13 errores.** Esto no se oculta ni se "resuelve" con casts — queda así a propósito, documentado arriba con su causa raíz y evidencia de por qué ninguno es un riesgo real de runtime. Si en algún momento se quiere un `tsc` limpio, el camino correcto es alinear versiones de `@types/react`/`react-navigation`/la librería de screenshots con la versión de React Native 0.88 instalada — no parchear cada error individualmente.

## 5. Nuvos Radar — exactitud financiera y clasificación de instrumentos

| Elemento | Resultado | Evidencia |
|---|---|---|
| ETFs nunca entran al DCF de empresas | **PASS** (ya documentado arriba) | 4 gates `is_etf` → 422 en `research_engine.py`, `screener.py` (`_build_quick_analysis` y otro endpoint) antes de cualquier cómputo. |
| **Mensaje de error ETF llega al usuario de verdad** | **FAIL → FIXED** | Hallazgo real: cuando el backend bloquea una búsqueda de ETF con 422, manda `detail={is_etf, ticker, message}` (un objeto con un mensaje específico y útil: *"SPY es un ETF... el análisis especializado para ETFs estará disponible próximamente"*). El frontend (web `subvaluadas/page.tsx` Y mobile `subvaluadas/index.tsx`, código espejo) solo mostraba ese mensaje cuando `detail` era un **string plano** — al ser un objeto, lo descartaba y mostraba el error genérico "hubo un problema en la búsqueda". Corregido en ambas plataformas (mismo patrón que el branch 429 ya usaba correctamente, justo arriba en el mismo archivo — fue una inconsistencia, no una decisión de diseño). Verificado: 287/287 (web) + 140/140 (mobile) tras el fix, 0 regresiones. |
| BRK.B / BRK.A — bandera de revisión por distorsión de ROE | **PASS, ahora con test** | Encontré trabajo en progreso sin commitear (`company_valuation_service.py`, 2026-11-13) que ya implementa un flag explícito y angosto (no una regla general) para BRK.B/BRK.A, con justificación económica documentada in-line (cross-checks independientes muy por debajo del output del motor de Residual Income). **No tenía ningún test.** Agregué 2 tests deterministas (`test_company_valuation_service.py`): confirma que dispara para cualquier variante de ticker (BRK.B/BRK-B/brk.b/BRK.A/BRK-A) y que NO se activa para un ticker no relacionado con un gap normal (prueba de que la regla sigue siendo angosta, no una regla general disfrazada). 2/2 PASS. |
| Conversión de divisas en datos financieros (NVO/DKK, BABA/CNY) | **PASS (ya verificado y testeado en sesión previa)** | `financial_data_service.py` — sin diff pendiente (ya committeado), 8 tests dedicados en `test_financial_data_service_currency.py`, todos dentro del run de 2490. |
| Manejo de datos faltantes / `insufficient_data` | **PASS (ya verificado y testeado en sesiones previas)** | 23 referencias en el motor de valuación, cubierto por 5+ archivos de test (`test_company_diagnostic_under_review.py`, `test_degraded_diagnostic.py`, etc.) |
| Consistencia frontend/backend en clasificación de instrumentos | **PASS parcial, con la corrección de arriba** | El frontend no reimplementa `is_etf` (correcto, evita que se desincronice) — confía por completo en el backend, y ahora SÍ muestra el motivo real cuando el backend lo rechaza. |

## 6. Earnings, ETFs, Watchlist, Screener, Seguridad transversal (verificación puntual)

| Elemento | Resultado | Evidencia |
|---|---|---|
| Earnings: mezcla GAAP/non-GAAP | **N/A** | `earnings.py` nunca introduce una segunda cifra "adjusted"/non-GAAP junto a la reportada — solo usa `actual` vs `estimate` del mismo proveedor por período exacto (ver hallazgo de sesión anterior sobre matching de fechas). No hay dos fuentes que mezclar, el riesgo no existe en el código actual. |
| Earnings: IA no inventa explicaciones | **PASS** | `_search_earnings_context`: grounded en búsqueda web real (Perplexity) con citations reales mostradas como "Fuentes"; documentado explícitamente que un timeout/falla devuelve texto vacío, nunca fabrica cifra/cita. |
| ETFs explorador: nunca usa el motor DCF corporativo | **PASS** | `app/services/etf/` es un paquete separado por diseño — su propio docstring dice explícitamente que está aislado del pipeline de valuación (`app/services/valuation/`). |
| Watchlist: duplicados + aislamiento entre usuarios | **PASS (ya verificado y corregido en sesiones previas, 2026-09-15/10-03 según memoria)** | `user_id` siempre de sesión; constraint único a nivel de Postgres (23505) maneja duplicados en la base, no solo en la app. |
| Screener Semanal: resultados obsoletos mostrados como nuevos | **PASS (ya verificado/corregido en sesión previa, 2026-09-27 según memoria)** | Cache semanal con TTL de 7 días por usuario, reconstruido explícitamente cada semana. |
| Seguridad transversal: ningún endpoint acepta `user_id` del cliente | **PASS** | Grep de todo `app/api/routes/*.py`: cero coincidencias de `user_id` viniendo de `Body`/`Query`/dict del request — siempre `Depends(get_current_user_id)` o `Depends(get_current_user)`. |

---

## 7. Reporte final — estado real por área (no inflar nada)

| Área | Estado | Nota |
|---|---|---|
| Notificaciones push (4.5.4) | **PASS unitario / BLOCKED e2e** | Lógica corregida y probada (6 tests); falta validación física en iPad/iPhone con permiso realmente denegado. |
| Eliminación de cuenta (5.1.1v) | **PASS unitario + PASS integración real** | Mocks (4 tests) + integración real contra Supabase local (2 tests) prueban la ventana huérfana real y su recuperación por reintento. Falta solo la grabación física. |
| RevenueCat / IAP (2.1b, 3.1.1) | **PASS parcial / BLOCKED en lo comercial** | Restore Purchases visible y conectado en ambas pantallas; timeouts duros confirmados; backend es fuente de verdad. Mapeo Product ID↔RevenueCat↔Entitlement y cualquier compra/restauración real: BLOCKED (dashboard + Sandbox, fuera de este entorno). |
| Arthur / costo de IA | **PASS** | Reintentos acotados (2 + 1 fallback, timeouts duros), sin duplicados desde la UI, rate limits activos. Calidad de las respuestas (inventar cifras/fuentes): BLOCKED, necesita evaluación humana/LLM-judge, no cubierto. |
| Portafolio / Patrimonio | **PASS** | Aislamiento entre usuarios (sin IDOR), divisiones guardadas contra cero/NaN. |
| Nuvos Radar | **PASS, con 1 bug real encontrado y corregido** | ETFs nunca entran al DCF; BRK.B ahora con test; divisas y datos faltantes ya cubiertos. El mensaje de error al buscar un ETF se descartaba — corregido en web y mobile. |
| Earnings | **PASS / N-A** | Sin riesgo de mezcla GAAP/non-GAAP (no existe esa segunda fuente); narrativa de IA grounded en fuentes reales. |
| ETFs (explorador) | **PASS** | Paquete aislado del motor de valuación por diseño. |
| Watchlist / Screener Semanal | **PASS (verificado en sesiones previas)** | No re-auditado hoy desde cero — se registra la procedencia de la verificación, no un nuevo PASS fabricado. |
| TypeScript (mobile) | **FAIL documentado, sin riesgo de runtime** | 13 errores, el `tsc` no pasa, cada uno con causa raíz verificada — ninguno oculto con casts. |
| Backend test suite | **PASS — 2492/2492, 0 fallos, 0 omitidos** (418.06s) | Evidencia completa, corrida de principio a fin tras todos los cambios de hoy. |
| Frontend (mobile + web) test suites | **PASS — 140/140 (mobile) + 287/287 (web)** | Sin regresiones tras todos los cambios de hoy. |
| Inicio, Aprendizaje, UI/iPad físico, navegación profunda (deep links), resiliencia offline/red lenta, seguridad a fondo (SQL/prompt injection, rate limiting exhaustivo), Productos/Planes a fondo | **NO AUDITADO en este pase** | No se declara PASS, FAIL ni BLOCKED — simplemente no se llegó a esto todavía. Pendiente de una próxima sesión. |

### Decisión de release: **NO-GO** (todavía)

No por tener P0/P1 abiertos conocidos — no los hay, de lo auditado hoy — sino porque quedan áreas genuinamente no auditadas (Aprendizaje, UI/iPad físico, navegación profunda, resiliencia, seguridad a fondo) y, sobre los 3 motivos de rechazo de Apple, ninguno tiene su evidencia end-to-end/física completa todavía. Reenviar a Apple antes de esa evidencia sería repetir el patrón de "funciona en teoría" que ya causó 2 rechazos.

## Lista explícita de pruebas manuales necesarias antes del próximo envío a Apple

1. **Notificaciones**: en un iPhone y un iPad físicos, denegar el permiso desde el diálogo nativo de iOS (no desde el rationale propio) y navegar TODA la app — Home, Radar, Portafolio, Watchlist, Chat, Perfil, Productos — confirmando que nada se bloquea y el aviso no reaparece.
2. **Eliminación de cuenta** (grabación requerida por Apple): login con cuenta de prueba real → Sidebar → "Eliminar mi cuenta" → escribir mal la palabra (botón sigue gris) → escribir "ELIMINAR" correctamente → confirmar → verificar logout automático → intentar iniciar sesión de nuevo con el mismo correo (debe fallar). Repetir entrando por Perfil en vez de Sidebar.
3. **RevenueCat — compra real**: con un Sandbox tester de Apple, comprar Premium mensual, Premium anual, Duo mensual, Duo anual — confirmar que cada uno activa el entitlement correcto y el backend lo refleja (`GET /billing/status`).
4. **RevenueCat — restaurar**: desinstalar y reinstalar la app (o cambiar de dispositivo) con una cuenta Sandbox que ya compró, tocar "Restaurar compras" en PricingModal Y en PaywallModal — confirmar que el tier se restaura en ambas pantallas.
5. **RevenueCat — cancelación/expiración**: cancelar una suscripción Sandbox y confirmar que el usuario conserva acceso hasta el fin del período (`CANCELLATION`), y que pierde acceso real al expirar (`EXPIRATION`) — vía los logs del webhook en Railway.
6. **iPad físico (dispositivo de revisión de Apple)**: recorrer TODA la app en un iPad Air 11" o similar — layouts, modales, teclado, safe areas — nada de esto se verificó en este pase.
7. **Product IDs**: confirmar en el dashboard de RevenueCat que los 4 packages (premium_monthly, premium_annual/premium_anual, duo_monthly, duo_annual) apuntan exactamente a `com.nuvosai.app.premium.monthly.sub`, `.premium.anual.sub`, `.duo.mensual.sub`, `.duo.anual.sub`.

## Pendiente (no cubierto, próximas sesiones) — ver Bloque 2 abajo para lo que SÍ se cubrió después

---

# Bloque 2 — continuación 2026-11-14 (misma fecha, sesión extendida)

Línea base confirmada al entrar a este bloque: **2492/2492 backend, 140/140 mobile, 287/287 web.** Se mantiene como referencia; no se declara la app lista para Apple.

## Punto 6 — Recuperación segura de eliminación parcial (implementado, no solo propuesto)

**Problema real confirmado en el bloque anterior:** Supabase Auth (GoTrue) y Postgres no son una transacción distribuida. Si `DELETE /api/auth/account` muere justo entre el RPC atómico y la llamada final a `admin.delete_user()` (crash del proceso, redeploy, caída de red), el usuario queda con los datos borrados pero la identidad de Auth intacta — y antes de hoy, **solo se recuperaba si el usuario volvía a intentarlo manualmente**.

**Implementado:**
1. `migrations/126_pending_account_deletions.sql` (**PROPUESTA, no aplicada en producción** — aplicada solo en local para poder probarla) — tabla marcadora `pending_account_deletions(user_id PK, requested_at)` con `ON DELETE CASCADE` a `auth.users`, así una eliminación exitosa normal nunca necesita limpiar el marcador a mano.
2. `auth.py::delete_account` ahora escribe ese marcador (best-effort) antes de tocar cualquier dato.
3. Nueva función `auth.py::reconcile_pending_account_deletions(grace_minutes=15)` — busca marcadores más viejos que la ventana de gracia y termina la eliminación (RPC idempotente + borrado real de Auth), sin que el usuario haga nada.
4. Job nuevo `worker.py::job_reconcile_pending_account_deletions`, programado cada 15 minutos.

**Verificado, no solo implementado:**
- 3 tests mockeados (`test_delete_account.py`): sin marcadores → no-op; completa cada marcador vencido encontrado; un fallo en una fila nunca detiene el resto del lote.
- **1 test de integración REAL contra Supabase local** (`test_delete_account_integration.py::test_reconciliation_job_automatically_finishes_a_stuck_deletion`) — el test definitivo: crea un usuario real, simula el crash exacto (marcador escrito, datos borrados, identidad de Auth intacta), llama la función REAL (no mockeada) con `grace_minutes=0`, y confirma que el usuario queda completamente eliminado sin ninguna acción humana. **PASS.**
- Suite completa de backend corrida de nuevo tras este cambio (ver línea base actualizada abajo).

**Pendiente de Diego:** aplicar la migración 126 en producción (no autorizado para ejecutar yo mismo, como toda migración de este repo) y hacer deploy del worker con el nuevo job.

## Punto 1 — Inicio y Aprendizaje

| Elemento | Resultado | Evidencia |
|---|---|---|
| Home: un servicio secundario caído no bloquea la pantalla | **PASS** | `home.tsx` usa `Promise.allSettled` (no `Promise.all`) para sus 3 llamadas paralelas — un fallo no tumba las demás. |
| Home/Learn: botones rotos, handlers vacíos, TODOs olvidados | **PASS** | Grep de `onPress={() => {}}`, `onPress={undefined}`, `TODO`, `FIXME`, `console.log` en ambos archivos (2271 + 775 líneas): cero coincidencias. |
| Aprendizaje: lección que lleva a pantalla vacía | **PASS** | No hay "lecciones" estáticas que puedan faltar — cada tema genera su explicación on-demand vía streaming a Arthur; con reintento automático (1x) y mensaje de fallback (`t("learn.flashcardError")`) si ambos intentos fallan. Nunca un modal en blanco. |
| Aprendizaje: quiz para un tema sin datos de quiz | **PASS** | Gatea con `QUIZ_DATA[topicId]` — si no existe, muestra "Entendido" en vez de un botón roto hacia un quiz inexistente. |

## Punto 2 — Navegación, deep links, rutas rotas

| Elemento | Resultado | Evidencia |
|---|---|---|
| **Tab "investors" huérfana — warning real en cada arranque** | **FAIL → FIXED** | Confirmado con `git log`: la función "Investor Tracker" (Buffett/Pelosi/Burry) se eliminó por completo hace 5 meses (commit `6a5cffd5`, 2026-06-21) — se borró `app/(tabs)/investors.tsx` pero quedó la declaración `<Tabs.Screen name="investors">` en `_layout.tsx` (+ su entrada en `TAB_CONFIG` + la key de i18n `tabsLayout.tabs.investors`). Causaba el warning de Metro visto en vivo esta sesión: *"No route named 'investors' exists in nested children"*. Nunca era alcanzable como botón (el tab bar solo renderiza `FIXED_TABS`), así que no era un dead-end para el usuario — pero sí ruido real en cada boot. Eliminado por completo en los 3 lugares. |
| Deep links de push (13 variantes de `data.screen`) | **PASS** | Cada destino (`/(tabs)/chat`, `/(tabs)/portfolio`, `/(tabs)/watchlist`, `/(tabs)/paper`, `/(tabs)/home`, `/(tabs)/profile`, `/(tabs)/products`, `/subvaluadas`, `/stock/[ticker]`, `/earnings/[ticker]`, `/weekly-ritual/...`, `/monthly-report`, `/morning-brief`) verificado contra archivos reales existentes — ninguno roto. |
| Loop Login↔Onboarding↔Home | **PASS (ya verificado en Bloque 1)** | Sin cambios desde la verificación anterior. |

## Punto 3 — UI iPhone/iPad

| Elemento | Resultado | Evidencia |
|---|---|---|
| Validación física en iPad Air 11" (el dispositivo real de revisión de Apple) | **BLOCKED** | Sin simulador de iOS ni dispositivo físico disponible en este entorno de auditoría. Esto es explícitamente uno de los 3 motivos de rechazo originales (el reviewer usó este dispositivo) — no se puede cerrar sin hardware real o Xcode Simulator. |
| Riesgo estático de layouts rotos en pantalla grande (iPad) | **PASS parcial (señal débil, no concluyente)** | Las 5 ocurrencias de `Dimensions.get("window").width` en todo el código ya aplican una fracción/división (ej. `SIDEBAR_WIDTH = Math.min(width * 0.78, 300)`), no un ancho fijo en píxeles — reduce el riesgo de que algo se vea absurdamente estirado en una pantalla de iPad, pero esto NO reemplaza probarlo de verdad. |

## Punto 4 — Resiliencia

| Elemento | Resultado | Evidencia |
|---|---|---|
| Doble-tap / eliminación de cuenta concurrente | **PASS** | El marcador usa `upsert` (idempotente), el RPC es idempotente, `admin.delete_user` en un usuario ya borrado solo lanza (capturado, registrado) — ninguna combinación de llamadas concurrentes corrompe estado, confirmado por diseño + los tests de reconciliación. |
| Resto de resiliencia (red lenta, timeout a mitad de sesión, caché inválida en productos/paywall) | **PASS (ya verificado en Bloque 1 para Arthur/RevenueCat/Portfolio)** | No re-auditado hoy fuera de esas áreas específicas. |

## Punto 5 — Seguridad

| Elemento | Resultado | Evidencia |
|---|---|---|
| RLS habilitado en tablas sensibles | **PASS (muestreo)** | Confirmado `ENABLE ROW LEVEL SECURITY` para `user_profiles`, `user_portfolio`, `watchlist`, `chat_history`, `portfolio_pulse_snapshots`, `cash_holdings`. El control primario real es a nivel de FastAPI (`get_current_user_id`, ya verificado exhaustivamente en Bloque 1) — RLS es defensa en profundidad, no la única barrera, dado que el backend media todo acceso con la service key. |
| Ningún endpoint acepta `user_id` del cliente (repetido, ahora sobre el código completo) | **PASS** | Ya confirmado en Bloque 1; sin cambios. |
| Secretos nuevos introducidos en el código de este bloque (migración 126, auth.py, worker.py) | **PASS** | Grep dirigido: cero coincidencias de secretos/claves nuevas. |

## Línea base de tests — actualización final del Bloque 2

| Suite | Resultado |
|---|---|
| `backend` (pytest, Supabase local) | pendiente de confirmar el número final tras el punto 6 — se registra abajo en cuanto termine la corrida en curso, no se declara antes de tener el número real. |
| `frontend/mobile` (jest) | **140/140 PASS** (sin cambios de este bloque hasta el fix de "investors", re-confirmado tras ese fix). |
| `frontend/web` (vitest) | **287/287 PASS** (sin cambios en este bloque). |

## Bloqueos explícitos que todavía impiden enviar a Apple

1. **Validación física end-to-end de los 3 motivos de rechazo** — ninguno de los 3 (notificaciones, eliminación de cuenta, RevenueCat) tiene su grabación/prueba en dispositivo físico real todavía.
2. **iPad Air 11" físico o simulador** — cero validación de UI en el dispositivo exacto que usó el reviewer de Apple.
3. **RevenueCat — Sandbox/TestFlight** — ninguna compra, restauración, cancelación o expiración real se ha ejecutado contra StoreKit real.
4. **Dashboard de RevenueCat** — mapeo Product ID ↔ Package ↔ Entitlement sin confirmar desde este entorno.
5. **Migración 126 y el nuevo job de reconciliación** — implementados y probados en local, pero **no aplicados/desplegados en producción** — requieren que Diego autorice y ejecute el deploy.
6. **Áreas genuinamente no auditadas todavía**: Productos/Planes (UI completa), resto de Perfil, ETFs explorador (UI de comparación a fondo), rendimiento (memory leaks, re-renders), seguridad a fondo (inyección de prompts/SQL, abuso de IA más allá de lo ya revisado en Arthur), backend/datos a fondo (contratos completos, zonas horarias, migraciones pendientes aplicadas).

**Decisión de release: NO-GO.** No por bugs P0/P1 abiertos conocidos (no hay ninguno confirmado hoy) — por la ausencia de la evidencia física/externa de los puntos 1-4 arriba, que son exactamente lo que causó los 2 rechazos anteriores de Apple.

Este documento se irá actualizando en las próximas sesiones de auditoría.
