// Fase 9C §3/§5: reglas de presentación puras, compartidas entre el
// Explorador, la ficha y el Comparador de ETFs en mobile — nunca
// renderiza un peso sectorial/geográfico ausente como una barra vacía
// o un 0%, siempre el literal "no disponible" (el backend ya distingue
// null real de 0.0 confirmado — ver normalize.py/comparison.py). Nunca
// recalcula un número; solo decide cómo mostrar lo que el backend ya
// envió.
export function formatWeightPct(value: number | null | undefined, na: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return na;
  return `${value.toFixed(1)}%`;
}

// Mismo regex que el backend (backend/app/api/routes/etf.py):
// ^[A-Z]{1,6}(\.[A-Z]{1,3})?$ — valida ANTES de construir la URL, para
// mostrar un error local inmediato en vez de esperar un 400 del
// servidor en cada intento con un símbolo mal formado.
const TICKER_REGEX = /^[A-Z]{1,6}(\.[A-Z]{1,3})?$/;

export function isValidEtfTicker(input: string): boolean {
  return TICKER_REGEX.test(input.trim().toUpperCase());
}

// Fase 9D §1: backend/app/services/etf/service.py construye
// `structural_fetched_at`/`price_fetched_at` con `time.time()` — un
// timestamp Unix en segundos (float), NUNCA una fecha ya formateada.
// Verificado contra el código real del backend (no asumido) tras el
// hallazgo de que el footer de la ficha intentaba interpolar ese float
// crudo directamente en el texto de i18n.
export function formatUnixTimestamp(ts: number | null | undefined, locale: "es" | "en" = "es"): string | null {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return null;
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(locale === "es" ? "es-ES" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

// backend/app/services/etf/metrics.py::cost_tier — mismas bandas,
// reutilizado aquí solo para elegir el color/ícono de la UI; el texto
// del tier en sí siempre viene del backend (costs.cost_tier), nunca se
// recalcula el umbral del lado del cliente para decidir el TEXTO.
export function costTierColor(tier: string | null | undefined): string {
  switch (tier) {
    case "muy_bajo": return "#00e887";
    case "bajo": return "#6ee7b7";
    case "moderado": return "#f0b429";
    case "alto": return "#f87171";
    default: return "#94a3b8";
  }
}
