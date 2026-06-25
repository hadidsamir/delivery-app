-- ============================================================================
-- FIX DE SEGURIDAD: Row Level Security (RLS) para 1012Delivery
-- Ejecutar en: Supabase Dashboard > SQL Editor (proyecto ujuirbwkmwyjgafddcdk)
--
-- Problema encontrado: la anon key (pública, embebida en las 3 apps) podía
-- leer la columna "pin" en texto plano y escribir/borrar directamente en
-- "orders" y "courier_locations" sin pasar por el backend.
--
-- Este script es IDEMPOTENTE: se puede correr varias veces sin error
-- (cada CREATE POLICY va precedido de su DROP POLICY IF EXISTS).
--
-- Arquitectura objetivo:
--   - El backend (Node/Express) usa SERVICE_ROLE_KEY y SIEMPRE bypassa RLS,
--     así que estas políticas NO afectan al backend.
--   - admin-app usa Supabase Auth (login real) -> sus requests llevan el JWT
--     del usuario autenticado (role "authenticated").
--   - courier-native NO usa Supabase Auth (login es vía backend ahora) pero
--     sigue necesitando leer/actualizar algunas filas directo con la anon key
--     (orders, couriers.push_token) para las pantallas en tiempo real.
-- ============================================================================

-- ── 1. Ocultar la columna "pin" de cualquier consulta con anon/authenticated ──
REVOKE SELECT (pin) ON public.couriers FROM anon, authenticated;
-- El backend sigue pudiendo leerla porque usa el service_role key (bypassa RLS y grants).

-- ── 2. Habilitar RLS en las tablas críticas ───────────────────────────────────
ALTER TABLE public.couriers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_locations ENABLE ROW LEVEL SECURITY;

-- Quitar cualquier política previa demasiado permisiva (ajusta los nombres
-- si tienen políticas custom ya creadas con otro nombre)
DROP POLICY IF EXISTS "Enable all for anon" ON public.couriers;
DROP POLICY IF EXISTS "Enable all for anon" ON public.orders;
DROP POLICY IF EXISTS "Enable all for anon" ON public.courier_locations;

-- ── 3. Políticas para "couriers" ──────────────────────────────────────────────
-- Lectura: anon y authenticated pueden leer (necesario para login, mapa admin,
-- AvailableOrdersScreen, etc.) — pero la columna pin ya está bloqueada arriba.
DROP POLICY IF EXISTS "couriers_select_all" ON public.couriers;
CREATE POLICY "couriers_select_all" ON public.couriers
  FOR SELECT TO anon, authenticated
  USING (true);

-- Update: solo el propio mensajero puede actualizar su push_token (anon, ya que
-- courier-native no usa Supabase Auth). Restringido a esa única columna vía trigger
-- sería ideal, pero como mínimo limitamos con USING(true) + columns vía GRANT:
REVOKE UPDATE ON public.couriers FROM anon;
GRANT UPDATE (push_token) ON public.couriers TO anon;
DROP POLICY IF EXISTS "couriers_update_pushtoken" ON public.couriers;
CREATE POLICY "couriers_update_pushtoken" ON public.couriers
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Insert/Delete/Update en couriers: SOLO admin autenticado (admin-app)
DROP POLICY IF EXISTS "couriers_insert_admin" ON public.couriers;
CREATE POLICY "couriers_insert_admin" ON public.couriers
  FOR INSERT TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "couriers_update_admin" ON public.couriers;
CREATE POLICY "couriers_update_admin" ON public.couriers
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "couriers_delete_admin" ON public.couriers;
CREATE POLICY "couriers_delete_admin" ON public.couriers
  FOR DELETE TO authenticated
  USING (true);

-- ── 4. Políticas para "orders" ────────────────────────────────────────────────
-- Lectura: anon y authenticated necesitan leer (courier-native lista pedidos,
-- admin-app dashboard). Los datos sensibles del cliente ya están limitados por
-- lo que el backend expone vía tracking_token aparte.
DROP POLICY IF EXISTS "orders_select_all" ON public.orders;
CREATE POLICY "orders_select_all" ON public.orders
  FOR SELECT TO anon, authenticated
  USING (true);

