# Nuvos Sentinel

Panel de monitoreo 24/7 de Nuvos AI, deliberadamente **fuera** de la infraestructura
de Railway/Supabase donde vive la app principal — si Nuvos completo se cae
(Railway, Supabase, o ambos), este servicio sigue vivo y avisa por SMS/WhatsApp
(Twilio) + email (Resend).

Qué vigila, cada 2 minutos por defecto:
- **Backend caído** — `GET /health/ready` en el backend principal (ya existía, valida Supabase/Redis).
- **Frontend caído o pantalla en blanco** — carga el home público y valida que
  contenga un texto esperado (no solo que responda 200).
- **Worker/cron caído** — último heartbeat de `worker.py` vía
  `GET /api/sentinel/worker-heartbeat`.
- **Posible ataque** — picos de logins fallidos / rate-limit / errores del
  frontend vía `GET /api/sentinel/security-metrics` y `/client-errors`. Cuando
  se dispara, enriquece las IPs involucradas (ciudad, región, código postal,
  país, ISP, ASN, tipo de conexión, VPN/TOR/proxy, score de fraude) llamando
  a `GET /api/sentinel/ip-intel` — **solo en ese momento**, nunca en cada
  poll, para no gastar la cuota gratuita de IPQualityScore durante un ataque
  real. Esos datos aparecen en la tabla "IPs sospechosas" del dashboard.

No es un WAF ni un SIEM: son umbrales sobre datos reales que el backend ya
registra (`security_events`, ver `backend/migrations/033_security_events.sql`).
Una campaña de ataque muy lenta y repartida en el tiempo puede no disparar
ninguna alerta — es el trade-off aceptado de "heurísticas propias" en vez de
un producto de seguridad de terceros.

## Despliegue (Render — free tier tiene un problema real, leer antes)

⚠️ El plan gratis de Render "duerme" el servicio tras 15 min sin tráfico
entrante — pero este Sentinel no vive de tráfico entrante, vive de su propio
loop en segundo plano. Si Render lo duerme, el monitoreo 24/7 se detiene sin
avisarte. Para que esto sirva de verdad, usa el plan pago más barato de
Render (~$7/mes, no se duerme) o cambia a Fly.io (su capa gratis sí soporta
procesos siempre activos).

