-- =============================================================================
-- Auditoría global 2026-11-05, paso 21: notas de empaque imprimibles en el
-- panel (una por pedido y en lote desde «Por surtir»). Solo agrega el
-- interruptor, apagado por defecto y que la tienda enciende en Ajustes →
-- Funciones (store_toggle). Las pantallas leen el pedido con los mismos
-- permisos que el detalle (orders.read y, para la dirección, customers.pii.read).
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'order_printing'` oculta la impresión en todas las tiendas.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner, store_toggle) values
  ('order_printing',
   'Panel: imprimir notas de empaque por pedido y en lote desde «Por surtir»', false,
   'plataforma', true)
on conflict (key) do nothing;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000200'::text
$$;
