-- =============================================================================
-- ADR-030: precios de oferta con fechas.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
-- El worker con su rol; devuelve los resultados ordenados.
create function pg_temp.run_worker() returns text language plpgsql as $$
declare v text;
begin
  perform tests.as_role('system_worker');
  select string_agg(r.result, ',' order by r.result) into v from system.apply_price_schedules(100) r;
  perform tests.logout();
  return coalesce(v, '');
end $$;
create function pg_temp.audits(p_action text) returns integer language sql security definer as $$
  select count(*)::int from audit.audit_logs where action = p_action
$$;
-- Hora local de la tienda, desplazada desde ahora.
create function pg_temp.local(p_offset interval) returns text language sql as $$
  select to_char((now() + p_offset) at time zone 'America/Mazatlan', 'YYYY-MM-DD"T"HH24:MI')
$$;
-- Mueve las fechas de una oferta (como superusuario, sin los triggers de inmutabilidad).
create function pg_temp.move(p_sale uuid, p_starts interval, p_ends interval) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  update public.variant_price_schedules set starts_at = now() + p_starts, ends_at = now() + p_ends where id = p_sale;
  set local session_replication_role = origin;
end $$;
create function pg_temp.price(p_sku text) returns text language sql as $$
  select price || '/' || coalesce(compare_at_price::text, '-') from public.product_variants where sku = p_sku
$$;
-- La oferta abierta (programada o activa) de una presentación; con dos, la que empieza después.
create function pg_temp.sale(p_sku text) returns uuid language sql as $$
  select s.id from public.variant_price_schedules s join public.product_variants v on v.id = s.variant_id
   where v.sku = p_sku and s.status in ('scheduled', 'active') order by s.starts_at desc limit 1
$$;
create function pg_temp.sale_state(p_sale uuid) returns text language sql as $$
  select status || ':' || coalesce(end_reason, '-') from public.variant_price_schedules where id = p_sale
$$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('mkt', 'mkt@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'mkt', 'marketing_manager');
update public.stores set timezone = 'America/Mazatlan' where id = tests.fx('store_a');

select tests.login('owner');
select tests.set_fx('p1', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Whey","variants":[{"price":69900,"sku":"SS-1"}]}') ->> 'id')::uuid);
select tests.set_fx('p2', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Creatina","variants":[{"price":49900,"compare_at_price":59900,"sku":"SS-2"}]}') ->> 'id')::uuid);

-- ============================================================================ Validación
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 69900, null, null, null, %L, true)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('1 day'))),
          'validation_failed/sale_price', 'el precio de oferta debe ser menor que el actual');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 100, 10, 'peso', null, %L, false)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('1 day'))),
          'validation_failed/sale_price', 'precio fijo o porcentaje, no los dos');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, null, 95, 'peso', null, %L, false)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('1 day'))),
          'validation_failed/percent', 'descuento de más del 90 %%: rechazado');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 100, null, null, %L, %L, false)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('2 days'), pg_temp.local('1 day'))),
          'validation_failed/ends_at', 'termina antes de empezar: rechazada');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 100, null, null, null, %L, false)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('91 days'))),
          'validation_failed/ends_at', 'más de 90 días: rechazada');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 100, null, null, %L, %L, false)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('-1 hour'), pg_temp.local('1 day'))),
          'validation_failed/starts_at', 'empezar en el pasado: rechazada');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 100, null, null, null, 'mañana', false)$$,
            tests.fx('store_a'), tests.fx('p1'))),
          'validation_failed/ends_at', 'fecha en formato libre: rechazada');

-- ============================================================================ Vista previa
select is((select string_agg((r ->> 'sku') || '=' || (r ->> 'price') || '>' || (r ->> 'sale_price') || ':' || coalesce(r ->> 'issue', 'ok'), ',' order by r ->> 'sku')
             from jsonb_array_elements(public.catalog_schedule_sale(tests.fx('store_a'), array[tests.fx('p1'), tests.fx('p2')], null,
                    null, 10, 'peso', null, pg_temp.local('1 day'), false) -> 'rows') r),
          'SS-1=69900>62900:ok,SS-2=49900>44900:ok', 'vista previa del 10 %% al peso, en bloque');
select is((select count(*)::int from public.variant_price_schedules), 0, 'la vista previa no escribe nada');

-- ============================================================================ Programada a futuro
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 59900, null, null, %L, %L, true)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('1 day'), pg_temp.local('3 days'))),
          'ok', 'programar una oferta de precio fijo');
