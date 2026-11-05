-- =============================================================================
-- ADR-060: retención de datos. Borra solo lo vencido (trabajos, filas de
-- importación, correos de más de 12 meses, carritos abandonados sin pedido),
-- nunca pedidos, pagos ni auditoría; solo el worker la corre; aislamiento entre
-- tiendas; la salud avisa si deja de correr.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

-- Trabajos: terminados de 31 y 29 días; fallidos de 91 y 89 días.
insert into system.jobs (type, status, finished_at, dedupe_key) values
  ('test.retention', 'succeeded', now() - interval '31 days', 'ret:ok-31'),
  ('test.retention', 'succeeded', now() - interval '29 days', 'ret:ok-29'),
  ('test.retention', 'dead',      now() - interval '91 days', 'ret:dead-91'),
  ('test.retention', 'dead',      now() - interval '89 days', 'ret:dead-89');

-- Importaciones: A terminada hace 31 días, A vista previa de hace 40, A terminada
-- hace 10, A confirmándose hace 40 (no se toca) y B terminada hace 31.
insert into public.import_jobs (id, store_id, type, mode, status, file_name, created_at, committed_at) values
  (tests.set_fx('imp_old', app.uuid_v7()), tests.fx('store_a'), 'products', 'upsert', 'completed', 'a.csv',
   now() - interval '35 days', now() - interval '31 days'),
  (tests.set_fx('imp_preview', app.uuid_v7()), tests.fx('store_a'), 'products', 'upsert', 'validated', 'b.csv',
   now() - interval '40 days', null),
  (tests.set_fx('imp_new', app.uuid_v7()), tests.fx('store_a'), 'products', 'upsert', 'completed', 'c.csv',
   now() - interval '12 days', now() - interval '10 days'),
  (tests.set_fx('imp_busy', app.uuid_v7()), tests.fx('store_a'), 'products', 'upsert', 'committing', 'd.csv',
   now() - interval '40 days', null),
  (tests.set_fx('imp_b', app.uuid_v7()), tests.fx('store_b'), 'products', 'upsert', 'completed', 'e.csv',
   now() - interval '35 days', now() - interval '31 days');
insert into public.import_job_rows (store_id, import_job_id, row_number, raw)
select j.store_id, j.id, g, jsonb_build_object('title', 'Fila ' || g)
  from public.import_jobs j cross join generate_series(2, 4) g
 where j.id in (tests.fx('imp_old'), tests.fx('imp_preview'), tests.fx('imp_new'), tests.fx('imp_busy'),
                tests.fx('imp_b'));

-- Correos: uno de hace 13 meses y otro de hace 11.
insert into public.notification_deliveries (dedupe_key, channel, template, recipient_hash, organization_id,
                                            status, provider, created_at) values
  ('ret:mail-13', 'email', 'order_created', sha256('a'::bytea), tests.fx('org_a'), 'sent', 'fake',
   now() - interval '13 months'),
  ('ret:mail-11', 'email', 'order_created', sha256('b'::bytea), tests.fx('org_a'), 'sent', 'fake',
   now() - interval '11 months');

-- Carritos de A: abandonado de 91 días, activo de 91, abandonado de 91 con pedido,
-- convertido de 200 y abandonado de 89. De B: abandonado de 91.
insert into public.carts (id, store_id, token_hash, status, last_activity_at, email) values
  (tests.set_fx('cart_old', app.uuid_v7()), tests.fx('store_a'), sha256('c1'::bytea), 'abandoned',
   now() - interval '91 days', 'ana@x.io'),
  (tests.set_fx('cart_active_old', app.uuid_v7()), tests.fx('store_a'), sha256('c2'::bytea), 'active',
   now() - interval '91 days', null),
  (tests.set_fx('cart_ordered', app.uuid_v7()), tests.fx('store_a'), sha256('c3'::bytea), 'abandoned',
   now() - interval '91 days', null),
  (tests.set_fx('cart_converted', app.uuid_v7()), tests.fx('store_a'), sha256('c4'::bytea), 'converted',
   now() - interval '200 days', null),
  (tests.set_fx('cart_recent', app.uuid_v7()), tests.fx('store_a'), sha256('c5'::bytea), 'abandoned',
   now() - interval '89 days', null),
  (tests.set_fx('cart_b', app.uuid_v7()), tests.fx('store_b'), sha256('c6'::bytea), 'abandoned',
   now() - interval '91 days', null);
insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total, cart_id, created_at)
values (tests.fx('store_a'), 1, '#1', 'ret-a-1-000000000000', 'c@x.io', 'C', false, 'MXN', true, 0, false,
        0, 0, tests.fx('cart_ordered'), now() - interval '120 days'),
       (tests.fx('store_a'), 2, '#2', 'ret-a-2-000000000000', 'c@x.io', 'C', false, 'MXN', true, 0, false,
        0, 0, tests.fx('cart_converted'), now() - interval '200 days');

create temp table before_counts as
select (select count(*) from public.orders) as orders,
       (select count(*) from public.payment_events) as payment_events,
       (select count(*) from audit.security_events) as security_events,
       (select count(*) from audit.audit_logs) as audit_logs,
       (select count(*) from public.inventory_movements) as movements;

-- 1-4. Correos: siguen sin UPDATE y sin DELETE fuera de la purga.
select throws_ok($$ update public.notification_deliveries set status = 'suppressed' where dedupe_key = 'ret:mail-13' $$,
  '42501', 'append_only', 'los correos entregados no se modifican');
