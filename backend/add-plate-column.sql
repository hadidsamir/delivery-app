-- Agrega el campo "placa" (número de placa de la moto) a los mensajeros.
-- Ejecutar en: Supabase Dashboard > SQL Editor

ALTER TABLE public.couriers ADD COLUMN IF NOT EXISTS plate TEXT;
