# Delivery Tracking App
## Qué hace esta app
Sistema de rastreo de domicilios en tiempo real. Los mensajeros comparten
su ubicación GPS y los clientes la ven en un mapa, junto con los datos
del mensajero y el detalle de su pedido.
## Estructura del proyecto
- /backend → Servidor Node.js + Express + Socket.io
- /client-app → App React para el cliente (ve el mapa)
- /courier-app → App React para el mensajero (envía GPS)
## Stack tecnológico
- Backend: Node.js, Express, Socket.io, @supabase/supabase-js
- Frontend: React + Vite, Tailwind CSS, @react-google-maps/api, socket.io-client
- Base de datos: Supabase (PostgreSQL + Realtime)
- Mapas: Google Maps JavaScript API
## Tablas en Supabase
### couriers
- id (UUID, PK)
- name (TEXT)
- phone (TEXT)
- photo_url (TEXT)
- is_active (BOOLEAN)
- created_at (TIMESTAMP)
### orders
- id (UUID, PK)
- courier_id (UUID, FK → couriers.id)
- client_name (TEXT)
- client_phone (TEXT)
- delivery_address (TEXT)
- status (TEXT: 'pendiente' | 'en_camino' | 'entregado')
- items (JSONB) → [{name, qty, description}]
- tracking_token (TEXT, UNIQUE)
- delivery_order (INTEGER) → posición si hay múltiples domicilios
- created_at (TIMESTAMP)
### courier_locations
- id (UUID, PK)
- courier_id (UUID, FK → couriers.id)
- order_id (UUID, FK → orders.id)
- latitude (FLOAT8)
- longitude (FLOAT8)
- updated_at (TIMESTAMP)
## Reglas de negocio importantes
1. El mensajero envía su GPS cada 3 segundos vía POST /api/location
2. El servidor guarda en courier_locations y emite evento 'location:update' via Socket.io
3. Cada pedido tiene su propio WebSocket room: 'order_' + order_id
4. El cliente accede con un link único: /track/:tracking_token (sin login)
5. Si el mensajero lleva 1 pedido → mostrar detalle simple
6. Si lleva 2+ pedidos → mostrar "Tu pedido es entrega #X de N"
7. El tracking_token expira 2 horas después de status='entregado'
## Variables de entorno necesarias (backend)
Ver `backend/.env` (no commiteado). Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
PORT, CORS_ORIGIN, ADMIN_SECRET, WEBHOOK_SECRET, YCLOUD_API_KEY.
## Variables de entorno necesarias (frontend)
Ver `client-app/.env` y `admin-app/.env` (no commiteados). Requiere: VITE_SUPABASE_URL,
VITE_SUPABASE_ANON_KEY, VITE_GOOGLE_MAPS_KEY, VITE_BACKEND_URL.

⚠️ Nunca pegar valores reales de claves/tokens en este archivo — está commiteado al
repositorio de git y es visible para cualquiera con acceso al repo.