select throws_ok($$ delete from public.notification_deliveries where dedupe_key = 'ret:mail-13' $$,
  '42501', 'append_only', 'sin la purga de retención, ni el de 13 meses se borra');
select throws_ok($$ select set_config('app.retention_purge', 'on', true);
                    delete from public.notification_deliveries where dedupe_key = 'ret:mail-11' $$,
  '42501', 'append_only', 'con la marca, uno de 11 meses tampoco');
select is(tests.sqlstate_as('authenticated', 'select system.purge_retention()'), '42501',
  'un usuario no puede correr la purga');

-- 5-6. Como la dueña de A: ni la purga ni el registro de corridas (esquema system).
select tests.login('owner_a');
select throws_ok($$ select system.purge_retention() $$, '42501', null, 'la dueña no corre la purga');
select throws_ok($$ select * from system.maintenance_runs $$, '42501', null, 'ni ve el registro de corridas');
select tests.logout();

-- 7. El worker la corre (por lotes de 1 para probar «more»).
select tests.as_role('system_worker');
select set_config('tests.retention_more', system.purge_retention(1) ->> 'more', true);
select system.purge_retention(5000);
select tests.logout();
select is(current_setting('tests.retention_more'), 'true', 'con lotes de 1 queda trabajo pendiente');

-- 8-9. Trabajos.
select is((select array_agg(dedupe_key order by dedupe_key) from system.jobs where type = 'test.retention'),
  array['ret:dead-89', 'ret:ok-29'], 'trabajos: se van los terminados de 31 días y los fallidos de 91');
select ok(not exists (select 1 from system.jobs where dedupe_key in ('ret:ok-31', 'ret:dead-91')),
  'y su clave de dedupe queda libre');

-- 10-15. Importaciones.
select is((select count(*)::int from public.import_job_rows where import_job_id = tests.fx('imp_old')), 0,
  'importación terminada hace 31 días: sin filas');
select ok((select rows_purged_at is not null and status = 'completed' from public.import_jobs
            where id = tests.fx('imp_old')), 'el trabajo se queda, completo y con la fecha de borrado');
select ok((select status = 'cancelled' and rows_purged_at is not null and error like 'La vista previa venció%'
             from public.import_jobs where id = tests.fx('imp_preview')),
  'la vista previa de 40 días se cancela');
select is((select count(*)::int from public.import_job_rows where import_job_id = tests.fx('imp_new')), 3,
  'la importación de hace 10 días conserva sus filas');
select is((select count(*)::int from public.import_job_rows where import_job_id = tests.fx('imp_busy')), 3,
  'una importación confirmándose no se toca');
select is((select count(*)::int from public.import_job_rows where import_job_id = tests.fx('imp_b')), 0,
  'la de la tienda B también vence (misma regla para todas)');

-- 16-17. Correos.
select ok(not exists (select 1 from public.notification_deliveries where dedupe_key = 'ret:mail-13'),
  'el correo de hace 13 meses se borra');
select ok(exists (select 1 from public.notification_deliveries where dedupe_key = 'ret:mail-11'),
  'el de hace 11 meses se queda');

-- 18-21. Carritos.
select is((select array_agg(id order by id) from public.carts
            where id in (tests.fx('cart_old'), tests.fx('cart_active_old'), tests.fx('cart_b'))), null,
  'se borran los carritos sin pedido con 91 días sin actividad (en A y en B)');
select ok((select count(*) = 3 from public.carts
            where id in (tests.fx('cart_ordered'), tests.fx('cart_converted'), tests.fx('cart_recent'))),
  'se quedan el que usa un pedido, el convertido y el de 89 días');
select is((select count(*)::int from public.orders where cart_id = tests.fx('cart_ordered')), 1,
  'el pedido sigue apuntando a su carrito');
select is((select count(*)::int from public.cart_items
            where cart_id in (tests.fx('cart_old'), tests.fx('cart_active_old'))), 0,
  'sin partidas huérfanas');

-- 22. Lo que nunca se borra (regla 9).
select ok((select orders = (select count(*) from public.orders)
              and payment_events = (select count(*) from public.payment_events)
              and security_events = (select count(*) from audit.security_events)
              and movements = (select count(*) from public.inventory_movements)
              and audit_logs < (select count(*) from audit.audit_logs)
             from before_counts),
  'pedidos, eventos de pago, de seguridad y movimientos intactos; la auditoría solo crece');

-- 23. Registro de la corrida y su auditoría.
select ok((select last_run_at > now() - interval '1 minute' and (last_result ->> 'carts')::int >= 0
             from system.maintenance_runs where task = 'data.retention'),
  'queda registrada la última corrida');

-- 24-25. Salud: aviso a los 8 días sin correr.
create function pg_temp.retention_issue() returns jsonb language sql as $$
  select i from jsonb_array_elements(system.platform_health() -> 'issues') i
   where i ->> 'code' = 'retention_stale'
$$;
select is(pg_temp.retention_issue(), null, 'recién corrida: sin aviso');
update system.maintenance_runs set last_run_at = now() - interval '9 days' where task = 'data.retention';
select is(pg_temp.retention_issue() ->> 'value', '9', 'a los 9 días sin correr: aviso con los días');

-- 26. El mantenimiento la encola una vez al día.
select tests.as_role('system_worker');
select system.enqueue_maintenance();
select tests.logout();
select ok(exists (select 1 from system.jobs
                   where type = 'data.retention'
                     and dedupe_key = 'data.retention:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD')),
  'el mantenimiento encola data.retention del día');

select * from finish();
rollback;
