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
| `backend` (pytest, ENV_FILE=.env.development, Supabase local) | **2486/2486 PASS, 0 fallos** (419.48s) | ejecutado 2026-11-14. 25 warnings, todos de deprecación (no funcionales): Pydantic v2 `class Config` style, `gotrue`→`supabase_auth` rename, `datetime.utcnow()` (decisions.py:57), FastAPI `@app.on_event` (main.py:25). **P3**, no corregidos en este pase — cosméticos, sin riesgo de rechazo de Apple ni de corrección. |

TypeScript mobile: **13 errores preexistentes**, no relacionados con los cambios de hoy (desajustes de tipos de `@types/react-navigation`/RefObject en `app/(tabs)/_layout.tsx`, `chat.tsx`, `learn.tsx`, `support.tsx`, `_layout.tsx`, `monthly-report.tsx`, `wrapped.tsx`). No bloquean el build de Expo (Babel solo despoja tipos). Severidad: **P3**, documentado, no corregido en este pase (fuera de alcance de los 3 motivos de rechazo de Apple).

---

## Los 3 motivos de rechazo de Apple (14 nov 2026)

### 1. Guideline 4.5.4 — Notificaciones push obligatorias
**FAIL → FIXED, verificado con test real.** Causa raíz: `registerPushToken()` corría en un `useEffect` dependiente de `pathname` (`app/_layout.tsx`), así que su Alert de permiso (o el de "ve a Ajustes" si ya estaba denegado) **reaparecía en cada navegación** hasta que el usuario cedía — indistinguible de exigir el permiso.

Fix: la decisión de qué mostrar se extrajo a una función pura `decidePushPromptAction(status, alreadyPromptedThisSession)` en `src/lib/pushPermissionPrompt.ts`, conectada al componente real (`app/_layout.tsx`'s `registerPushToken`) — no es una reimplementación paralela, es la lógica real de producción.

Test: `src/lib/pushPermissionPrompt.test.ts`, **6/6 PASS**. Casos cubiertos: (a) `undetermined`+ya preguntado→`skip` (regresión exacta del bug: antes del fix esto devolvía `show_rationale` sin importar el estado de sesión), (b) `denied`+ya preguntado→`skip`, (c) primera vez `undetermined`→`show_rationale`, (d) primera vez `denied`→`show_settings_hint`, (e) `granted`→`register` siempre sin UI, (f) ninguna combinación produce una acción bloqueante (todas las acciones son no-bloqueantes, nunca cierran el paso a otras pantallas).

Suite completa mobile tras el fix: **135/135 PASS** (13 suites, antes 129/129 en 12 — 0 regresiones).

Verificado además por lectura de código: `onboarding/index.tsx` no solicita push en ningún punto; ninguna pantalla condiciona función alguna a `Notifications.getPermissionsAsync()`.

**PUNTO 1: CERRADO.**

### 2. Guideline 2.1(b) — IAP no enviados a revisión
**N/A para código.** Es una tarea externa en App Store Connect (ya resuelta por Diego manualmente: grupo + 4 suscripciones consolidados en un Draft Submission y adjuntados a la versión). No hay cambio de código posible aquí.

### 3. Guideline 5.1.1(v) — Sin opción de eliminar cuenta
**FAIL → FIXED.** El backend (`DELETE /api/auth/account`) ya era robusto (atómico vía RPC `delete_user_data` sobre ~50 tablas, revoca Plaid, borra el usuario de Supabase Auth con cliente fresco para evitar contaminación de sesión — ver comentario in-line de 2026-10-20). El problema real era de UI: un link pequeño al fondo de Perfil, ya pasado por alto una vez (build 36) y otra vez (build 46).
Fix: `DeleteAccountModal.tsx` (nuevo, global, montado en `_layout.tsx`), con entrada en **Sidebar** y **Perfil**. Exige escribir la palabra de confirmación exacta. Nunca cierra sesión ni oculta un error salvo que el servidor confirme el borrado real. Incluye el aviso explícito (pedido por Apple) de que borrar la cuenta NO cancela una suscripción activa de Apple, con link a gestión de suscripción. Commits `92ae3ab8` + working tree (nota de suscripción, pendiente commit).

**Verificación de flujo completo (no solo que el modal sea visible):**
- Backend: `tests/test_delete_account.py` (nuevo), **4/4 PASS**, contra Supabase LOCAL mockeado (nunca producción, guard de `conftest.py` activo). Verifica el contrato exacto que el propio código promete en sus comentarios:
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

**PUNTO 3: CERRADO en lo que a código/backend respecta.** Pendiente únicamente la grabación física (requiere a Diego con un iPhone real) y la verificación en Supabase Studio (opcional) de que las tablas quedaron realmente vacías para ese `user_id`.

---

## 2. RevenueCat / IAP — verificación (punto 3 del pedido de continuación, 14 nov)

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

**PUNTO 3 (continuación): CERRADO en lo verificable por código; 2 ítems quedan explícitamente BLOCKED (dashboard de RevenueCat, compra real en Sandbox) — no se declaran PASS.**

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

## Pendiente (no cubierto aún en este pase)

Todo lo demás del documento de auditoría del usuario (pantallas de Inicio, Radar completo matemáticamente, Arthur, Patrimonio, Portafolio, Distribución, Watchlist, Screener Semanal, Productos/Planes, Perfil más allá de eliminar cuenta, Aprendizaje, Earnings GAAP/non-GAAP a fondo, ETFs explorador, navegación transversal, UI/iPad, rendimiento, seguridad a fondo, backend/datos a fondo, resiliencia) **no se ha auditado todavía** en este pase. No se declara PASS en ninguno de esos puntos sin evidencia — quedan como **BLOCKED/pendiente**, no como aprobados.

Este documento se irá actualizando en las próximas sesiones de auditoría.
