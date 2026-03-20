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
SUPABASE_URL= sb_publishable_Q6pJi0PbSYMSnGVwn4GnIg_6vQAfuPB
SUPABASE_ANON_KEY= eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqdWlyYndrbXd5amdhZmRkY2RrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjMzOTgsImV4cCI6MjA4OTUzOTM5OH0.Af8FPnMIXMM6PHKQlcnzVz1pKWX-OcBOuANtMyKsoBA
PORT=3001
CORS_ORIGIN=http://localhost:5173
## Variables de entorno necesarias (frontend)
VITE_SUPABASE_URL= sb_publishable_Q6pJi0PbSYMSnGVwn4GnIg_6vQAfuPB
VITE_SUPABASE_ANON_KEY= eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqdWlyYndrbXd5amdhZmRkY2RrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjMzOTgsImV4cCI6MjA4OTUzOTM5OH0.Af8FPnMIXMM6PHKQlcnzVz1pKWX-OcBOuANtMyKsoBA
VITE_GOOGLE_MAPS_KEY= AIzaSyAriubtJ4QMKvAMCdS5ajb6JWEYe7jnOsk
VITE_BACKEND_URL=http://localhost:3001
