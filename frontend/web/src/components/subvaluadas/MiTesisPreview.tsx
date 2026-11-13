"use client";

// MiTesisPreview — Nuvos Radar "Mi tesis" tab, local dev-only prototype
// (NOT wired into the real ficha, NOT reachable by real users).
//
// Diego, 2026-11-12: replace the old, much heavier Investment Journal
// reference (free-text thesis_summary/strengths/critical_variables/
// key_risks/invalidation_events, backed by the real `user_investment_theses`
// table and its fork/version/history API — see
// backend/app/api/routes/research_engine.py's `/company/{ticker}/thesis/*`
// routes, and the orphaned ThesisHistoryPanel/InvestmentChecklistPanel
// components, neither of which is wired into any live page today) with a
// dramatically simpler, chip-based personal-reflection screen: one
// single-select "decisión de hoy", four compact secondary blocks (reasons /
// invalidation triggers / signals to watch / horizon), all pre-defined
// selections — almost no manual typing.
//
// Deliberately NOT wired to the real `user_investment_theses` backend:
// that schema is free-text claims and requires an authenticated session
// (`get_current_user_id`), which doesn't fit this chip-based shape and
// would break the no-login preview pattern every other tab in this
// prototype (Resumen/Valuación/Riesgos) uses. State here is local-only,
// persisted per-ticker to localStorage so a reload doesn't lose it during
// review — never claimed to be synced to the user's real account. See the
// component's closing note for the honest real-persistence gap.
//
// Arthur nunca prescribe: the line under "Mi decisión hoy" explicitly
// frames this as the user's own reflection, never a recommendation from
// Nuvos.

