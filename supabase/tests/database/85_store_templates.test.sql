-- =============================================================================
-- ADR-034 §5 · Plantillas por giro: se aplican en una transacción con las mismas
-- reglas de siempre, los productos de ejemplo quedan en borrador y marcados,
-- bloquean el lanzamiento hasta quitarlos, y nadie aplica plantillas en otra
-- tienda ni en una tienda ya publicada.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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
select tests.create_user('cat', 'cat@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'cat', 'catalog_manager');
select tests.create_user('owner_c', 'owner@c.io');
select tests.create_tenant('c', 'owner_c');

create function pg_temp.template(p_desc text default 'Polvo sabor vainilla para preparar con agua o leche.')
returns jsonb language sql as $$
  select jsonb_build_object(
    'key', 'suplementos',
    'settings', jsonb_build_object('colors', jsonb_build_object('primary', '#0b2d5b', 'background', '#ffffff',
                                                                'foreground', '#172638')),
    'home_sections', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000001', 'type', 'hero', 'enabled', true,
      'props', jsonb_build_object('heading', 'Tu tienda de suplementos', 'align', 'center'))),
    'categories', jsonb_build_array(jsonb_build_object('name', 'Proteínas', 'slug', 'proteinas')),
    'products', jsonb_build_array(
      jsonb_build_object('title', 'Proteína de suero 1 kg', 'category', 'proteinas', 'description', p_desc,
                         'options', jsonb_build_array(jsonb_build_object('name', 'Sabor',
                                                       'values', jsonb_build_array('Vainilla', 'Chocolate'))),
                         'variants', jsonb_build_array(
                           jsonb_build_object('options', jsonb_build_object('Sabor', 'Vainilla'), 'price', 89900),
                           jsonb_build_object('options', jsonb_build_object('Sabor', 'Chocolate'), 'price', 89900,
                                              'compare_at_price', 99900))),
      jsonb_build_object('title', 'Creatina 300 g', 'category', 'proteinas',
                         'variants', jsonb_build_array(jsonb_build_object('price', 49900)))))
$$;
create function tests.samples(p_store text) returns table (title text, status text, tracked boolean, sku text,
                                                            category text)
language sql security definer set search_path = '' as $$
  select p.title, p.status, bool_or(v.track_inventory), max(v.sku),
         (select c.slug from public.product_categories pc join public.categories c on c.id = pc.category_id
           where pc.product_id = p.id and pc.is_primary)
    from public.products p join public.product_variants v on v.product_id = p.id and v.deleted_at is null
   where p.store_id = tests.fx('store_' || p_store) and p.deleted_at is null and 'ejemplo' = any (p.tags)
   group by p.id order by p.title $$;
create function tests.issue_codes(p_store text) returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(i ->> 'code' order by i ->> 'code'), '{}')
    from jsonb_array_elements(app.validate_store_for_launch(tests.fx('store_' || p_store))) i $$;
create function tests.template_audits() returns integer language sql security definer set search_path = '' as $$
  select count(*)::int from audit.audit_logs where action = 'store.template_applied' and store_id = tests.fx('store_a') $$;
create function tests.draft_primary(p_store text) returns text language sql security definer set search_path = '' as $$
  select draft_settings #>> '{colors,primary}' from public.store_themes where store_id = tests.fx('store_' || p_store) $$;
grant execute on all functions in schema tests to authenticated;

-- 1. Aplicar: estilo, portada, categorías y productos de ejemplo.
select tests.login('owner');
select is(pg_temp.err(format('select public.store_apply_template(%L, %L, %s)', tests.fx('store_a'),
            pg_temp.template(), tests.theme_rev(tests.fx('store_a')))), 'ok', 'la dueña aplica la plantilla');
select is(tests.draft_primary('a'), '#0b2d5b', 'el estilo queda en el borrador');
select is((select count(*)::int from tests.samples('a')), 2, 'se crean los dos productos de ejemplo');
select is((select array_agg(status) from tests.samples('a')), array['draft', 'draft'],
          'en borrador: solo se ven en la vista previa');
select is((select array_agg(title) from tests.samples('a')),
          array['Ejemplo · Creatina 300 g', 'Ejemplo · Proteína de suero 1 kg'], 'con «Ejemplo · » en el título');
select is((select bool_or(tracked) or bool_or(sku is not null) from tests.samples('a')), false,
          'sin inventario ni SKU');