select is(pg_temp.sale_state(pg_temp.sale('SS-1')) || ' ' || pg_temp.price('SS-1'), 'scheduled:- 69900/-',
          'programada: el precio todavía no cambia');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 50000, null, null, %L, %L, true)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('2 days'), pg_temp.local('5 days'))),
          'validation_failed/overlap', 'una oferta encimada en la misma presentación: rechazada');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 50000, null, null, %L, %L, true)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('3 days'), pg_temp.local('5 days'))),
          'ok', 'la siguiente, justo al terminar la anterior, sí');
select tests.set_fx('s1', (select id from public.variant_price_schedules
                             where variant_id = (select id from public.product_variants where sku = 'SS-1')
                             order by starts_at limit 1));
select tests.set_fx('s1b', pg_temp.sale('SS-1'));

-- ============================================================================ Empieza ya
select is(public.catalog_schedule_sale(tests.fx('store_a'), array[tests.fx('p2')], null, null, 10, 'peso', null,
            pg_temp.local('2 days'), true) ->> 'started', '1', 'sin inicio: empieza en el momento');
select tests.set_fx('s2', pg_temp.sale('SS-2'));
select is(pg_temp.price('SS-2'), '44900/49900', 'precio de oferta y «precio antes» = el precio que tenía');
select lives_ok('set constraints all immediate', 'las validaciones diferidas de las variantes pasan');
select is(pg_temp.audits('product.sale_scheduled'), 3, 'cada programación queda en la auditoría');
select tests.logout();

-- ============================================================================ Worker: empezar y terminar
select pg_temp.move(tests.fx('s1'), '-1 minute', '2 days');
select is(pg_temp.run_worker(), 'started', 'el worker empieza la oferta que ya toca');
select is(pg_temp.price('SS-1'), '59900/69900', 'con el precio de oferta y el anterior tachado');
select is(pg_temp.run_worker(), '', 'una segunda pasada no hace nada');

-- Con una oferta activa, la siguiente se calcula sobre el precio regular.
select tests.login('owner');
select is((select string_agg((r ->> 'price') || '>' || (r ->> 'sale_price') || ':' || coalesce(r ->> 'issue', 'ok'), ',')
             from jsonb_array_elements(public.catalog_schedule_sale(tests.fx('store_a'), array[tests.fx('p1')], null,
                    null, 10, 'peso', pg_temp.local('5 days'), pg_temp.local('6 days'), false) -> 'rows') r),
          '69900>62900:ok', 'el descuento de la siguiente oferta parte del precio regular, no del rebajado');
select is((select string_agg(coalesce(r ->> 'issue', 'ok'), ',')
             from jsonb_array_elements(public.catalog_schedule_sale(tests.fx('store_a'), array[tests.fx('p1')], null,
                    65000, null, null, pg_temp.local('5 days'), pg_temp.local('6 days'), false) -> 'rows') r),
          'ok', 'un precio fijo menor que el regular vale aunque sea mayor que el rebajado');
select tests.set_fx('dup', (public.catalog_duplicate_product(tests.fx('store_a'), tests.fx('p1')) ->> 'id')::uuid);
select is((select price || '/' || coalesce(compare_at_price::text, '-') from public.product_variants
            where product_id = tests.fx('dup')), '69900/-', 'duplicar durante la oferta copia el precio regular');
select tests.logout();

select pg_temp.move(tests.fx('s1'), '-2 days', '-1 minute');
select pg_temp.move(tests.fx('s1b'), '-1 minute', '2 days');
select is(pg_temp.run_worker(), 'expired,started', 'termina una y empieza la siguiente en la misma pasada');
select is(pg_temp.sale_state(tests.fx('s1')), 'ended:expired', 'la primera termina en su fecha');
select is(pg_temp.price('SS-1'), '50000/69900', 'la siguiente toma como «precio antes» el precio regular');
select pg_temp.move(tests.fx('s1b'), '-2 days', '-1 minute');
select is(pg_temp.run_worker() || ' ' || pg_temp.price('SS-1'), 'expired 69900/-',
          'al terminar, el precio y el «precio antes» originales regresan');

-- ============================================================================ Cambio a mano durante la oferta
select tests.login('owner');
select public.catalog_set_variant_prices(tests.fx('store_a'), tests.fx('p2'),
  jsonb_build_array(jsonb_build_object('id', (select id from public.product_variants where sku = 'SS-2'),
                                       'price', 39900, 'compare_at_price', 49900)));
select tests.logout();
select pg_temp.move(tests.fx('s2'), '-2 days', '-1 minute');
select is(pg_temp.run_worker(), 'price_changed', 'si la dueña cambió el precio, el worker no lo toca');
select is(pg_temp.price('SS-2') || ' ' || pg_temp.sale_state(tests.fx('s2')), '39900/49900 ended:price_changed',
          'su precio se queda y la oferta termina con el motivo');
