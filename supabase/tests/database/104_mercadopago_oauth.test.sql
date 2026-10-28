-- =============================================================================
-- ADR-041: Mercado Pago por tienda (OAuth). Las llaves cifradas solo las toca el
-- worker; ninguna sale al panel; cada tienda conecta su propia cuenta; renovar
-- reemplaza las llaves y una cuenta por vencer se encola para renovación.
-- =============================================================================
begin;
select plan(13);

select tests.create_user('owner', 'owner@a.io');
select tests.create_tenant('a', 'owner');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function pg_temp.box(p text) returns text language sql as $$
  select 'v1.aXY.dGFn.' || replace(encode(convert_to(p, 'utf8'), 'base64'), '=', '') $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select ok(not has_table_privilege('authenticated', 'system.payment_credentials', 'select')
          and not has_table_privilege('system_worker', 'system.payment_credentials', 'select')
          and not has_function_privilege('authenticated', 'system.mercadopago_credentials(uuid)', 'execute')
          and not has_function_privilege('authenticated',
                'system.mercadopago_attach_oauth(uuid,text,text,text,text,timestamptz)', 'execute'),
          'nadie lee ni escribe las llaves directamente: solo funciones del worker');
select ok(has_function_privilege('system_worker', 'system.mercadopago_credentials(uuid)', 'execute'),
          'el worker sí las lee para cobrar');

select ok(pg_temp.err(format($$select system.mercadopago_attach_oauth(%L, '5551', 'test', 'APP_USR-claro', null,
                                                                    now() + interval '180 days')$$,
                             tests.fx('store_a')))
          like '%violates check constraint "payment_credentials_access_token_enc_check"%',
          'una llave sin cifrar no se puede guardar');

select tests.set_fx('acct_a', system.mercadopago_attach_oauth(tests.fx('store_a'), '5551', 'test',
                    pg_temp.box('acceso-a'), pg_temp.box('renueva-a'), now() + interval '180 days'));
select is((select c.access_token_enc from system.mercadopago_credentials(tests.fx('acct_a')) c),
          pg_temp.box('acceso-a'), 'la tienda A guarda sus llaves cifradas');
select is((select a.public_config ->> 'connection' from public.payment_accounts a where a.id = tests.fx('acct_a')),
          'oauth', 'y su cuenta queda marcada como propia');

select tests.set_fx('acct_b', system.mercadopago_attach_oauth(tests.fx('store_b'), '7772', 'test',
                    pg_temp.box('acceso-b'), pg_temp.box('renueva-b'), now() + interval '180 days'));
select isnt(tests.fx('acct_a'), tests.fx('acct_b'), 'la tienda B conecta otra cuenta: cada una cobra en la suya');
select is(pg_temp.err(format($$select system.mercadopago_attach_oauth(%L, '5551', 'test', %L, null,
                                                                    now() + interval '180 days')$$,
                             tests.fx('store_b'), pg_temp.box('x'))),
          'conflict/mercadopago_account_in_use', 'la cuenta de A no se puede conectar a B');

-- Reconectar la misma cuenta reemplaza las llaves (no duplica).
select system.mercadopago_attach_oauth(tests.fx('store_a'), '5551', 'test', pg_temp.box('acceso-a2'),
                                       pg_temp.box('renueva-a2'), now() + interval '180 days');
select is((select count(*)::int from system.payment_credentials c where c.store_id = tests.fx('store_a')), 1,
          'reconectar reemplaza las llaves');

-- El panel ve si cobra en su cuenta, nunca las llaves.
select tests.login('owner');
select is(public.payments_get_mercadopago(tests.fx('store_a')) -> 'account' ->> 'own_account', 'true',
          'el panel sabe que cobra en su propia cuenta');
select ok(public.payments_get_mercadopago(tests.fx('store_a'))::text not like '%v1.%',
          'y nunca recibe una llave, ni cifrada');
select tests.logout();

-- Renovación.
select system.mercadopago_save_tokens(tests.fx('acct_a'), pg_temp.box('acceso-a3'), null, now() + interval '180 days');
select is((select c.refresh_token_enc from system.mercadopago_credentials(tests.fx('acct_a')) c),
          pg_temp.box('renueva-a2'), 'sin refresh nuevo se conserva el anterior');
select ok(not exists (select 1 from system.mercadopago_credentials_due(50)), 'nada por vencer: nada que renovar');
update system.payment_credentials set expires_at = now() + interval '10 days'
 where payment_account_id = tests.fx('acct_b');
select is((select d.payment_account_id from system.mercadopago_credentials_due(50) d), tests.fx('acct_b'),
          'una llave que vence en menos de 30 días se renueva');

select * from finish();
rollback;
