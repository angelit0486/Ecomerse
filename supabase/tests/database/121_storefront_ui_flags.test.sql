-- =============================================================================
-- Interruptores de la misión de mejoras: existen, nacen apagados y encenderlos
-- en una tienda no los enciende en otra.
-- =============================================================================
begin;
select plan(7);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.gateway_flag(p_store uuid, p_key text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform tests.as_role('storefront_gateway');
  select f.enabled into v from storefront.get_store_flags(p_store) f where f.key = p_key;
  perform tests.logout();
  return v;
end $$;

select is((select default_enabled from public.feature_flags where key = 'storefront_nav_scroll_fix'), false,
          'el interruptor de la barra nace apagado');
select is(pg_temp.gateway_flag(tests.fx('store_a'), 'storefront_nav_scroll_fix'), false,
          'la tienda lo lee apagado');

insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('storefront_nav_scroll_fix', 'store', tests.fx('store_a'), true, 'Tienda de pruebas del lote 2');

select is(pg_temp.gateway_flag(tests.fx('store_a'), 'storefront_nav_scroll_fix'), true,
          'encendido para la tienda A');
select is(pg_temp.gateway_flag(tests.fx('store_b'), 'storefront_nav_scroll_fix'), false,
          'y sigue apagado para la tienda B (aislamiento)');

update public.feature_flags set kill_switch = true where key = 'storefront_nav_scroll_fix';
select is(pg_temp.gateway_flag(tests.fx('store_a'), 'storefront_nav_scroll_fix'), false,
          'la reversa (kill switch) lo apaga también donde estaba encendido');

-- Checkout: mensajes de envío claros (docs/plan/DIAGNOSTICO-ENVIO.md).
select is((select default_enabled from public.feature_flags where key = 'checkout_shipping_messages'), false,
          'el interruptor de los mensajes de envío nace apagado');
insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
values ('checkout_shipping_messages', 'store', tests.fx('store_a'), true, 'Tienda de pruebas del checkout');
select ok(pg_temp.gateway_flag(tests.fx('store_a'), 'checkout_shipping_messages')
          and not pg_temp.gateway_flag(tests.fx('store_b'), 'checkout_shipping_messages'),
          'encendido en A, apagado en B (aislamiento)');

select * from finish();
rollback;
