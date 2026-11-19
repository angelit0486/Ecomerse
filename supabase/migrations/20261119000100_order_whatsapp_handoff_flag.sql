-- =============================================================================
-- Ficha del pedido por WhatsApp (2026-11-19): al confirmar un pedido, la página
-- del pedido abre WhatsApp con la ficha completa ya escrita (número, productos,
-- totales, entrega y contacto) para que el comprador la mande a la tienda con un
-- toque. Solo agrega el interruptor por tienda, apagado por defecto: la página
-- del pedido lo lee; no cambia datos, precios, pedidos ni pagos.
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'order_whatsapp_handoff'` lo apaga en todas las tiendas.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner) values
  ('order_whatsapp_handoff',
   'Tienda: al confirmar un pedido, abrir WhatsApp con la ficha del pedido para mandarla a la tienda', false,
   'plataforma')
on conflict (key) do nothing;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261119000100'::text
$$;
