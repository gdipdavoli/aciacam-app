-- Migration: 20261110000000_add_fecha_nacimiento_to_socios.sql
-- Sprint: UX-03B.2
-- Purpose: Add canonical fecha_nacimiento (DATE) column to public.socios

ALTER TABLE public.socios
ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;