-- Insert: el cliente público crea pedidos vía backend (service_role, no afectado).
-- courier-native NO debería poder insertar pedidos directamente.
DROP POLICY IF EXISTS "orders_insert_admin" ON public.orders;
CREATE POLICY "orders_insert_admin" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Update: el mensajero solo puede tomar un pedido sin dueño (claim) o soltar
-- el propio (release) — igual que ya valida el backend.
-- NOTA: courier-native usa anon key, no tiene "auth.uid()" propio, así que esta
-- política es permisiva por fila pero sigue bloqueando DELETE y INSERT directo.
DROP POLICY IF EXISTS "orders_update_courier_or_admin" ON public.orders;
CREATE POLICY "orders_update_courier_or_admin" ON public.orders
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);
-- ⚠️ Esta política sigue siendo amplia porque courier-native no tiene sesión
-- propia. La protección real de "quién puede cambiar qué pedido" la sigue
-- haciendo tu backend (/api/order/:id/status, /api/orders/:id/claim).
-- Lo que SÍ logramos: nadie puede ya hacer INSERT/DELETE directo sin login admin,
-- y la tabla ya no acepta absolutamente cualquier operación sin ninguna política.

-- Delete: solo admin
DROP POLICY IF EXISTS "orders_delete_admin" ON public.orders;
CREATE POLICY "orders_delete_admin" ON public.orders
  FOR DELETE TO authenticated
  USING (true);

-- ── 5. Políticas para "courier_locations" ─────────────────────────────────────
DROP POLICY IF EXISTS "locations_select_all" ON public.courier_locations;
CREATE POLICY "locations_select_all" ON public.courier_locations
  FOR SELECT TO anon, authenticated
  USING (true);

-- El backend ya verifica "orderCheck.courier_id !== courier_id" antes de
-- escribir aquí (con service_role, no pasa por estas políticas).
DROP POLICY IF EXISTS "locations_write_admin_only" ON public.courier_locations;
CREATE POLICY "locations_write_admin_only" ON public.courier_locations
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
-- anon NO tiene política de INSERT/UPDATE/DELETE aquí -> queda bloqueado.

-- ── 6. Tablas de chat/soporte — encontradas SIN RLS por el Security Advisor ───
-- Nadie las necesita por fuera del backend (service_role). El admin-app las lee
-- vía /api/support/chats (ya protegido con Supabase Auth), salvo la suscripción
-- en tiempo real de Support.jsx que necesita SELECT para "authenticated".

ALTER TABLE public.chat_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_idle_locations ENABLE ROW LEVEL SECURITY;

-- chat_sessions / chat_messages: solo lectura para el admin autenticado
-- (admin-app se suscribe en vivo vía supabase.channel(...).on('postgres_changes', ...)).
-- Sin política de INSERT/UPDATE/DELETE para nadie excepto el backend (service_role).
DROP POLICY IF EXISTS "chat_sessions_select_admin" ON public.chat_sessions;
CREATE POLICY "chat_sessions_select_admin" ON public.chat_sessions
  FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "chat_messages_select_admin" ON public.chat_messages;
CREATE POLICY "chat_messages_select_admin" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (true);

-- courier_idle_locations: nadie la lee/escribe directo (solo el backend). Sin
-- políticas = acceso denegado por defecto para anon/authenticated.

-- whatsapp_conversations: tabla sin uso confirmado en el código actual. Sin
-- políticas = denegado por defecto. Si algo la necesita, avísame y le agregamos
-- la política correspondiente.

-- whatsapp_notifications: ⚠️ tu workflow de n8n
-- ("notificar-cliente-mensajero-asignado.json", nodo "Registrar Notificación
-- Enviada") actualmente escribe aquí usando la ANON KEY. Al quedar sin
-- políticas, ese paso de n8n empezará a fallar SILENCIOSAMENTE (el nodo ya
-- tiene "neverError": true, así que no rompe el workflow, solo deja de
-- registrar el log). Para corregirlo de raíz: en n8n, cambia el header
-- "apikey"/"Authorization" de ese nodo HTTP Request para usar el
-- SERVICE_ROLE_KEY en vez de SUPABASE_ANON_KEY.

-- ============================================================================
-- IMPORTANTE DESPUÉS DE EJECUTAR ESTO:
-- 1. Verifica que courier-native siga pudiendo funcionar (login, ver pedidos,
--    tomar/soltar pedidos, ver mapa). Si algo se rompe, es porque ese flujo
--    necesita una política adicional — avísame y la ajustamos.
-- 2. Verifica en el Security Advisor de Supabase que los 6 errores CRITICAL
--    ya no aparezcan.
-- 3. Actualiza el nodo de n8n mencionado arriba para usar el service_role key.
-- 4. Rota la anon key y el service_role key desde Settings > API en Supabase
--    (ya estuvieron expuestas durante esta auditoría).
-- 5. Rota TODOS los PINs de couriers (ya estuvieron expuestos en texto plano).
-- ============================================================================