select is((select array_agg(category) from tests.samples('a')), array['proteinas', 'proteinas'],
          'en su categoría');
select is(tests.template_audits(), 1, 'queda en la auditoría');

-- 2. Reaplicar no duplica; con una revisión vieja, conflicto.
select is((public.store_apply_template(tests.fx('store_a'), pg_temp.template(),
            tests.theme_rev(tests.fx('store_a'))) ->> 'skipped')::int, 2, 'reaplicar omite lo que ya existe');
select is((select count(*)::int from tests.samples('a')), 2, 'y no duplica productos');
select is(pg_temp.err(format('select public.store_apply_template(%L, %L, %s)', tests.fx('store_a'),
            pg_temp.template(), tests.theme_rev(tests.fx('store_a')) - 1)), 'conflict/draft_revision',
          'con una revisión vieja no pisa el borrador');
select is(pg_temp.err(format('select public.store_apply_template(%L, %L, %s)', tests.fx('store_a'),
            pg_temp.template('<script>x</script>'), tests.theme_rev(tests.fx('store_a')))),
          'validation_failed/template', 'una descripción con HTML se rechaza');

-- 3. Bloquean el lanzamiento hasta quitarlos.
select ok('sample_products' = any (tests.issue_codes('a')), 'con ejemplos, la tienda no se publica');
select is(public.store_remove_sample_products(tests.fx('store_a')), 2, 'se quitan los ejemplos');
select ok(not ('sample_products' = any (tests.issue_codes('a'))), 'y deja de bloquear');
select tests.logout();

-- 4. Permisos y aislamiento.
select tests.login('cat');
select is(pg_temp.err(format('select public.store_apply_template(%L, %L, 0)', tests.fx('store_a'),
            pg_temp.template())), 'forbidden', 'Catálogo no aplica plantillas (no edita el diseño)');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format('select public.store_apply_template(%L, %L, 0)', tests.fx('store_a'),
            pg_temp.template())), 'forbidden', 'B no aplica plantillas en la tienda de A');
select is(pg_temp.err(format('select public.store_remove_sample_products(%L)', tests.fx('store_a'))),
          'forbidden', 'ni quita productos de A');
select tests.logout();

-- 5. Una tienda ya publicada no recibe datos de ejemplo.
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_b');
select tests.login('owner_b');
select is(pg_temp.err(format('select public.store_apply_template(%L, %L, %s)', tests.fx('store_b'),
            pg_temp.template(), tests.theme_rev(tests.fx('store_b')))), 'validation_failed/launched',
          'la tienda publicada no admite plantilla');
select tests.logout();

-- 6. «En blanco» (Pulido, Paso 3): sin portada, categorías ni productos, y sin
--    declarar categorías reguladas (perfil general).
create function tests.store_counts(p_store text) returns int[] language sql security definer set search_path = '' as $$
  select array[
    (select count(*)::int from public.products where store_id = tests.fx('store_' || p_store)),
    (select count(*)::int from public.categories where store_id = tests.fx('store_' || p_store)),
    (select count(*)::int from public.store_regulated_categories where store_id = tests.fx('store_' || p_store)),
    (select jsonb_array_length(draft_home_sections)::int from public.store_themes
      where store_id = tests.fx('store_' || p_store))] $$;
grant execute on function tests.store_counts(text) to authenticated;
select tests.login('owner_c');
select is(pg_temp.err(format('select public.store_apply_template(%L, %L, %s)', tests.fx('store_c'),
            jsonb_build_object('key', 'blanco',
              'settings', jsonb_build_object('colors', jsonb_build_object('primary', '#101828',
                'background', '#ffffff', 'foreground', '#101828')),
              'home_sections', '[]'::jsonb, 'categories', '[]'::jsonb, 'products', '[]'::jsonb),
            tests.theme_rev(tests.fx('store_c')))), 'ok', 'la plantilla en blanco se aplica');
select is(tests.store_counts('c'), array[0, 0, 0, 0],
          'sin productos, categorías, categorías reguladas ni bloques de portada');
select is(tests.draft_primary('c'), '#101828', 'con los colores neutros en el borrador');
select ok(not ('sample_products' = any (tests.issue_codes('c'))), 'sin ejemplos que bloqueen el lanzamiento');
select is((tests.store_counts('a'))[3], 0, 'ni la plantilla de suplementos declara por sí sola la categoría regulada');
select tests.logout();

select * from finish();
rollback;
