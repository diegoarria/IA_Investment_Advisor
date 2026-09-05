"""Tiny password-gated status dashboard — its own auth (HTTP Basic against
SENTINEL_DASHBOARD_PASSWORD), deliberately NOT tied to Supabase/Nuvos login,
so it keeps working even if the main app's own auth system is the thing
that's down."""
import secrets
import time
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse

import config
import state
from engine import CHECKS, run_cycle
from checks import fetch_ip_quota, fetch_ai_status, set_ai_toggle

app = FastAPI(title="Nuvos Sentinel")
security = HTTPBasic()

_DAY = 86400


def _require_auth(credentials: HTTPBasicCredentials = Depends(security)) -> None:
    if not config.SENTINEL_DASHBOARD_PASSWORD:
        raise HTTPException(status_code=503, detail="Dashboard password not configured")
    user_ok = secrets.compare_digest(credentials.username, config.SENTINEL_DASHBOARD_USER)
    pass_ok = secrets.compare_digest(credentials.password, config.SENTINEL_DASHBOARD_PASSWORD)
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=401, detail="Unauthorized", headers={"WWW-Authenticate": "Basic"})


@app.get("/healthz")
async def healthz():
    """Unauthenticated, deliberately — this is the URL you register with an
    EXTERNAL free uptime monitor (UptimeRobot, Better Stack, Cronitor...) so
    something outside this whole system tells you if the Sentinel itself
    goes down. Without this, nothing watches the watchman. See README's
    "Watchdog for the watchdog" section for setup steps — an agent can't
    sign up for that third-party account on your behalf."""
    return {"status": "ok"}


@app.get("/api/status")
async def status(_auth: None = Depends(_require_auth)):
    states = {s["kind"]: s for s in state.all_states()}
    checks = []
    for kind, (label, _fn) in CHECKS.items():
        st = states.get(kind, {})
        checks.append({
            "kind": kind,
            "label": label,
            "is_down": bool(st.get("is_down")),
            "detail": st.get("last_detail"),
            "consecutive_fails": st.get("consecutive_fails", 0),
            "uptime_24h": round(state.uptime_percentage(kind, _DAY), 2),
            "uptime_7d": round(state.uptime_percentage(kind, 7 * _DAY), 2),
            "incident_days": sorted(state.daily_incident_days(kind, days=14)),
        })

    quota = await fetch_ip_quota()
    used = quota.get("approx_lookups_this_month")
    quota_pct = round(100 * used / config.IPQUALITYSCORE_FREE_TIER_LIMIT, 1) if used is not None else None

    ai = await fetch_ai_status()

    return {
        "checks": checks,
        "incidents": state.recent_incidents(50),
        "suspicious_ips": state.recent_flagged_ips(50),
        "ip_quota": {
            "used": used,
            "limit": config.IPQUALITYSCORE_FREE_TIER_LIMIT,
            "pct": quota_pct,
            "warn": quota_pct is not None and quota_pct >= 80,
        },
        "ai_status": ai,
        "poll_interval_seconds": config.POLL_INTERVAL_SECONDS,
        "server_time": time.time(),
    }


@app.post("/api/run-now")
async def run_now(_auth: None = Depends(_require_auth)):
    """Optional manual refresh — the panel already updates itself on its
    own every few seconds and the background loop polls Nuvos independently
    of anyone having the dashboard open at all. This just forces an
    immediate extra check instead of waiting for the next scheduled one."""
    await run_cycle()
    return {"ok": True}


@app.get("/api/ai-status")
async def ai_status_route(_auth: None = Depends(_require_auth)):
    return await fetch_ai_status()


@app.post("/api/ai-toggle")
async def ai_toggle_route(body: dict, _auth: None = Depends(_require_auth)):
    """Flips Arthur/every AI feature on the main app on or off — see
    backend's /sentinel/ai-toggle for the full list of what this pauses.
    `reason` is free text (e.g. "posible ataque", "mantenimiento") stored
    alongside the toggle for the audit trail (security_events, 'ai_toggled')."""
    enabled = bool(body.get("enabled"))
    reason = body.get("reason")
    return await set_ai_toggle(enabled, reason)


@app.get("/", response_class=HTMLResponse)
async def index(_auth: None = Depends(_require_auth)):
    return _PAGE


