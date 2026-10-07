-- =============================================================================
-- Fase 8 · Ajustes → Actividad (F8-T05): permiso, aislamiento, filtros, cursor.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

select tests.login('owner');
select public.taxes_update(tests.fx('store_a'), true, 1600, true) from generate_series(1, 3);
select tests.logout();
select tests.login('owner_b');
select public.taxes_update(tests.fx('store_b'), true, 800, true);
select tests.logout();

select tests.login('viewer');
select throws_ok(format($$ select public.audit_list(%L, null, null, 10) $$, tests.fx('store_a')), '42501', 'forbidden',
  'sin audit.read no hay actividad');
select tests.logout();
select tests.login('owner');
create temp table a1 as select public.audit_list(tests.fx('store_a'), null, null, 2) as v;
select is((select jsonb_array_length(v -> 'items') from a1), 2, 'primera página de 2');
select isnt((select v ->> 'next_cursor' from a1), null, 'hay más');
select ok((select bool_and(i ->> 'action' <> '' and i -> 'actor_label' is not null)
             from a1, jsonb_array_elements(v -> 'items') i), 'acción y autor en cada evento');
select ok((select not (v::text like '%"ip"%' or v::text like '%user_agent%') from a1), 'sin IP ni agente');
select is((select count(*)::int from jsonb_array_elements(
  public.audit_list(tests.fx('store_a'), 'tienda', null, 100) -> 'items') i where i ->> 'action' = 'store.taxes_updated'), 3,
  'filtro por área');
select is(jsonb_array_length(public.audit_list(tests.fx('store_a'), 'clientes', null, 100) -> 'items'), 0,
  'otra área: nada');
select throws_ok(format($$ select public.audit_list(%L, 'x', null, 10) $$, tests.fx('store_a')), 'P0001',
  'validation_failed', 'área desconocida: rechazada');
select ok((select bool_and((i -> 'after' ->> 'tax_rate_bps') is distinct from '800')
             from jsonb_array_elements(public.audit_list(tests.fx('store_a'), null, null, 100) -> 'items') i),
  'nada de la tienda B');
select tests.logout();

select * from finish();
rollback;
