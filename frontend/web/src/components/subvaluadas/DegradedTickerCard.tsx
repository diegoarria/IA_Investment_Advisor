"use client";

// Honest fallback for the two degraded CompanyDiagnosticData states
// (`dataAvailability === "valuation_only" | "unavailable"`) — Diego,
// 2026-11-12: "si una empresa no tiene editorial publicado, debe conservar
// una ficha financiera útil con un estado editorial claro" and "nunca
// conviertas una valoración bajo revisión en una valoración válida por
// ausencia de datos o errores de frontend". This card NEVER infers
// `valid` from the mere presence of a number — it reads `validationStatus`
// exactly as the API sends it and renders accordingly. "valuation_only"
// still has a real, previously-persisted intrinsic value (shown, with its
// real `valuationAsOf` date, never fabricated); "unavailable" has no
// valuation at all and says so plainly, never a placeholder number.

import { GlowCard, IconSquare } from "@/components/subvaluadas/radarUi";
import { fmtPrice } from "@/lib/types/stock";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export function DegradedTickerCard({ data, ticker }: { data: CompanyDiagnosticData; ticker: string }) {
  const hasPartialValuation = data.dataAvailability === "valuation_only" && data.valuation != null;
  const status = data.valuation?.validationStatus;

  return (
    <div className="max-w-[640px] mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{ticker.slice(0, 2)}</span></IconSquare>
        <div className="min-w-0">
          <p className="text-xl font-black tracking-tight truncate" style={{ color: "var(--text)" }}>{data.companyName || ticker}</p>
          <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>{ticker}{data.sector ? ` · ${data.sector}` : ""}</p>
        </div>
      </div>

      <GlowCard>
        {hasPartialValuation ? (
          <>
            <p className="text-[13px] font-black uppercase tracking-wide mb-2" style={{ color: "var(--sub)" }}>
              {status === "under_review" ? "Valoración en revisión" : "Última valoración persistida"}
            </p>
            <p className="text-[12.5px] leading-5 mb-3" style={{ color: "var(--sub)" }}>
              No pudimos reconstruir una ficha completa en este momento (proveedores de datos no disponibles o reconstrucción pendiente),
              pero conservamos el último valor intrínseco calculado para esta empresa.
              {status === "under_review" && " Este número es real y trazable, pero todavía no debe leerse como una conclusión validada."}
            </p>
            <div className="flex items-baseline justify-between pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              <span className="text-[11px]" style={{ color: "var(--sub)" }}>Valor estimado (escenario base)</span>
              <span className="text-[18px] font-black tabular-nums" style={{ color: "var(--text)" }}>
                {data.valuation?.baseFairValue != null ? fmtPrice(data.valuation.baseFairValue) : "No disponible"}
              </span>
            </div>
            <p className="text-[10px] mt-2" style={{ color: "var(--sub)" }}>
              {data.valuationAsOf
                ? `Calculado el ${data.valuationAsOf} — no es necesariamente la valoración más reciente posible.`
                : "Fecha de cálculo no disponible en este momento."}
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-black uppercase tracking-wide mb-2" style={{ color: "var(--sub)" }}>Sin valoración disponible</p>
            <p className="text-[12.5px] leading-5" style={{ color: "var(--sub)" }}>
              Todavía no tenemos una valoración calculada para {data.companyName || ticker}. No se trata de un error —
              simplemente no existe un cálculo previo que mostrar en este momento.
            </p>
          </>
        )}
      </GlowCard>

      <p className="text-[10.5px] text-center mt-4" style={{ color: "var(--sub)" }}>
        Contenido editorial (modelo de negocio, ventajas, riesgos) no disponible sin una ficha financiera completa.
      </p>
    </div>
  );
}
