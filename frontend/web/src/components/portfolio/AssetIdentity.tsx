"use client";

// Nuvos Plus — Fase 5D: logo + ticker + nombre completo, reutilizado en
// el selector, el encabezado de resultado, Distribución, Exposición
// (contribuyentes) e Historia de "Antes de invertir", y en la lista de
// posiciones de "Entender mi portafolio". Reutiliza StockAvatar.tsx
// (logo real vía parqet.com, o iniciales si no hay logo verificable) —
// ningún proveedor nuevo, ningún mapeo manual de tickers.
//
// Nunca inventa un nombre: si `name` es null/undefined, solo se muestra
// el ticker — nunca un nombre derivado o adivinado. La gestora de un ETF
// (`etfCompany`) solo se muestra cuando aporta algo que el nombre del
// fondo no ya dice (p. ej. "Vanguard S&P 500 ETF" ya menciona Vanguard,
// así que "etf_company: Vanguard" se omite para esa fila).
import StockAvatar from "@/components/StockAvatar";

export function AssetIdentity({
  ticker,
  name,
  etfCompany,
  size = "sm",
  tickerClassName = "text-[13px]",
  nameClassName = "text-[11px]",
}: {
  ticker: string;
  name?: string | null;
  etfCompany?: string | null;
  size?: "sm" | "md" | "lg";
  tickerClassName?: string;
  nameClassName?: string;
}) {
  const showCompany = !!(etfCompany && (!name || !name.toLowerCase().includes(etfCompany.toLowerCase())));
  return (
    <div className="flex items-center gap-2 min-w-0">
      <StockAvatar ticker={ticker} size={size} />
      <div className="min-w-0">
        <p className={`font-bold truncate ${tickerClassName}`} style={{ color: "var(--text)" }}>{ticker}</p>
        {name && (
          <p className={`truncate ${nameClassName}`} style={{ color: "var(--sub)" }}>
            {name}{showCompany ? ` · ${etfCompany}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
