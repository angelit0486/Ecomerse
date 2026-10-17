-- =============================================================================
-- Panel de productos, tanda 7: publicación programada.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
-- El worker con su rol; devuelve «producto:publicado:motivos».
create function pg_temp.run_worker() returns text language plpgsql as $$
declare v text;
begin
  perform tests.as_role('system_worker');
  select string_agg(r.product_id::text || ':' || r.published || ':' || coalesce(r.codes, ''), ';' order by r.product_id)
    into v from system.publish_scheduled_products(100) r;
  perform tests.logout();
  return coalesce(v, '');
end $$;
create function pg_temp.audits(p_action text) returns integer language sql security definer as $$
  select count(*)::int from audit.audit_logs where action = p_action
$$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
update public.stores set timezone = 'America/Mazatlan' where id = tests.fx('store_a');

select tests.login('owner');
select tests.set_fx('ok', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Whey","variants":[{"price":69900,"sku":"SP-1"}]}') ->> 'id')::uuid);
select tests.set_fx('zero', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Sin precio","variants":[{"price":0,"sku":"SP-2"}]}') ->> 'id')::uuid);

-- ============================================================================ Programar
select is(pg_temp.err(format($$select public.catalog_schedule_publish(%L, %L, %L)$$, tests.fx('store_a'), tests.fx('ok'),
            to_char((now() + interval '2 days') at time zone 'America/Mazatlan', 'YYYY-MM-DD"T"HH24:MI'))),
          'ok', 'programar un borrador');
select ok((select abs(extract(epoch from publish_at - (now() + interval '2 days'))) < 60 from public.products where id = tests.fx('ok')),
          'la hora local se interpreta en la zona de la tienda');
select is(pg_temp.err(format($$select public.catalog_schedule_publish(%L, %L, %L)$$, tests.fx('store_a'), tests.fx('ok'),
            to_char((now() - interval '1 hour') at time zone 'America/Mazatlan', 'YYYY-MM-DD"T"HH24:MI'))),
          'validation_failed/publish_at', 'en el pasado: rechazada');
select is(pg_temp.err(format($$select public.catalog_schedule_publish(%L, %L, '2026-13-45T99:99')$$,
            tests.fx('store_a'), tests.fx('ok'))), 'validation_failed/publish_at', 'fecha imposible: rechazada');
select is(pg_temp.err(format($$select public.catalog_schedule_publish(%L, %L, 'mañana')$$,
            tests.fx('store_a'), tests.fx('ok'))), 'validation_failed/publish_at', 'formato libre: rechazado');
select is(pg_temp.audits('product.publish_scheduled'), 1, 'programar queda auditado');
select public.catalog_schedule_publish(tests.fx('store_a'), tests.fx('zero'), null);
select is(pg_temp.audits('product.publish_unscheduled'), 0, 'quitar sin horario no deja ruido en la auditoría');
select tests.logout();

-- Vencido (se adelanta el reloj moviendo la fecha, como superusuario).
update public.products set publish_at = now() - interval '1 minute' where id in (tests.fx('ok'), tests.fx('zero'));

-- ============================================================================ Worker
select is(pg_temp.run_worker(),
          (select string_agg(x, ';' order by x) from unnest(array[
             tests.fx('ok')::text || ':true:', tests.fx('zero')::text || ':false:price_zero']) x),
          'publica el que pasa la validación; el otro, no, con su motivo');
select is((select status || ':' || coalesce(publish_at::text, '-') from public.products where id = tests.fx('ok')),
          'active:-', 'publicado y sin horario');
select is((select status || ':' || coalesce(publish_at::text, '-') from public.products where id = tests.fx('zero')),
          'draft:-', 'el que no pasa sigue en borrador y pierde el horario');
select is(pg_temp.audits('product.publish_failed'), 1, 'el fallo queda en la auditoría');
select is(pg_temp.run_worker(), '', 'una segunda pasada no hace nada');

-- ============================================================================ Un horario viejo nunca publica por sorpresa
select tests.login('owner');
select is(pg_temp.err(format($$select public.catalog_schedule_publish(%L, %L, %L)$$, tests.fx('store_a'), tests.fx('ok'),
            to_char((now() + interval '2 days') at time zone 'America/Mazatlan', 'YYYY-MM-DD"T"HH24:MI'))),
          'validation_failed/status', 'un producto publicado no se programa');
select public.catalog_schedule_publish(tests.fx('store_a'), tests.fx('zero'),
  to_char((now() + interval '2 days') at time zone 'America/Mazatlan', 'YYYY-MM-DD"T"HH24:MI'));
select public.catalog_set_product_status(tests.fx('store_a'), tests.fx('zero'), 'archived');
select is((select publish_at from public.products where id = tests.fx('zero')), null,
          'archivar borra el horario');
select tests.logout();

select tests.login('owner_b');
select is(pg_temp.err(format($$select public.catalog_schedule_publish(%L, %L, null)$$, tests.fx('store_b'), tests.fx('ok'))),
          'not_found/product', 'otra tienda no programa productos de esta');
select tests.logout();

-- Organización suspendida: el worker no publica nada.
select tests.login('owner');
select tests.set_fx('later', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Pre","variants":[{"price":100,"sku":"SP-3"}]}') ->> 'id')::uuid);
select tests.logout();
update public.products set publish_at = now() - interval '1 minute' where id = tests.fx('later');
update public.stores set status = 'suspended' where id = tests.fx('store_a');
select is(pg_temp.run_worker(), '', 'una tienda suspendida no publica');
select is((select publish_at is not null from public.products where id = tests.fx('later')), true,
          'y conserva el horario durante un día');
update public.products set publish_at = now() - interval '2 days' where id = tests.fx('later');
select is(pg_temp.run_worker(), tests.fx('later')::text || ':false:schedule_expired',
          'pasado un día, el horario se cancela');
select is((select publish_at from public.products where id = tests.fx('later')), null,
          'al reactivar la tienda ya no se publica por sorpresa');

select * from finish();
rollback;
