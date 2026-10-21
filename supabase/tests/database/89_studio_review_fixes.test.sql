-- =============================================================================
-- Correcciones de la revisión de los Pasos 2 y 3 (migración 20261021000600).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
insert into public.platform_settings (key, value) values ('storefront.root_domain', '{"domain":"pruva.test"}')
on conflict (key) do update set value = excluded.value;

create function tests.domain(p_host text) returns public.store_domains language sql security definer
set search_path = '' as $$ select * from public.store_domains where hostname = p_host $$;
create function tests.queued_checks(p_host text) returns integer language sql security definer set search_path = '' as $$
  select count(*)::int from system.jobs j join public.store_domains d on j.payload ->> 'domain_id' = d.id::text
   where d.hostname = p_host and j.type = 'domains.verify' and j.status = 'queued' $$;
create function tests.expire(p_host text) returns void language sql security definer set search_path = '' as $$
  update public.store_domains set status = 'failed' where hostname = p_host $$;
create function tests.sample_products(p_store text) returns integer language sql security definer set search_path = '' as $$
  select count(*)::int from public.products where store_id = tests.fx('store_' || p_store) and deleted_at is null $$;
create function tests.draft_header(p_store text) returns jsonb language sql security definer set search_path = '' as $$
  select draft_settings -> 'header' from public.store_themes where store_id = tests.fx('store_' || p_store) $$;
create function tests.launch_codes(p_store text) returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(i ->> 'code'), '{}')
    from jsonb_array_elements(app.validate_store_for_launch(tests.fx('store_' || p_store))) i $$;
grant execute on all functions in schema tests to authenticated;

-- R-2: una sola revisión en cola por dominio.
select tests.login('owner');
select public.domains_add_custom(tests.fx('store_a'), 'www.uno.mx');
select public.domains_request_check(tests.fx('store_a'), (tests.domain('www.uno.mx')).id);
select public.domains_request_check(tests.fx('store_a'), (tests.domain('www.uno.mx')).id);
select is(tests.queued_checks('www.uno.mx'), 1, 'varios «Verificar ahora» dejan una sola revisión en cola');

-- R-3: verificar un dominio vencido reinicia la verificación.
select tests.expire('www.uno.mx');
select public.domains_request_check(tests.fx('store_a'), (tests.domain('www.uno.mx')).id);
select is((tests.domain('www.uno.mx')).status, 'pending', 'un dominio vencido vuelve a verificarse');

-- R-1: un dominio quitado o vencido en otra tienda se libera; uno pendiente, no.
select public.domains_remove(tests.fx('store_a'), (tests.domain('www.uno.mx')).id);
select public.domains_add_custom(tests.fx('store_a'), 'www.dos.mx');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format('select public.domains_add_custom(%L, %L)', tests.fx('store_b'), 'www.uno.mx')), 'ok',
          'B puede usar un dominio que A quitó');
select is((tests.domain('www.uno.mx')).store_id, tests.fx('store_b'), 'y queda en la tienda de B');
select is(pg_temp.err(format('select public.domains_add_custom(%L, %L)', tests.fx('store_b'), 'www.dos.mx')),
          'validation_failed/taken', 'uno pendiente de A sigue apartado');
select tests.logout();

-- R-4: el worker sabe si el TXT coincide antes de ir al proveedor.
create function pg_temp.matches(p_host text, p_txt text[]) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('role', 'system_worker', true);
  v := system.domains_txt_matches((tests.domain(p_host)).id, p_txt);
  perform set_config('role', 'none', true);
  return v;
end $$;
select is(pg_temp.matches('www.dos.mx', array['pruva-otro']), false, 'un TXT ajeno no prueba la propiedad');

-- R-6: sin dominio raíz configurado no se aceptan dominios.
delete from public.platform_settings where key = 'storefront.root_domain';
select tests.login('owner');
select is(pg_temp.err(format('select public.domains_add_custom(%L, %L)', tests.fx('store_a'), 'www.tres.mx')),
          'internal/platform_settings.storefront.root_domain', 'sin dominio raíz, no se agregan dominios');

-- R-8: la etiqueta «ejemplo» sola no hace de un producto un ejemplo.
select public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Gorra real","tags":["ejemplo"],"variants":[{"price":10000}]}');
select is(public.store_remove_sample_products(tests.fx('store_a')), 0, 'un producto propio con la etiqueta no se borra');
select is(tests.sample_products('a'), 1, 'sigue en el catálogo');
select ok(not ('sample_products' = any (tests.launch_codes('a'))), 'ni bloquea el lanzamiento');

-- R-9: importar un diseño conserva el anuncio del encabezado.
select public.appearance_save_theme_draft(tests.fx('store_a'),
  '{"header":{"logo_position":"left","announcement":{"text":"Envío gratis","background":"#000000","foreground":"#ffffff"}}}',
  tests.theme_rev(tests.fx('store_a')));
select public.appearance_import_design(tests.fx('store_a'), '{"header":{"logo_position":"center"}}', '[]',
                                       tests.theme_rev(tests.fx('store_a')), 'file');
select is(tests.draft_header('a'),
          '{"logo_position":"center","announcement":{"text":"Envío gratis","background":"#000000","foreground":"#ffffff"}}'::jsonb,
          'importar cambia la posición del logo y conserva el anuncio');
select tests.logout();

select * from finish();
rollback;
