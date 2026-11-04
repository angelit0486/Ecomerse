-- =============================================================================
-- Celular: campos de texto de al menos 16 px para que el iPhone no haga zoom al
-- escribir (docs/plan/PRIMER-PEDIDO.md). Solo agrega el interruptor, apagado
-- por defecto: la tienda y el panel lo leen y ponen una clase; no cambia datos,
-- precios, pedidos ni pagos.
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'mobile_input_size'` vuelve al tamaño anterior en todas las tiendas.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner) values
  ('mobile_input_size',
   'Celular: campos de texto de 16 px en la tienda y el panel (sin zoom al escribir en iPhone)', false,
   'plataforma')
on conflict (key) do nothing;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261104000200'::text
$$;
