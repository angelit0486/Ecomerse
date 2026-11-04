-- =============================================================================
-- Checkout: mensajes de envío claros (docs/plan/DIAGNOSTICO-ENVIO.md). Solo
-- agrega el interruptor, apagado por defecto: no cambia el cálculo del carrito,
-- los totales, place_order ni los pagos.
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'checkout_shipping_messages'` vuelve al mensaje anterior en todas las tiendas.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner) values
  ('checkout_shipping_messages',
   'Checkout: sin envío para la dirección, decir qué falta; con una sola forma de envío, marcarla sola', false,
   'plataforma')
on conflict (key) do nothing;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261104000100'::text
$$;
