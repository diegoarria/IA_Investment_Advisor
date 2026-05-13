# IA Investment Advisor

> Tu mentor de inversiones inteligente — aprende a pensar como un inversionista profesional

## Stack

- **Backend**: Python + FastAPI + Claude API (Anthropic) + yfinance + Supabase (PostgreSQL)
- **Web**: Next.js 15 + TypeScript + TailwindCSS + Zustand
- **Mobile**: Expo (React Native) + TypeScript

---

## Setup Rápido

### 1. Supabase
1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **SQL Editor** y ejecuta `backend/supabase_schema.sql`
3. Copia `Project URL`, `anon key` y `service_role key`

### 2. Backend
```bash
cd backend
cp .env.example .env
# Edita .env con tus keys

python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

uvicorn main:app --reload
# API disponible en http://localhost:8000
# Docs en http://localhost:8000/docs
```

### 3. Web
```bash
cd frontend/web
cp .env.local.example .env.local
# Edita .env.local con tus keys de Supabase

npm install
npm run dev
# App en http://localhost:3000
```

### 4. Mobile
```bash
cd frontend/mobile
# Crea .env con EXPO_PUBLIC_API_URL=http://TU_IP_LOCAL:8000

npm install
npx expo start
# Escanea el QR con Expo Go en tu teléfono
```

---

## Variables de entorno

### Backend (.env)
| Variable | Descripción |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Clave de la API de Anthropic |
| `SUPABASE_URL` | URL de tu proyecto Supabase |
| `SUPABASE_ANON_KEY` | Clave anon de Supabase |
| `SUPABASE_SERVICE_KEY` | Clave service_role de Supabase |
| `SECRET_KEY` | String secreto para JWT (mín 32 chars) |

### Web (.env.local)
| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | URL del backend (default: http://localhost:8000) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL de tu proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anon de Supabase |

---

## Arquitectura

```
IA_Investment_Advisor/
├── backend/
│   ├── main.py                    # FastAPI app + APScheduler
│   ├── app/
│   │   ├── api/routes/
│   │   │   ├── auth.py            # Register/Login con Supabase Auth
│   │   │   ├── profile.py         # Perfil financiero dinámico
│   │   │   ├── chat.py            # Chat con streaming (Claude API)
│   │   │   ├── market.py          # Datos de mercado + análisis IA
│   │   │   └── notifications.py   # Sistema de notificaciones
│   │   ├── services/
│   │   │   ├── ai_service.py      # Claude API + prompts especializados
│   │   │   ├── market_service.py  # yfinance integration
│   │   │   └── notification_service.py  # Notificaciones inteligentes
│   │   └── models/                # Pydantic models
│   └── supabase_schema.sql        # Schema de base de datos
├── frontend/
│   ├── web/                       # Next.js app
│   │   └── src/app/
│   │       ├── page.tsx           # Login/Register
│   │       ├── onboarding/        # Setup de perfil (5 pasos)
│   │       ├── chat/              # Chat principal con streaming
│   │       ├── portfolio/         # Simulador de portafolios
│   │       └── notifications/     # Centro de notificaciones
│   └── mobile/                    # Expo app
│       └── app/
│           ├── index.tsx          # Login/Register
│           ├── onboarding/        # Setup de perfil
│           └── (tabs)/            # Chat, Portfolio, Notificaciones
└── README.md
```

## Funcionalidades Implementadas

| Feature | Estado |
|---------|--------|
| ✅ Perfil financiero dinámico (5 pasos onboarding) | Completo |
| ✅ Chat con streaming en tiempo real | Completo |
| ✅ Análisis educativo de activos con datos reales | Completo |
| ✅ Comparación por escenarios (agresivo/moderado/conservador) | Completo |
| ✅ Simulador de portafolios educativos | Completo |
| ✅ Sistema de notificaciones inteligentes | Completo |
| ✅ Contexto del mercado en tiempo real (yfinance) | Completo |
| ✅ Notificaciones automáticas 2x/día (9am y 4pm ET) | Completo |
| ✅ Historial de chat persistente | Completo |
| ✅ Prompt caching (reducción de costos API) | Completo |
| ✅ Web App (Next.js) | Completo |
| ✅ Mobile App (Expo) | Completo |

## Notas Importantes

- La IA **nunca** hace recomendaciones directas de compra/venta
- Todo análisis es **educativo e hipotético**
- Los datos de mercado son de Yahoo Finance (puede tener retrasos)
- Las notificaciones automáticas se ejecutan a las 9am y 4pm hora de Nueva York