1. Crea una cuenta en [render.com](https://render.com) si no tienes una.
2. **No uses el modo "Blueprint"** — este repo es un monorepo y `render.yaml`
   vive dentro de `nuvos-sentinel/`, no en la raíz, así que Render no lo
   detecta solo. Usa en su lugar `New +` → `Web Service`:
   - Conecta tu cuenta de GitHub y selecciona el repo `IA_Investment_Advisor`.
   - **Root Directory: `nuvos-sentinel`** (así Render solo construye esta carpeta).
   - Build Command: `pip install -r requirements.txt`.
   - Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
3. Llena las env vars (ver `.env.example` para el significado de cada una).
4. Genera un secreto para `SENTINEL_SHARED_SECRET`:
   ```
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```
   Pon el mismo valor aquí y en el env de Railway del backend principal
   (`SENTINEL_SHARED_SECRET`).
5. Deploy. Visita la URL que te da Render, entra con
   `SENTINEL_DASHBOARD_USER` / `SENTINEL_DASHBOARD_PASSWORD`.

Alternativa: Fly.io funciona igual de bien y su free tier no tiene el
problema de "spin down" — usa el `Procfile` incluido (`fly launch`,
`fly secrets set ...` para cada env var).

## WhatsApp vía Kapso (alternativa a Twilio SMS)

Por defecto las alertas van por SMS (Twilio). Si prefieres WhatsApp con
[Kapso](https://kapso.ai), pon `ALERT_WHATSAPP_PROVIDER=kapso` — pero hay un
requisito real de WhatsApp que no depende de Kapso: **no se puede mandar un
mensaje de texto libre "no solicitado"** (una alerta que tú no iniciaste)
fuera de una ventana de 24h de conversación abierta. Necesitas una
**plantilla de mensaje aprobada por Meta**. Pasos:

1. Crea cuenta en [kapso.ai](https://kapso.ai) y conecta tu número de
   WhatsApp Business en su dashboard (`WhatsApp → Phone numbers`).
2. Crea una plantilla de mensaje (ej. nombre `nuvos_alert`, cuerpo
   `🚨 Nuvos: {{1}}`) y espera la aprobación de Meta (minutos a ~24h).
3. Configura: `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID` (de tu número
   conectado), `KAPSO_TEMPLATE_NAME` (el nombre exacto de la plantilla),
   `KAPSO_TEMPLATE_LANG` (el código de idioma que elegiste al crearla, ej.
   `es_MX`), y `ALERT_WHATSAPP_NUMBER` (tu número, formato `+52155...`).

Sin la plantilla aprobada, los mensajes por WhatsApp fallarán — el email
(Resend) sigue funcionando siempre como respaldo independientemente de esto.

## Watchdog para el watchdog (vigilar al Sentinel mismo)

Si el servidor donde vive este Sentinel se cae, nadie te avisa — es el único
punto ciego de todo el diseño (el resto del sistema vigila a Nuvos, pero
nada vigila al vigía). La solución es un segundo servicio, externo y
gratuito, que le haga ping periódico a este Sentinel:

1. Crea una cuenta gratis en [UptimeRobot](https://uptimerobot.com) o
   [Better Stack](https://betterstack.com) (cualquiera de los dos tiene un
   tier gratis suficiente para esto).
2. Registra un monitor HTTP apuntando a `https://<tu-url-de-render-o-fly>/healthz`
   — esa ruta NO pide contraseña a propósito, para no tener que meter tu
   password del dashboard en un servicio externo.
3. Configura que te avise por email o SMS si ese endpoint deja de responder
   — así, si el propio Sentinel muere, te enteras por un canal totalmente
   independiente.

Esto no lo puede automatizar un agente (requiere crear una cuenta externa),
pero toma menos de 5 minutos.

## Pasos manuales pendientes en el repo principal

- Aplicar las migraciones `086_worker_heartbeat.sql`, `087_client_errors.sql`
  y `088_ip_intel.sql` contra Supabase (mismo proceso manual usado para las
  anteriores).
- Agregar `SENTINEL_SHARED_SECRET` al env de Railway del backend.
- Crear una cuenta gratis en [ipqualityscore.com](https://www.ipqualityscore.com)
  (tier gratis: 5,000 consultas/mes) y agregar `IPQUALITYSCORE_API_KEY` al
  env de Railway del backend — la llave vive ahí, no en este servicio;
  `nuvos-sentinel` solo la consulta indirectamente vía `/api/sentinel/ip-intel`.
  Sin esta key configurada, el sistema sigue funcionando igual (detecta y
  alerta el ataque) pero sin los datos de geolocalización/VPN/fraude.

## Retención de datos y cuota de IPQualityScore

- Los incidentes cerrados (y sus IPs marcadas) se borran automáticamente
  después de 90 días (`SENTINEL_RETENTION_DAYS`) — un incidente todavía
  abierto nunca se borra, sin importar su antigüedad. Corre una vez al día,
  dentro del mismo loop de polling.
- El dashboard muestra una barra con el uso aproximado de IPQualityScore
  este mes (contra el límite gratis de 5,000/mes) y se pone en amarillo al
  80%. Es una aproximación (ver el docstring de `/sentinel/ip-intel-quota`
  en el backend) — como el enriquecimiento solo ocurre en ataques ya
  marcados, en la práctica el número real de consultas debería quedarse muy
  por debajo del límite salvo un incidente inusualmente largo.

## Verificación

Rompe algo a propósito (para el proceso `worker` en Railway, o cambia
temporalmente `NUVOS_BACKEND_URL` a una URL inválida) y confirma que después
de 3 fallos consecutivos (~6 min) llega el SMS y el email, y que al
restaurarlo llega el mensaje de "recuperado".

## Correr localmente

```
cd nuvos-sentinel
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # y llena los valores
export $(cat .env | xargs)
uvicorn main:app --reload
```
