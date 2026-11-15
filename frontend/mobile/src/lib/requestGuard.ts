// Fase 9C §1: guardia mínima y reutilizable contra respuestas HTTP
// obsoletas — una función pura, sin React, sin fetch. Cualquier llamada
// asíncrona pide un id con `next()` antes de disparar la petición y
// comprueba `isCurrent(id)` cuando la respuesta llega; si ya no es la
// petición vigente (porque el usuario cambió de portafolio, de ticker,
// o disparó una nueva simulación mientras la anterior seguía en vuelo),
// la respuesta se descarta en silencio. `invalidate()` adelanta el
// contador sin emitir un nuevo id — se usa cuando el PORTAFOLIO cambia,
// para que cualquier petición ya en curso deje de ser vigente aunque
// nadie haya pedido un id nuevo todavía.
export type RequestGuard = {
  next: () => number;
  isCurrent: (id: number) => boolean;
  invalidate: () => void;
};

export function createRequestGuard(): RequestGuard {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (id: number) => id === current,
    invalidate: () => { current += 1; },
  };
}