select is(pg_temp.audits('product.sale_ended'), 1, 'y queda en el historial por qué no se regresó');

-- ============================================================================ Cancelar
select tests.login('owner');
select public.catalog_schedule_sale(tests.fx('store_a'), array[tests.fx('p1')], null, 60000, null, null, null,
  pg_temp.local('1 day'), true);
select tests.set_fx('c1', pg_temp.sale('SS-1'));
select is(public.catalog_cancel_sale(tests.fx('store_a'), tests.fx('c1')) ->> 'reason', 'cancelled',
          'cancelar una oferta activa');
select is(pg_temp.price('SS-1') || ' ' || pg_temp.sale_state(tests.fx('c1')), '69900/- cancelled:cancelled',
          'regresa el precio al momento');
select public.catalog_schedule_sale(tests.fx('store_a'), array[tests.fx('p1')], null, 60000, null, null,
  pg_temp.local('1 day'), pg_temp.local('2 days'), true);
select tests.set_fx('c2', pg_temp.sale('SS-1'));
select public.catalog_cancel_sale(tests.fx('store_a'), tests.fx('c2'));
select is(pg_temp.sale_state(tests.fx('c2')) || ' ' || pg_temp.price('SS-1'), 'cancelled:cancelled 69900/-',
          'cancelar una programada no toca el precio');
select is(pg_temp.audits('product.sale_cancelled'), 2, 'cancelar queda en la auditoría');
select is(jsonb_array_length(public.catalog_list_sales(tests.fx('store_a'), tests.fx('p1'), true, 50)), 4,
          'la lista del producto incluye las terminadas');
select is(jsonb_array_length(public.catalog_list_sales(tests.fx('store_a'), null, false, 50)), 0,
          'sin ofertas abiertas en la tienda');
select tests.logout();

-- ============================================================================ La tienda
select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('p1'));
select public.catalog_schedule_sale(tests.fx('store_a'), array[tests.fx('p1')], null, 60000, null, null, null,
  pg_temp.local('10 days'), true);
select tests.logout();
select ok((select (v ->> 'sale_ends_at')::timestamptz = (select ends_at from public.variant_price_schedules
                                                          where id = pg_temp.sale('SS-1'))
             from jsonb_array_elements(storefront.get_product(tests.fx('store_a'),
                    (select slug from public.products where id = tests.fx('p1'))) -> 'variants') v),
          'la ficha pública trae la vigencia de la oferta');

-- ============================================================================ Tienda suspendida
create temp table store_status as select status from public.stores where id = tests.fx('store_a');
update public.stores set status = 'suspended' where id = tests.fx('store_a');
select pg_temp.move(pg_temp.sale('SS-1'), '-2 days', '-1 minute');
select is(pg_temp.run_worker() || ' ' || pg_temp.price('SS-1'), 'expired 69900/-',
          'una oferta activa termina aunque la tienda esté suspendida');
set local session_replication_role = replica;
insert into public.variant_price_schedules (store_id, product_id, variant_id, sale_price, starts_at, ends_at)
values (tests.fx('store_a'), tests.fx('p1'), (select id from public.product_variants where sku = 'SS-1'), 60000,
        now() - interval '1 minute', now() + interval '1 day');
set local session_replication_role = origin;
select is(pg_temp.run_worker() || ' ' || pg_temp.price('SS-1'), ' 69900/-', 'pero no empieza ninguna');
select pg_temp.move(pg_temp.sale('SS-1'), '-2 days', '-1 minute');
select is(pg_temp.run_worker(), 'not_started', 'si su periodo pasa sin empezar, se cierra');
update public.stores set status = (select status from store_status) where id = tests.fx('store_a');

-- ============================================================================ Permisos y aislamiento
select tests.login('mkt');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 100, null, null, null, %L, false)$$,
            tests.fx('store_a'), tests.fx('p1'), pg_temp.local('1 day'))),
          'forbidden', 'sin products.update no se programan ofertas');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format($$select public.catalog_schedule_sale(%L, array[%L]::uuid[], null, 100, null, null, null, %L, true)$$,
            tests.fx('store_b'), tests.fx('p1'), pg_temp.local('1 day'))),
          'not_found/product', 'otra tienda no programa ofertas de esta');
select is(pg_temp.err(format($$select public.catalog_cancel_sale(%L, %L)$$, tests.fx('store_b'), tests.fx('s1'))),
          'not_found/sale', 'ni cancela las suyas');
select is(jsonb_array_length(public.catalog_list_sales(tests.fx('store_b'), null, true, 50)), 0, 'ni las ve');
select is((select count(*)::int from public.variant_price_schedules), 0, 'RLS: la tabla no muestra ofertas de otra tienda');
select tests.logout();

select * from finish();
rollback;
