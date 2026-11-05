-- =============================================================================
-- Auditoría global 2026-11-05, paso 22: ayuda dentro del panel (guías cortas
-- con los nombres reales de botones y campos). Solo agrega el interruptor,
-- apagado por defecto y que la tienda enciende en Ajustes → Funciones.
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'panel_help'` oculta la ayuda en todas las tiendas.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner, store_toggle) values
  ('panel_help', 'Panel: «Ayuda» con guías paso a paso de las tareas de todos los días', false,
   'plataforma', true)
on conflict (key) do nothing;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000400'::text
$$;