import { useEffect, useState } from "react";
import { GlowCard, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { SectionTitle, TabNav, Pill } from "@/components/subvaluadas/ResumenPreview";
import { fmtPrice } from "@/lib/types/stock";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

type Decision = "seguir" | "portafolio" | "estudiar" | "no_convence";

const _DECISIONS: { key: Decision; label: string }[] = [
  { key: "seguir", label: "Me interesa seguirla" },
  { key: "portafolio", label: "Ya la tengo en portafolio" },
  { key: "estudiar", label: "Quiero estudiarla más" },
  { key: "no_convence", label: "No me convence por ahora" },
];

const _REASONS = [
  "Negocio fácil de entender",
  "Ventajas competitivas fuertes",
  "Buen crecimiento",
  "Buena rentabilidad",
  "Buena valuación",
  "Exposición a tendencias de largo plazo",
];

const _INVALIDATION_TRIGGERS = [
  "Deterioro del crecimiento",
  "Deterioro de márgenes",
  "Cambios regulatorios",
  "Mayor competencia",
  "Valuación excesiva",
  "Cambio estructural en la tesis",
];

const _SIGNALS = [
  "Próximos resultados trimestrales",
  "Márgenes",
  "Crecimiento del negocio clave",
  "Comentarios del management",
  "Riesgos regulatorios",
];

type Horizon = "corto" | "mediano" | "largo";

const _HORIZONS: { key: Horizon; label: string }[] = [
  { key: "corto", label: "Corto plazo" },
  { key: "mediano", label: "Mediano plazo" },
  { key: "largo", label: "Largo plazo (3–5 años o más)" },
];

interface ThesisState {
  decision: Decision | null;
  reasons: string[];
  reasonOther: string;
  triggers: string[];
  triggerOther: string;
  signals: string[];
  horizon: Horizon | null;
  savedAt: string | null;
}

const _EMPTY_STATE: ThesisState = {
  decision: null,
  reasons: [],
  reasonOther: "",
  triggers: [],
  triggerOther: "",
  signals: [],
  horizon: null,
  savedAt: null,
};

function _storageKey(ticker: string): string {
  return `nuvos:mi-tesis:${ticker}`;
}

function _loadState(ticker: string): ThesisState {
  if (typeof window === "undefined") return _EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(_storageKey(ticker));
    if (!raw) return _EMPTY_STATE;
    const parsed = JSON.parse(raw);
    return { ..._EMPTY_STATE, ...parsed };
  } catch {
    return _EMPTY_STATE;
  }
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Single-select chip group. */
function ChipGroup<T extends string>({
  options, value, onChange,
}: { options: { key: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className="px-3 py-2 rounded-xl text-[12.5px] font-bold transition-colors"
            style={
              active
                ? { background: GOLD, color: "#1a1206", border: "1px solid transparent" }
                : { background: "var(--raised)", color: "var(--sub)", border: "1px solid var(--border)" }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select chip group. */
function MultiChipGroup({
  options, values, onToggle,
}: { options: string[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors"
            style={
              active
                ? { background: "rgba(212,162,76,0.18)", color: GOLD, border: "1px solid rgba(212,162,76,0.5)" }
                : { background: "var(--raised)", color: "var(--sub)", border: "1px solid var(--border)" }
            }
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function SignalChecklist({ values, onToggle }: { values: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {_SIGNALS.map((signal) => {
        const checked = values.includes(signal);
        return (
          <button
            key={signal}
            type="button"
            onClick={() => onToggle(signal)}
            className="flex items-center gap-2.5 text-left min-h-[36px]"
          >
            <span
              className="w-4 h-4 rounded shrink-0 flex items-center justify-center"
              style={{
                background: checked ? GOLD : "transparent",
                border: `1.5px solid ${checked ? GOLD : "var(--border)"}`,
              }}
            >
              {checked && <span style={{ color: "#1a1206", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
            </span>
            <span className="text-[12.5px]" style={{ color: checked ? "var(--text)" : "var(--sub)" }}>{signal}</span>
          </button>
        );
      })}
    </div>
  );
}

export function MiTesisPreview({ data }: { data: FullCompanyDiagnosticData }) {
  const { currentPrice } = data.valuation;
  const [state, setState] = useState<ThesisState>(_EMPTY_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(_loadState(data.ticker));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.ticker]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(_storageKey(data.ticker), JSON.stringify(state));
    } catch {
      /* localStorage unavailable (private window, quota) — the reflection
       * still works for this session, it just won't survive a reload. */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, data.ticker, hydrated]);

  const update = <K extends keyof ThesisState>(key: K, value: ThesisState[K]) =>
    setState((prev) => ({ ...prev, [key]: value, savedAt: new Date().toISOString() }));

  const hasAnyInput =
    state.decision !== null || state.reasons.length > 0 || state.triggers.length > 0 || state.signals.length > 0 || state.horizon !== null;

  return (
    <div className="max-w-[920px] mx-auto pb-10">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
          <div className="min-w-0">
            <p className="text-xl font-black tracking-tight truncate" style={{ color: "var(--text)" }}>{data.companyName}</p>
            <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>
              {data.ticker} · {data.sector}
              {currentPrice != null && (
                <> · <span style={{ color: "var(--text)", fontWeight: 700 }}>{fmtPrice(currentPrice)}</span></>
              )}
            </p>
          </div>
        </div>
        <TabNav active="tesis" ticker={data.ticker} />
      </div>

      <div className="mb-7 px-1">
        <p className="text-2xl font-black tracking-tight mb-1.5" style={{ color: "var(--text)" }}>Mi tesis</p>
        <p className="text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>
          Guarda por qué te interesa esta empresa y qué tendría que cambiar para revisar tu opinión.
        </p>
      </div>

      {/* Mi decisión hoy — la tarjeta principal */}
      <GlowCard tint={GOLD} strong className="mb-5">
        <p className="text-[13px] font-black uppercase tracking-wide mb-3" style={{ color: GOLD }}>Mi decisión hoy</p>
        <ChipGroup options={_DECISIONS} value={state.decision} onChange={(v) => update("decision", v)} />
        <p className="text-[11.5px] leading-4 mt-3" style={{ color: "var(--sub)" }}>
          Esto es tu propia reflexión personal — Nuvos no hace recomendaciones de compra o venta.
        </p>
      </GlowCard>

      {/* 4 bloques secundarios — grid de 2 columnas en desktop, 1 en móvil */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <GlowCard>
          <SectionTitle>Por qué me interesa</SectionTitle>
          <MultiChipGroup options={_REASONS} values={state.reasons} onToggle={(v) => update("reasons", toggleInList(state.reasons, v))} />
        </GlowCard>

        <GlowCard>
          <SectionTitle>Qué cambiaría mi opinión</SectionTitle>
          <MultiChipGroup options={_INVALIDATION_TRIGGERS} values={state.triggers} onToggle={(v) => update("triggers", toggleInList(state.triggers, v))} />
        </GlowCard>

        <GlowCard>
          <SectionTitle>Señales a vigilar</SectionTitle>
          <SignalChecklist values={state.signals} onToggle={(v) => update("signals", toggleInList(state.signals, v))} />
        </GlowCard>

        <GlowCard>
          <SectionTitle>Mi horizonte</SectionTitle>
          <ChipGroup options={_HORIZONS} value={state.horizon} onChange={(v) => update("horizon", v)} />
        </GlowCard>
      </div>

      {/* Historial — muy secundario, al final, nunca compite con la tesis actual */}
      <div className="flex items-center justify-between px-1 py-2.5" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>
          {hasAnyInput && state.savedAt
            ? `Guardado en este dispositivo · ${new Date(state.savedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}`
            : "Tu tesis se guarda automáticamente en este dispositivo."}
        </p>
        <Pill label="Solo local" color="#8C97AD" />
      </div>
    </div>
  );
}
