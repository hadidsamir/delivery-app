-- Crea el bucket de almacenamiento para fotos de mensajeros y sus permisos.
-- Ejecutar en: Supabase Dashboard > SQL Editor

-- Bucket público (las fotos no son sensibles — se necesitan públicas para
-- que WhatsApp/YCloud y la página de rastreo del cliente puedan mostrarlas).
INSERT INTO storage.buckets (id, name, public)
VALUES ('courier-photos', 'courier-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Cualquiera puede VER las fotos (son públicas por diseño)
DROP POLICY IF EXISTS "courier_photos_select_public" ON storage.objects;
CREATE POLICY "courier_photos_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'courier-photos');

-- Solo el admin autenticado (admin-app) puede subir/actualizar/borrar fotos
DROP POLICY IF EXISTS "courier_photos_insert_admin" ON storage.objects;
CREATE POLICY "courier_photos_insert_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'courier-photos');

DROP POLICY IF EXISTS "courier_photos_update_admin" ON storage.objects;
CREATE POLICY "courier_photos_update_admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'courier-photos');

DROP POLICY IF EXISTS "courier_photos_delete_admin" ON storage.objects;
CREATE POLICY "courier_photos_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'courier-photos');
