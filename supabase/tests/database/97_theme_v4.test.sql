-- =============================================================================
-- Tema v4 (misión Panel, Pasos B, C y D): colores por elemento y por bloque
-- (siempre legibles), color de oferta, barra de categorías y «Nuestras marcas»
-- con marcas sin logo. La base es la autoridad del contraste: guardar y
-- publicar se rechazan si un texto no se lee.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

create function pg_temp.gw() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'storefront_gateway', true);
  v := storefront.get_home(tests.fx('store_a'));
  perform set_config('role', 'none', true);
  return v;
end $$;
create function pg_temp.save_theme(p_patch jsonb) returns text language plpgsql as $$
declare v_detail text; v_hint text;
begin
  perform public.appearance_save_theme_draft(tests.fx('store_a'), p_patch, tests.theme_rev(tests.fx('store_a')));
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return sqlerrm || '/' || coalesce(v_detail, '') || coalesce(':' || nullif(v_hint, ''), '');
end $$;
create function pg_temp.save_home(p_sections jsonb) returns text language plpgsql as $$
begin
  perform public.appearance_save_home_draft(tests.fx('store_a'), p_sections, tests.theme_rev(tests.fx('store_a')));
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.hero(p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'type', 'hero',
           'enabled', true, 'props', '{"heading":"Hola","align":"left"}'::jsonb) || p_extra)
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('owner');

-- 1. Barra de categorías.
select is(pg_temp.save_theme('{"header":{"nav_bar":{"items":[{"label":"Todos","link":"/productos"},{"label":"Energía","link":"/categoria/energia","visibility":"mobile"}],"style":"pills","sticky":true,"align":"center","size":"md","visibility":"all"}}}'),
          'ok', 'la barra de categorías se guarda');
select ok(pg_temp.save_theme('{"header":{"nav_bar":{"items":[{"label":"x","link":"javascript:alert(1)"}]}}}') like 'validation_failed%',
          'un enlace javascript: se rechaza');
select ok(pg_temp.save_theme('{"header":{"nav_bar":{"style":"tabs"}}}') like 'validation_failed%',
          'un estilo desconocido se rechaza');

-- 2. Colores por elemento y de oferta: válidos y legibles.
select is(pg_temp.save_theme('{"colors":{"sale":"#b91c1c"},"element_colors":{"header":{"background":"#111827","foreground":"#ffffff"},"nav_bar":{"background":"#ffffff","foreground":"#111827","active":"#1d4ed8","border":"#e5e7eb"}}}'),
          'ok', 'colores propios legibles se guardan');
select is(pg_temp.save_theme('{"element_colors":{"footer":{"background":"#111827","foreground":"#374151"}}}'),
          'validation_failed/contrast:element_colors.footer', 'un pie ilegible se rechaza con su elemento');
select is(pg_temp.save_theme('{"element_colors":{"nav_bar":{"background":"#ffffff","foreground":"#111827","active":"#93c5fd"}}}'),
          'validation_failed/contrast:element_colors.nav_bar.active', 'un activo ilegible se rechaza');
select is(pg_temp.save_theme('{"colors":{"sale":"#f87171"}}'),
          'validation_failed/contrast:sale', 'un color de oferta ilegible se rechaza');
select ok(pg_temp.save_theme('{"element_colors":{"sidebar":{"background":"#ffffff","foreground":"#111827"}}}') like 'validation_failed%',
          'un elemento desconocido se rechaza');

-- 3. Colores y espacio por bloque.
select is(pg_temp.save_home(pg_temp.hero('{"colors":{"background":"#111827","foreground":"#ffffff"},"spacing":"spacious"}')),
          'ok', 'un bloque con colores legibles y espacio amplio se guarda');
select is(pg_temp.save_home(pg_temp.hero('{"colors":{"background":"#ffffff","foreground":"#eeeeee"}}')),
          'validation_failed', 'un bloque con texto ilegible se rechaza');
select is(pg_temp.save_home(pg_temp.hero('{"spacing":"huge"}')), 'validation_failed', 'espacio desconocido se rechaza');

-- 4. «Nuestras marcas» incluye las marcas sin logo.
select tests.set_fx('b1', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Muha Meds"}'));
select tests.set_fx('b2', public.catalog_upsert_brand(tests.fx('store_a'), '{"name":"Ace Ultra"}'));
select is(pg_temp.save_home(pg_temp.hero('{"colors":{"background":"#111827","foreground":"#ffffff"},"spacing":"spacious"}')
            || jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000002', 'type', 'brand_logos',
                 'enabled', true, 'props', jsonb_build_object('title', 'Nuestras marcas',
                   'brand_ids', jsonb_build_array(tests.fx('b1'), tests.fx('b2')))))),
          'ok', 'portada con colores y marcas');
select public.appearance_publish_theme(tests.fx('store_a'), tests.theme_rev(tests.fx('store_a')));
select tests.logout();

select is(pg_temp.gw() #> '{sections,0,colors}', '{"background":"#111827","foreground":"#ffffff"}'::jsonb,
          'los colores del bloque llegan a la tienda');
select is(pg_temp.gw() #>> '{sections,0,spacing}', 'spacious', 'y su espacio');
select is((select array_agg(b ->> 'name' order by b ->> 'name') from jsonb_array_elements(pg_temp.gw() #> '{sections,1,brands}') b),
          array['Ace Ultra', 'Muha Meds'], 'las marcas sin logo también salen (con logo null)');

-- 5. Las funciones nuevas no se conceden a nadie.
select ok(not has_function_privilege('authenticated', 'app.theme_nav_bar_valid(jsonb)', 'execute')
          and not has_function_privilege('anon', 'app.home_section_colors_valid(jsonb)', 'execute')
          and not has_function_privilege('storefront_gateway', 'app.theme_nav_bar_valid(jsonb)', 'execute'),
          'los validadores nuevos no se exponen');

select * from finish();
rollback;
