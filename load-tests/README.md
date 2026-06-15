# Nuvos AI — Load Tests

Scripts de pruebas de carga para simular 50 → 10,000 usuarios concurrentes.

## Estructura

```
load-tests/
├── k6/
│   └── nuvos_load_test.js      # k6 — script completo, 11 flujos, 7 tiers
├── locust/
│   └── locustfile.py           # Locust — dashboard interactivo
├── artillery/
│   └── nuvos.yml               # Artillery — rápido para CI/CD
├── analyze_bottlenecks.py      # Análisis estático del código fuente
├── reports/
│   └── PERFORMANCE_AUDIT.md   # Reporte completo de auditoría
└── README.md                   # Este archivo
```

## Instalación rápida

```bash
# k6
brew install k6

# Locust
pip3 install locust

# Artillery
npm install -g artillery

# Analizador (solo stdlib de Python)
# No requiere instalación
```

## Ejecución rápida

```bash
# 1. Análisis de código (sin servidor necesario)
python3 load-tests/analyze_bottlenecks.py

# 2. Locust — 50 usuarios (con dashboard en http://localhost:8089)
cd load-tests/locust && locust -f locustfile.py --host=http://localhost:8000

# 3. k6 — Tier 50
cd load-tests/k6 && k6 run -e TIER=50 nuvos_load_test.js

# 4. Artillery — smoke test
cd load-tests/artillery && artillery run --target http://localhost:8000 nuvos.yml
```

## Resultados esperados

Ver [reports/PERFORMANCE_AUDIT.md](reports/PERFORMANCE_AUDIT.md) para el análisis completo.

**TL;DR:** Capacidad actual ~30–50 usuarios. Con los fixes de Fase 1 (2 semanas): 200–500 usuarios.
