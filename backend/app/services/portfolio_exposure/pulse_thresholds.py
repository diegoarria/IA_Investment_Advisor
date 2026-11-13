"""
Nuvos Pulse — Fase 6C: umbrales centralizados para el motor de
comparación y la selección de observación principal. UN solo lugar
(Diego, Fase 6C §7: "los umbrales deben estar centralizados y
documentados, no dispersos por distintos archivos") — ningún otro módulo
de Pulse debe tener un número mágico propio para estas decisiones.
"""

# Comparabilidad general — por debajo de este piso de cobertura de
# valoración, ninguna comparación (ni siquiera a nivel de posiciones) se
# considera confiable.
MIN_VALUATION_COVERAGE_PCT = 50.0

# Si la cobertura (de valoración, sectorial o geográfica) difiere más de
# esto en puntos porcentuales entre A y B, esa DIMENSIÓN específica se
# suprime o se marca con advertencia — nunca se presenta como un cambio
# económico real.
MAX_COVERAGE_GAP_PP = 10.0

# Magnitud mínima para que un candidato compita como observación
# principal (no todo cambio real es "relevante" para el Resumen).
SECTOR_DELTA_MIN_PP = 3.0
COMPOSITION_DELTA_MIN_PP = 5.0
CONCENTRATION_DELTA_MIN_PP = 3.0

# Orden de desempate fijo cuando varios candidatos superan su propio
# umbral — nunca decidido por orden de inserción ni al azar.
PRIMARY_CHANGE_CATEGORY_PRIORITY = ("sector", "composition", "concentration")
