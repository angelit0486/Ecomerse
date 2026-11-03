-- =============================================================================
-- Rotación de PAYMENT_CREDENTIALS_KEY: el worker lee las llaves cifradas por
-- lotes y las reemplaza solo si siguen siendo las que leyó. Nadie más las toca.
-- =============================================================================
begin;
select plan(10);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.box(p text) returns text language sql as $$
  select 'v1.aXY.dGFn.' || replace(encode(convert_to(p, 'utf8'), 'base64'), '=', '') $$;

create function pg_temp.worker_batch(p_after uuid, p_limit integer)
returns setof uuid language plpgsql as $$
declare r record;
begin
  perform tests.as_role('system_worker');
  for r in select b.payment_account_id from system.payment_credentials_batch(p_after, p_limit) b loop
    return next r.payment_account_id;
  end loop;
  perform tests.logout();
end $$;
create function pg_temp.worker_reseal(p_acct uuid, p_old text, p_new text, p_new_refresh text)
returns boolean language plpgsql as $$
declare v boolean;
begin
  perform tests.as_role('system_worker');
  v := system.payment_credentials_reseal(p_acct, p_old, p_new, p_new_refresh);
  perform tests.logout();
  return v;
end $$;

select tests.set_fx('acct_a', system.mercadopago_attach_oauth(tests.fx('store_a'), '5551', 'test',
                    pg_temp.box('acceso-a'), pg_temp.box('renueva-a'), now() + interval '180 days'));
select tests.set_fx('acct_b', system.mercadopago_attach_oauth(tests.fx('store_b'), '7772', 'test',
                    pg_temp.box('acceso-b'), null, now() + interval '180 days'));

select ok(not has_function_privilege('authenticated', 'system.payment_credentials_batch(uuid,integer)', 'execute')
          and not has_function_privilege('storefront_gateway', 'system.payment_credentials_batch(uuid,integer)', 'execute')
          and not has_function_privilege('authenticated',
                'system.payment_credentials_reseal(uuid,text,text,text)', 'execute')
          and not has_function_privilege('anon', 'system.payment_credentials_reseal(uuid,text,text,text)', 'execute'),
          'ni el panel ni la tienda pueden leer ni reescribir llaves');
select ok(has_function_privilege('system_worker', 'system.payment_credentials_batch(uuid,integer)', 'execute')
          and has_function_privilege('system_worker', 'system.payment_credentials_reseal(uuid,text,text,text)', 'execute'),
          'solo el worker');

select is((select count(*)::int from pg_temp.worker_batch(null, 500)), 2,
          'el lote trae las llaves de todas las tiendas');
select is((select count(*)::int from pg_temp.worker_batch(
             (select b from pg_temp.worker_batch(null, 1) b), 500)), 1,
          'y sigue después del último id leído');
select is(pg_temp.worker_reseal(tests.fx('acct_a'), pg_temp.box('acceso-a'),
                                            pg_temp.box('nueva-a'), pg_temp.box('nueva-renueva-a')), true,
          'reemplaza si el sobre sigue igual');
select is(pg_temp.worker_reseal(tests.fx('acct_b'), pg_temp.box('viejo-distinto'),
                                            pg_temp.box('nueva-b'), null), false,
          'no pisa llaves que cambiaron mientras tanto (renovación concurrente)');

select is((select c.access_token_enc || '|' || c.refresh_token_enc from system.payment_credentials c
            where c.payment_account_id = tests.fx('acct_a')),
          pg_temp.box('nueva-a') || '|' || pg_temp.box('nueva-renueva-a'), 'la tienda A quedó con sus llaves nuevas');
select is((select c.access_token_enc from system.payment_credentials c
            where c.payment_account_id = tests.fx('acct_b')),
          pg_temp.box('acceso-b'), 'y la tienda B quedó intacta');

-- El job diario corre con cualquier tienda con llaves propias, aunque nada venza.
select is((select count(*)::int from system.mercadopago_credentials_due(50)), 0, 'ninguna llave vence pronto');
select system.mercadopago_enqueue_refresh();
select is((select count(*)::int from system.jobs j where j.type = 'payments.mercadopago_refresh'), 1,
          'y aun así se encola la pasada diaria (completa una rotación en un día)');

select * from finish();
rollback;
