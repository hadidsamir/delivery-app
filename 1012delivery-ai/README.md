# 1012Delivery AI — Sistema de Gestión Autónoma con IA

Capa de inteligencia artificial multi-agente para 1012Delivery.
Construida sobre el sistema existente sin modificar ningún componente original.

---

## Stack existente (NO tocar)

| Pieza | Tecnología | Deploy |
|-------|-----------|--------|
| Backend principal | Node.js + Express + Socket.io + Firebase FCM | Railway |
| Base de datos | Supabase PostgreSQL | Supabase Cloud |
| App mensajero (web) | React + Vite + TailwindCSS | Vercel |
| App mensajero (nativa) | React Native + Expo | EAS Build → APK |
| Web cliente / rastreo | React + Vite + Google Maps | Vercel + Docker |
| Panel admin | React + Vite + Supabase Auth | Vercel |
| Redis | Redis compartido con 1012 Studio | Externo |
| n8n | n8n con workflows de Sam | Externo |

---

## Stack nuevo (esta carpeta)

| Pieza | Tecnología | Ubicación |
|-------|-----------|-----------|
| Orquestador de agentes | **Paperclip** (paperclipai/paperclip) | `/paperclip/` |
| Canal de entrada | WhatsApp Business API (Meta Cloud API) | Via n8n |
| CEO Agent | Claude Sonnet 4.6 | Paperclip skill |
| Agente Atención | Claude Haiku 4.5 | Paperclip skill |
| Agente Pedidos | Claude Sonnet 4.6 | Paperclip skill |
| Agente Despacho | Claude Sonnet 4.6 | Paperclip skill |
| Agente Pagos | Claude Haiku 4.5 | Paperclip skill |

---

## Arquitectura de agentes

```
WhatsApp (cliente/mensajero)
        │
        ▼
    n8n Webhook
        │
   Clasificación de intención (< 300ms)
        │
   ┌────┴─────────────────────┐
   │                          │
Tier 1/2                   Tier 3
n8n responde               n8n crea task
directo                    en Paperclip
                               │
                           CEO Agent (Sonnet)
                               │
                   ┌───────────┼───────────┐
                   │           │           │
              Atención      Pedidos    Despacho
              (Haiku)      (Sonnet)   (Sonnet)
                                          │
                                        Pagos
                                       (Haiku)
                               │
                   Callback a n8n → respuesta WhatsApp
```

### Tres tiers de respuesta

| Tier | Latencia | Quién responde | Ejemplos |
|------|----------|---------------|---------|
| **1** | < 1s | n8n directo (sin LLM) | FAQs, confirmaciones, horario |
| **2** | 2-4s | n8n + LLM con tools | Nuevo pedido, estado de pedido |
| **3** | 5-30s | Paperclip CEO | Reclamos, reasignaciones, casos complejos |

---

## Estructura de carpetas

```
1012delivery-ai/
├── README.md                    ← Este archivo
└── paperclip/                   ← Instancia de Paperclip
    ├── .env                     ← Variables de entorno del servidor
    ├── railway.toml             ← Configuración de deploy en Railway
    ├── skills/
    │   └── ceo/
    │       └── SKILL.md         ← Instrucciones del CEO Agent
    ├── server/
    │   └── ui-dist/             ← UI compilada (auto-generada)
    └── ...                      ← Código fuente de Paperclip
```

---

## Variables de entorno

### Paperclip (`.env` en `/paperclip/`)

```env
# Obligatorias
PORT=3100
SERVE_UI=true
PAPERCLIP_DEPLOYMENT_MODE=local_trusted   # local_trusted | cloud

# Base de datos (omitir = usa PostgreSQL embebido)
# DATABASE_URL=postgresql://user:pass@host:5432/paperclip_1012

# Para producción en Railway
# PAPERCLIP_PUBLIC_URL=https://paperclip-1012delivery.railway.app
# PAPERCLIP_AUTH_PUBLIC_BASE_URL=https://paperclip-1012delivery.railway.app
```

### Secrets a configurar dentro del dashboard de Paperclip

Las API keys **no van en `.env`** — se configuran en `Settings > Secrets` del dashboard:

```
ANTHROPIC_API_KEY          → sk-ant-...
SUPABASE_URL               → https://ujuirbwkmwyjgafddcdk.supabase.co
SUPABASE_SERVICE_KEY       → (service role key, NO la anon key)
GOOGLE_MAPS_API_KEY        → AIzaSyAriubtJ4QMKvAMCdS5ajb6JWEYe7jnOsk
WHATSAPP_PHONE_NUMBER_ID   → de Meta Business Manager
WHATSAPP_ACCESS_TOKEN      → de Meta Business Manager
N8N_CALLBACK_BASE_URL      → https://tu-n8n.dominio.com/webhook
DELIVERY_BACKEND_URL       → https://tu-backend.railway.app
```

---

## Orden de instalación

1. ✅ Clonar Paperclip: `git clone https://github.com/paperclipai/paperclip.git`
2. ✅ Instalar pnpm@9.15.4: `npm install -g pnpm@9.15.4`
3. ✅ Instalar dependencias: `pnpm install`
4. ✅ Compilar paquetes: `pnpm build` (o por partes si falla en Windows)
5. ✅ Crear `.env` con `PORT=3100` y `SERVE_UI=true`
6. ✅ Copiar UI compilada a `server/ui-dist/`
7. ✅ Iniciar servidor: `pnpm dev:server` → http://localhost:3100
8. ⏳ **Completar onboarding** en el dashboard (requiere `ANTHROPIC_API_KEY`)
9. ⏳ Crear empresa "1012Delivery" en el dashboard
10. ⏳ Crear los 5 agentes (CEO, Atención, Pedidos, Despacho, Pagos)
11. ⏳ Configurar skills de cada agente
12. ⏳ Conectar con n8n (webhooks de WhatsApp)
13. ⏳ Crear tablas nuevas en Supabase (Prompt 3)
14. ⏳ Crear workflows de n8n (Prompt 4+)

---

## Comandos útiles

```bash
# Desarrollo (desde /paperclip/)
pnpm dev:server          # Solo el servidor API
pnpm dev                 # Servidor + UI en modo watch

# Verificar que corre
curl http://localhost:3100/api/health

# Onboarding (primera vez)
pnpm paperclipai onboard

# Ver logs de la instancia
cat ~/.paperclip/instances/default/logs/server.log
```

---

## Próximos pasos (Prompt 3)

- Crear tablas nuevas en Supabase:
  - `whatsapp_conversations` — historial de conversaciones
  - `agent_tasks` — tareas creadas por Paperclip
  - `tarifas` — tabla de precios por zona
  - `faqs` — base de conocimiento para Tier 1

---

*Todo el código de esta carpeta es nuevo. No se modifica ningún archivo del sistema existente de 1012Delivery.*