_PAGE = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nuvos Sentinel</title>
<style>
  :root {
    --bg: #0b0f14; --panel: #131a22; --panel2: #171f29; --border: #232b35;
    --text: #e6e6e6; --muted: #9aa5b1; --ok: #2ecc71; --down: #e74c3c; --warn: #f5a623;
    --accent: #2d6cdf;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  h2 { font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 28px 0 10px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .ok { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .down { background: var(--down); box-shadow: 0 0 8px var(--down); }
  .label { font-weight: 700; font-size: 15px; }
  .detail { color: var(--muted); font-size: 12.5px; margin-top: 2px; white-space: pre-wrap; }
  .uptimes { display: flex; gap: 16px; margin-top: 12px; }
  .uptime-figure { font-size: 20px; font-weight: 800; }
  .uptime-figure.bad { color: var(--down); }
  .uptime-caption { font-size: 11px; color: var(--muted); text-transform: uppercase; }
  .spark { display: flex; gap: 3px; margin-top: 12px; }
  .spark div { flex: 1; height: 20px; border-radius: 3px; background: var(--ok); opacity: .85; }
  .spark div.bad { background: var(--down); }

  .quota-bar { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-top: 20px; }
  .quota-track { background: var(--panel2); border-radius: 6px; height: 8px; margin-top: 8px; overflow: hidden; }
  .quota-fill { height: 100%; background: var(--accent); }
  .quota-fill.warn { background: var(--warn); }

  button { background: var(--accent); color: white; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; margin: 16px 0; font-size: 14px; }
  button:active { opacity: .8; }
  button.secondary { background: var(--panel2); border: 1px solid var(--border); }

  .ai-switch { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .ai-switch-status { flex: 1; min-width: 200px; }
  .ai-switch-title { font-weight: 700; font-size: 15px; }
  .ai-switch-detail { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  .toggle { position: relative; width: 52px; height: 30px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-track { position: absolute; inset: 0; background: var(--down); border-radius: 30px; cursor: pointer; transition: background .2s; }
  .toggle input:checked + .toggle-track { background: var(--ok); }
  .toggle-knob { position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; background: white; border-radius: 50%; transition: transform .2s; }
  .toggle input:checked + .toggle-track .toggle-knob { transform: translateX(22px); }
  .reason-picker { display: none; flex-direction: column; gap: 8px; width: 100%; background: var(--panel2); border-radius: 10px; padding: 12px; margin-top: 8px; }
  .reason-picker.open { display: flex; }
  .reason-picker button { margin: 0; text-align: left; }

  .table-wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 600px; }
  td, th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  tr:last-child td { border-bottom: none; }

  @media (max-width: 480px) {
    body { padding: 10px; }
    .uptimes { gap: 10px; }
  }
</style>
</head>
<body>
  <h1>🛡️ Nuvos Sentinel</h1>
  <div class="sub" id="lastCheck">Cargando... · se actualiza solo, no hace falta hacer nada</div>

  <div class="ai-switch">
    <label class="toggle">
      <input type="checkbox" id="aiToggleInput" onchange="onAiToggleChange()">
      <span class="toggle-track"><span class="toggle-knob"></span></span>
    </label>
    <div class="ai-switch-status">
      <div class="ai-switch-title" id="aiSwitchTitle">Cargando estado de la IA...</div>
      <div class="ai-switch-detail" id="aiSwitchDetail"></div>
    </div>
    <div class="reason-picker" id="reasonPicker">
      <div style="font-size:13px; color:var(--muted); margin-bottom:4px;">¿Por qué apagas la IA?</div>
      <button onclick="confirmAiToggle('Posible ataque cibernético')">🚨 Posible ataque cibernético</button>
      <button onclick="confirmAiToggle('Mantenimiento de la app')">🛠️ Mantenimiento de la app para mejoras</button>
      <button class="secondary" onclick="confirmAiToggle('Otro motivo')">Otro motivo</button>
      <button class="secondary" onclick="cancelAiToggle()">Cancelar</button>
    </div>
  </div>

  <div class="cards" id="checks"></div>

  <div class="quota-bar" id="quotaBar" hidden>
    <div style="display:flex; justify-content:space-between; font-size:13px;">
      <span>Cuota IPQualityScore (este mes)</span>
      <span id="quotaText"></span>
    </div>
    <div class="quota-track"><div class="quota-fill" id="quotaFill"></div></div>
  </div>

  <button class="secondary" onclick="runNow()">Forzar una verificación extra ahora (opcional — ya se revisa solo)</button>

  <h2>Incidentes recientes</h2>
  <div class="table-wrap">
  <table id="incidents"><thead><tr><th>Tipo</th><th>Abierto</th><th>Cerrado</th><th>Detalle</th></tr></thead><tbody></tbody></table>
  </div>

  <h2>IPs sospechosas (ataques detectados)</h2>
  <div class="table-wrap">
  <table id="suspicious"><thead><tr>
    <th>IP</th><th># eventos</th><th>Dispositivo</th><th>Ciudad</th><th>Región</th>
    <th>C.P.</th><th>País</th><th>Empresa (ISP)</th><th>ASN</th><th>Tipo conexión</th>
    <th>VPN</th><th>TOR</th><th>Proxy</th><th>Fraude</th><th>Detectado</th>
  </tr></thead><tbody></tbody></table>
  </div>

<script>
function flag(v) { return v ? '⚠️ sí' : 'no'; }
function fmtPct(p) { return (p === null || p === undefined) ? '—' : p.toFixed(2) + '%'; }

function sparkline(days) {
  const set = new Set(days || []);
  const cells = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    cells.push(`<div class="${set.has(key) ? 'bad' : ''}" title="${key}"></div>`);
  }
  return cells.join('');
}

async function load() {
  const res = await fetch('/api/status');
  const data = await res.json();

  document.getElementById('lastCheck').textContent =
    'Última actualización: ' + new Date(data.server_time * 1000).toLocaleTimeString() +
    ' · se actualiza solo cada 5s · Nuvos se revisa cada ' + (data.poll_interval_seconds || 120) + 's';

  const ai = data.ai_status || {};
  const aiInput = document.getElementById('aiToggleInput');
  aiInput.checked = !!ai.enabled;
  document.getElementById('aiSwitchTitle').textContent = ai.enabled
    ? '🟢 IA activa — Arthur y todo lo demás funcionando normal'
    : '🔴 IA en pausa';
  document.getElementById('aiSwitchDetail').textContent = ai.enabled
    ? 'Apaga el switch si necesitas pausar toda la IA (ataque, mantenimiento, u otro motivo).'
    : `Motivo: ${ai.reason || 'sin especificar'}${ai.updated_at ? ' · desde ' + new Date(ai.updated_at).toLocaleString() : ''}`;

  const checksEl = document.getElementById('checks');
  checksEl.innerHTML = data.checks.map(c => `
    <div class="card">
      <div class="card-top">
        <div class="dot ${c.is_down ? 'down' : 'ok'}"></div>
        <div class="label">${c.label}</div>
      </div>
      <div class="detail">${c.detail || 'ok'}</div>
      <div class="uptimes">
        <div>
          <div class="uptime-figure ${c.uptime_24h < 100 ? 'bad' : ''}">${fmtPct(c.uptime_24h)}</div>
          <div class="uptime-caption">Uptime 24h</div>
        </div>
        <div>
          <div class="uptime-figure ${c.uptime_7d < 100 ? 'bad' : ''}">${fmtPct(c.uptime_7d)}</div>
          <div class="uptime-caption">Uptime 7d</div>
        </div>
      </div>
      <div class="spark">${sparkline(c.incident_days)}</div>
    </div>
  `).join('');

  const q = data.ip_quota || {};
  const quotaBar = document.getElementById('quotaBar');
  if (q.used !== null && q.used !== undefined) {
    quotaBar.hidden = false;
    document.getElementById('quotaText').textContent = `${q.used} / ${q.limit} (${q.pct}%)`;
    const fill = document.getElementById('quotaFill');
    fill.style.width = Math.min(100, q.pct) + '%';
    fill.className = 'quota-fill' + (q.warn ? ' warn' : '');
  }

  const tbody = document.querySelector('#incidents tbody');
  tbody.innerHTML = data.incidents.map(i => `
    <tr><td>${i.kind}</td><td>${new Date(i.opened_at*1000).toLocaleString()}</td>
    <td>${i.closed_at ? new Date(i.closed_at*1000).toLocaleString() : '—'}</td><td>${i.detail || ''}</td></tr>
  `).join('') || '<tr><td colspan="4" style="color:var(--muted)">Sin incidentes</td></tr>';

  const susBody = document.querySelector('#suspicious tbody');
  susBody.innerHTML = (data.suspicious_ips || []).map(r => `
    <tr>
      <td>${r.ip}</td><td>${r.event_count ?? ''}</td><td title="${r.device || ''}">${(r.device || '').slice(0,40)}</td>
      <td>${r.city || ''}</td><td>${r.region || ''}</td><td>${r.postal_code || ''}</td><td>${r.country || ''}</td>
      <td>${r.isp || r.organization || ''}</td><td>${r.asn || ''}</td><td>${r.connection_type || ''}</td>
      <td>${flag(r.is_vpn)}</td><td>${flag(r.is_tor)}</td><td>${flag(r.is_proxy)}</td>
      <td>${r.fraud_score ?? ''}</td><td>${new Date(r.flagged_at*1000).toLocaleString()}</td>
    </tr>
  `).join('') || '<tr><td colspan="14" style="color:var(--muted)">Sin IPs marcadas</td></tr>';
}
async function runNow() {
  await fetch('/api/run-now', { method: 'POST' });
  load();
}

function onAiToggleChange() {
  const input = document.getElementById('aiToggleInput');
  if (input.checked) {
    // Turning back ON — no reason needed, apply immediately.
    applyAiToggle(true, null);
  } else {
    // Turning OFF — require picking a reason first; revert visually until confirmed.
    document.getElementById('reasonPicker').classList.add('open');
  }
}
async function confirmAiToggle(reason) {
  document.getElementById('reasonPicker').classList.remove('open');
  await applyAiToggle(false, reason);
}
function cancelAiToggle() {
  document.getElementById('reasonPicker').classList.remove('open');
  document.getElementById('aiToggleInput').checked = true;
}
async function applyAiToggle(enabled, reason) {
  await fetch('/api/ai-toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, reason }),
  });
  load();
}

load();
setInterval(load, 5000);
</script>
</body>
</html>"""
