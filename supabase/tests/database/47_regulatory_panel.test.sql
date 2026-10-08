-- =============================================================================
-- Fase R · R-T02 — Clasificación masiva de lo publicado como "no regulado":
-- solo lo publicado y sin clasificar, con products.update, sin tocar otra tienda.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('inv', 'inv@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'inv', 'inventory_manager');

create function pg_temp.product(p_store text, p_slug text, p_publish boolean) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.catalog_upsert_product(tests.fx('store_' || p_store), jsonb_build_object(
    'title', p_slug, 'slug', p_slug, 'variants', '[{"price":100}]'::jsonb)) ->> 'id')::uuid;
  if p_publish then perform public.catalog_publish_product(tests.fx('store_' || p_store), v); end if;
  return v;
end $$;

select tests.login('owner');
select tests.set_fx('pub1', pg_temp.product('a', 'pub-1', true));
select tests.set_fx('pub2', pg_temp.product('a', 'pub-2', true));
select tests.set_fx('borrador', pg_temp.product('a', 'borrador', false));
select tests.logout();
select tests.login('owner_b');
select tests.set_fx('ajeno', pg_temp.product('b', 'ajeno', true));
select tests.logout();

select tests.login('inv');
select throws_ok(format($$ select public.catalog_classify_active_unregulated(%L) $$, tests.fx('store_a')),
  '42501', 'forbidden', 'clasificar exige products.update');
select tests.logout();

select tests.login('owner');
select is(public.catalog_classify_active_unregulated(tests.fx('store_a')), 2, 'clasifica los dos publicados');
select is(public.catalog_classify_active_unregulated(tests.fx('store_a')), 0, 'y no vuelve a clasificarlos');
select is((select count(*)::int from public.product_regulatory_info where product_id = tests.fx('borrador')), 0,
  'los borradores se clasifican uno por uno');
select is((public.compliance_store_status(tests.fx('store_a')) ->> 'unclassified_active')::int, 0,
  'ya no quedan publicados sin clasificar');
select tests.logout();
select is((select count(*)::int from public.product_regulatory_info where product_id = tests.fx('ajeno')), 0,
  'la otra tienda no se toca');

select * from finish();
rollback;
