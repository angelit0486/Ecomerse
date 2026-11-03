-- =============================================================================
-- ADR-046, paso 2: tras anonimizar una tienda, el worker borra sus archivos y
-- las cuentas de Auth de sus compradores que nadie más usa. La base decide qué
-- se borra: nunca archivos de otra tienda ni cuentas que siguen en uso.
-- =============================================================================
begin;
select plan(14);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner_a');   -- cerrada hace 31 días
select tests.create_tenant('b', 'owner_b');   -- abierta
select tests.create_user('solo_a', 'solo@cliente.io');     -- compró solo en A
select tests.create_user('tambien_b', 'ambas@cliente.io'); -- compró en A y en B
select tests.create_user('staff', 'staff@cliente.io');     -- compró en A y es del equipo de B
select tests.add_org_member('org_b', 'staff', 'org_member');

insert into public.customers (store_id, email, user_id) values
  (tests.fx('store_a'), 'solo@cliente.io', tests.fx('solo_a')),
  (tests.fx('store_a'), 'ambas@cliente.io', tests.fx('tambien_b')),
  (tests.fx('store_b'), 'ambas@cliente.io', tests.fx('tambien_b')),
  (tests.fx('store_a'), 'staff@cliente.io', tests.fx('staff'));
insert into storage.objects (bucket_id, name) values
  ('store-media', tests.fx('store_a') || '/products/foto.webp'),
  ('store-media', tests.fx('store_a') || '/products/foto-640.webp'),
  ('store-uploads', tests.fx('store_a') || '/uploads/pendiente.jpg'),
  ('store-media', tests.fx('store_b') || '/products/foto.webp');
update public.stores set status = 'closed', closed_at = now() - interval '31 days' where id = tests.fx('store_a');

create function pg_temp.w_users() returns setof uuid language plpgsql as $$
declare r record;
begin
  perform tests.as_role('system_worker');
  for r in select b.user_id from system.auth_user_purge_batch(50) b loop return next r.user_id; end loop;
  perform tests.logout();
end $$;
create function pg_temp.w_files(p_store uuid) returns setof text language plpgsql as $$
declare r record;
begin
  perform tests.as_role('system_worker');
  for r in select f.bucket || ':' || f.path as k from system.anonymized_store_files(p_store, 500) f loop
    return next r.k;
  end loop;
  perform tests.logout();
end $$;
create function pg_temp.w_files_done(p_store uuid) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform tests.as_role('system_worker');
  v := system.anonymized_store_files_done(p_store);
  perform tests.logout();
  return v;
end $$;

select is((select count(*)::int from pg_temp.w_files(tests.fx('store_a'))), 0,
          'antes de anonimizar no se borra ningún archivo');

select system.anonymize_closed_stores(5);

select is((select count(*)::int from system.auth_user_purge_queue), 3,
          'al anonimizar, las cuentas de sus compradores quedan por revisar');
select is((select count(*)::int from system.jobs where type = 'privacy.purge_anonymized'), 1,
          'y se encola la limpieza');
select is(array(select pg_temp.w_users()), array[tests.fx('solo_a')],
          'solo se borra la cuenta que nadie más usa (no la de otra tienda ni la del equipo)');
select is((select count(*)::int from system.auth_user_purge_queue), 1,
          'las que siguen en uso salen de la cola sin borrarse');

select is(array(select pg_temp.w_files(tests.fx('store_a')) order by 1),
          array['store-media:' || tests.fx('store_a') || '/products/foto-640.webp',
                'store-media:' || tests.fx('store_a') || '/products/foto.webp',
                'store-uploads:' || tests.fx('store_a') || '/uploads/pendiente.jpg'],
          'los archivos de la tienda anonimizada: fotos, copias y subidas');
select is((select count(*)::int from pg_temp.w_files(tests.fx('store_b'))), 0,
          'nunca los de una tienda abierta');
select is(pg_temp.w_files_done(tests.fx('store_a')), false, 'no se marca limpia mientras queden archivos');

-- El worker los borró en Storage.
delete from storage.objects where name like tests.fx('store_a') || '/%';
select is(pg_temp.w_files_done(tests.fx('store_a')), true, 'sin archivos, se marca limpia');
select isnt((select files_purged_at from public.stores where id = tests.fx('store_a')), null, 'con fecha');
select is((select count(*)::int from storage.objects where name like tests.fx('store_b') || '/%'), 1,
          'los archivos de la otra tienda siguen ahí');

-- Si el comprador vuelve a comprar en otra tienda antes del borrado, su cuenta se respeta.
insert into public.customers (store_id, email, user_id) values (tests.fx('store_b'), 'solo@cliente.io', tests.fx('solo_a'));
select is(system.auth_user_purge_claim(tests.fx('solo_a')), false, 'una cuenta que volvió a usarse no se borra');
delete from public.customers where store_id = tests.fx('store_b') and user_id = tests.fx('solo_a');
select is(system.auth_user_purge_claim(tests.fx('solo_a')), true, 'sin otro uso, sí');

select ok(not has_function_privilege('authenticated', 'system.auth_user_purge_batch(integer)', 'execute')
          and not has_function_privilege('authenticated', 'system.anonymized_store_files(uuid,integer)', 'execute')
          and not has_function_privilege('storefront_gateway', 'system.auth_user_purge_claim(uuid)', 'execute')
          and not has_table_privilege('system_worker', 'system.auth_user_purge_queue', 'select'),
          'solo el worker, y solo por funciones');

select * from finish();
rollback;
