"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useAuthStore } from "@/lib/store";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

const PUSH_TOGGLES = [
  { key: "push_market_open",        label: "Apertura del mercado",    desc: "9:30 AM ET cada día hábil" },
  { key: "push_market_close",       label: "Cierre del mercado",      desc: "4:00 PM ET cada día hábil" },
  { key: "push_portfolio_alerts",   label: "Alertas de portafolio",   desc: "Movimientos ±4%, earnings y dividendos de tus posiciones" },
  { key: "push_watchlist_alerts",   label: "Alertas de watchlist",    desc: "Movimientos ±4%, earnings y dividendos de tu lista de seguimiento" },
  { key: "push_news_general",       label: "Noticias importantes",    desc: "Fed, CPI, resultados trimestrales" },
  { key: "push_ai_recommendations", label: "Recomendaciones IA",      desc: "Insights personalizados según tu perfil" },
  { key: "push_milestones",         label: "Hitos y logros",          desc: "Rachas, metas y aniversarios" },
  { key: "push_volatility",         label: "Alertas de volatilidad",  desc: "Eventos de alta volatilidad" },
];
const EMAIL_TOGGLES = [
  { key: "email_daily_summary",  label: "Resumen diario",  desc: "Lun–Vie a las 6:00 PM ET" },
  { key: "email_weekly_summary", label: "Resumen semanal", desc: "Sábados con análisis premium" },
];

interface Props { onClose: () => void }

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 ml-3 w-11 h-6 rounded-full relative transition-colors"
      style={{ background: on ? "var(--accent-l, #22c55e)" : "var(--border, #2a2d3a)" }}
    >
      <span
        className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform"
        style={{ transform: on ? "translateX(22px)" : "translateX(4px)" }}
      />
    </button>
  );
}

export default function NotificationSettingsPanel({ onClose }: Props) {
  const { token } = useAuthStore();
  const [prefs, setPrefs] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/notification-settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setPrefs(await res.json());
      } catch {}
      setLoading(false);
    })();
  }, [token]);

  const toggle = (key: string) =>
    setPrefs((p) => (p ? { ...p, [key]: !p[key] } : p));

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await fetch(`${API}/api/notification-settings`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-sm flex flex-col"
        style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0"
             style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="font-bold text-base" style={{ color: "var(--text)" }}>
            Notificaciones
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5"
                  style={{ color: "var(--muted)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
            </div>
          ) : !prefs ? (
            <p className="text-sm text-center py-10" style={{ color: "var(--muted)" }}>
              Error al cargar preferencias
            </p>
          ) : (
            <>
              {/* Push section */}
              <section>
                <p className="text-xs font-black uppercase tracking-widest mb-3"
                   style={{ color: "var(--accent-l)", letterSpacing: "0.12em" }}>
                  Push
                </p>
                <div className="space-y-1">
                  {PUSH_TOGGLES.map(({ key, label, desc }) => (
                    <button key={key} onClick={() => toggle(key)}
                            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/3 transition-colors"
                            style={{ background: "var(--raised)" }}>
                      <div className="text-left">
                        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{label}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--dim, #6b7280)" }}>{desc}</p>
                      </div>
                      <Toggle on={!!prefs[key]} onClick={() => toggle(key)} />
                    </button>
                  ))}
                </div>
              </section>

              {/* Email section */}
              <section>
                <p className="text-xs font-black uppercase tracking-widest mb-3"
                   style={{ color: "var(--accent-l)", letterSpacing: "0.12em" }}>
                  Emails
                </p>
                <div className="space-y-1">
                  {EMAIL_TOGGLES.map(({ key, label, desc }) => (
                    <button key={key} onClick={() => toggle(key)}
                            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/3 transition-colors"
                            style={{ background: "var(--raised)" }}>
                      <div className="text-left">
                        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{label}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--dim, #6b7280)" }}>{desc}</p>
                      </div>
                      <Toggle on={!!prefs[key]} onClick={() => toggle(key)} />
                    </button>
                  ))}
                </div>
              </section>

              {/* Limits section */}
              <section>
                <p className="text-xs font-black uppercase tracking-widest mb-3"
                   style={{ color: "var(--accent-l)", letterSpacing: "0.12em" }}>
                  Límites
                </p>
                <div className="p-4 rounded-xl space-y-5" style={{ background: "var(--raised)" }}>
                  <div>
                    <div className="flex justify-between mb-2">
                      <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                        Máx. por día
                      </p>
                      <span className="text-sm font-bold" style={{ color: "var(--accent-l)" }}>
                        {prefs.max_push_per_day}
                      </span>
                    </div>
                    <input type="range" min={1} max={10}
                           value={prefs.max_push_per_day ?? 5}
                           onChange={(e) => setPrefs((p) => p ? { ...p, max_push_per_day: +e.target.value } : p)}
                           className="w-full accent-green-500" />
                  </div>

                  <div>
                    <p className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>
                      Horas silenciosas (ET)
                    </p>
                    <div className="flex gap-3">
                      {(["quiet_hours_start", "quiet_hours_end"] as const).map((field, i) => (
                        <div key={field} className="flex-1">
                          <p className="text-xs mb-1" style={{ color: "var(--dim, #6b7280)" }}>
                            {i === 0 ? "Desde" : "Hasta"}
                          </p>
                          <select
                            value={prefs[field] ?? (i === 0 ? 22 : 8)}
                            onChange={(e) =>
                              setPrefs((p) => p ? { ...p, [field]: +e.target.value } : p)
                            }
                            className="w-full p-2 rounded-lg text-sm"
                            style={{
                              background: "var(--card)",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                            }}
                          >
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Save */}
        <div className="px-5 py-4 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={save}
            disabled={saving || !prefs}
            className="w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
            style={{
              background: saved ? "rgba(34,197,94,0.12)" : "var(--accent-l, #22c55e)",
              color:      saved ? "var(--accent-l)"     : "#fff",
              border:     saved ? "1px solid var(--accent-l)" : "none",
              opacity:    !prefs ? 0.5 : 1,
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? "Guardado ✓" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
