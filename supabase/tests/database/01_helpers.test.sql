-- =============================================================================
-- Funciones auxiliares genéricas (Fase 1).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- uuid_v7 --------------------------------------------------------------------
select is(substring(app.uuid_v7()::text from 15 for 1), '7', 'uuid_v7: nibble de versión = 7');
select ok(substring(app.uuid_v7()::text from 20 for 1) in ('8', '9', 'a', 'b'), 'uuid_v7: variante RFC 9562 (10xx)');
select ok(
  (select count(distinct u) = 1000 from (select app.uuid_v7() u from generate_series(1, 1000)) s),
  'uuid_v7: 1000 valores únicos'
);
select ok(
  (select abs(
     ('x' || lpad(replace(substring(app.uuid_v7()::text from 1 for 13), '-', ''), 16, '0'))::bit(64)::bigint
     - floor(extract(epoch from clock_timestamp()) * 1000)::bigint) < 5000),
  'uuid_v7: los 48 bits iniciales son el tiempo Unix en ms'
);
select ok(
  (select a < b from (select app.uuid_v7() a) x, lateral (select pg_sleep(0.002), app.uuid_v7() b) y),
  'uuid_v7: ordenable en el tiempo'
);

-- prevent_tenant_change -------------------------------------------------------
create temp table t_tenant (id int primary key, store_id uuid, organization_id uuid, name text);
create trigger t_tenant_guard before update on t_tenant
  for each row execute function app.prevent_tenant_change();
insert into t_tenant values (1, gen_random_uuid(), gen_random_uuid(), 'a');

select lives_ok($$ update t_tenant set name = 'b' where id = 1 $$, 'prevent_tenant_change: otras columnas sí cambian');
select throws_ok($$ update t_tenant set store_id = gen_random_uuid() where id = 1 $$,
  '42501', 'tenant_immutable', 'prevent_tenant_change: store_id es inmutable');
select throws_ok($$ update t_tenant set organization_id = gen_random_uuid() where id = 1 $$,
  '42501', 'tenant_immutable', 'prevent_tenant_change: organization_id es inmutable');

-- forbid_mutation --------------------------------------------------------------
create temp table t_ledger (id int primary key, v int);
create trigger t_ledger_guard before update or delete on t_ledger
  for each row execute function app.forbid_mutation();
insert into t_ledger values (1, 1);
select throws_ok($$ delete from t_ledger where id = 1 $$, '42501', 'append_only',
  'forbid_mutation: DELETE rechazado en tablas append-only');

select * from finish();
rollback;
