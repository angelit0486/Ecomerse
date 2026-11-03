-- =============================================================================
-- Misión de mejoras 2026-11, regla 6: todo cambio que altere lo que ve el
-- comprador va detrás de un interruptor por tienda, APAGADO por defecto. Usa el
-- sistema de flags existente (GATE0 §27, D-F2-19); solo agrega el flag.
--
-- Reversa: `update public.feature_flags set kill_switch = true where key = …`
-- apaga el cambio en todas las tiendas al instante (sin desplegar). Borrar el
-- flag no hace falta: apagado, el código vuelve al comportamiento anterior.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner) values
  ('storefront_nav_scroll_fix',
   'Barra de categorías en el celular: sin palabras cortadas a la izquierda (lote 2)', false, 'plataforma')
on conflict (key) do nothing;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261103000100'::text
$$;
