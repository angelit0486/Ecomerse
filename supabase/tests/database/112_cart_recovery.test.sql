-- =============================================================================
-- ADR-048: un recordatorio por carrito con correo, 3 h después de la última
-- actividad, solo en tiendas que lo activaron, con baja y enlace de un solo uso.
-- =============================================================================
begin;
select plan(18);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('viewer_a', 'viewer@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner_a');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer_a', 'viewer');
update public.stores set status = 'active', launched_at = now() where id in (tests.fx('store_a'), tests.fx('store_b'));

insert into public.products (store_id, title, slug, status) values (tests.fx('store_a'), 'Taza roja', 'taza', 'draft');
insert into public.product_variants (store_id, product_id, sku, price, option_signature)
select tests.fx('store_a'), id, 'TAZA-1', 15000, '' from public.products where store_id = tests.fx('store_a');

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.cart(p_store text, p_email text, p_hours_ago integer, p_items boolean default true)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.carts (store_id, token_hash, email, last_activity_at)
  values (tests.fx('store_' || p_store), sha256(convert_to(gen_random_uuid()::text, 'UTF8')), p_email,
          now() - make_interval(hours => p_hours_ago))
  returning id into v;
  if p_items then
    insert into public.cart_items (store_id, cart_id, variant_id, quantity)
    select tests.fx('store_' || p_store), v, pv.id, 2 from public.product_variants pv
     where pv.store_id = tests.fx('store_a') limit 1;
  end if;
  return v;
end $$;
create function pg_temp.due() returns setof record language plpgsql as $$
begin
  perform tests.as_role('system_worker');
  return query select d.cart_id, d.email, d.token, d.items from system.cart_recovery_due(50) d;
  perform tests.logout();
end $$;
create function pg_temp.gw_recover(p_store uuid, p_rec text, p_new text) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform tests.as_role('storefront_gateway');
  v := storefront.cart_recover(p_store, p_rec, p_new);
  perform tests.logout();
  return v;
end $$;
create function pg_temp.gw_optout(p_email text) returns text language plpgsql as $$
declare v text; h text := encode(app.email_hash(p_email), 'hex');
begin
  perform tests.as_role('storefront_gateway');
  v := pg_temp.err(format('select storefront.cart_recovery_optout(%L, %L)', tests.fx('store_a'), h));
  perform tests.logout();
  return v;
end $$;
create temp table due_run (cart_id uuid, email text, token text, items jsonb);

select tests.set_fx('c_due', pg_temp.cart('a', 'ana@cliente.io', 4));
select tests.set_fx('c_recent', pg_temp.cart('a', 'beto@cliente.io', 1));
select tests.set_fx('c_old', pg_temp.cart('a', 'carla@cliente.io', 72));
select tests.set_fx('c_empty', pg_temp.cart('a', 'dani@cliente.io', 4, false));
select tests.set_fx('c_noemail', pg_temp.cart('a', null, 4));
select tests.set_fx('c_optout', pg_temp.cart('a', 'eva@cliente.io', 4));
select tests.set_fx('c_other', pg_temp.cart('b', 'fer@cliente.io', 4, false));

-- Activarlo: solo quien gestiona las notificaciones.
select tests.login('viewer_a');
select is(pg_temp.err(format('select public.notifications_set_cart_recovery(%L, true)', tests.fx('store_a'))),
          'forbidden', 'sin permiso de notificaciones no se activa');
select tests.logout();
select tests.login('owner_b');
select is(pg_temp.err(format('select public.notifications_set_cart_recovery(%L, true)', tests.fx('store_a'))),
          'forbidden', 'otra tienda tampoco');
select tests.logout();

-- Apagado (por defecto): no sale nada.
insert into due_run select * from pg_temp.due() as t(cart_id uuid, email text, token text, items jsonb);
select is((select count(*)::int from due_run), 0, 'viene apagado: no se recuerda ningún carrito');

select tests.login('owner_a');
select lives_ok(format('select public.notifications_set_cart_recovery(%L, true)', tests.fx('store_a')),
                'la dueña lo activa');
select tests.logout();

-- Baja de un correo (lo llama la tienda tras verificar la firma del enlace).
select is(pg_temp.gw_optout('EVA@cliente.io'), 'ok', 'darse de baja (sin importar mayúsculas)');
create function pg_temp.gw_optout_raw(p_hash text) returns text language plpgsql as $$
declare v text;
begin
  perform tests.as_role('storefront_gateway');
  v := pg_temp.err(format('select storefront.cart_recovery_optout(%L, %L)', tests.fx('store_a'), p_hash));
  perform tests.logout();
  return v;
end $$;
select is(pg_temp.gw_optout_raw('eva@cliente.io'), 'validation_failed/email_hash',
          'la baja solo acepta el hash, nunca el correo');

insert into due_run select * from pg_temp.due() as t(cart_id uuid, email text, token text, items jsonb);
select is((select array_agg(cart_id) from due_run), array[tests.fx('c_due')],
          'solo el carrito con correo, productos, 3 a 48 h sin actividad y sin baja');
select is((select items from due_run), '[{"title":"Taza roja","quantity":2}]'::jsonb, 'con sus productos para el correo');
select ok((select token ~ '^[A-Za-z0-9_-]{43}$' from due_run), 'y un token de enlace de 43 caracteres');
select ok((select recovery_sent_at is not null and recovery_token_hash = sha256(convert_to((select token from due_run), 'UTF8'))
             from public.carts where id = tests.fx('c_due')), 'en la base solo queda el hash del token');

delete from due_run;
insert into due_run select * from pg_temp.due() as t(cart_id uuid, email text, token text, items jsonb);
select is((select count(*)::int from due_run), 0, 'un solo recordatorio por carrito');

-- Recuperar con el enlace.
update public.carts set recovery_token_hash = sha256(convert_to(repeat('a', 43), 'UTF8')) where id = tests.fx('c_due');
select is(pg_temp.gw_recover(tests.fx('store_b'), repeat('a', 43), repeat('n', 43)), false,
          'el enlace no sirve en otra tienda');
select is(pg_temp.gw_recover(tests.fx('store_a'), repeat('a', 43), repeat('n', 43)), true,
          'el enlace recupera el carrito');
select is(pg_temp.gw_recover(tests.fx('store_a'), repeat('a', 43), repeat('m', 43)), false,
          'y solo sirve una vez');
select is(pg_temp.gw_recover(tests.fx('store_a'), 'corto', repeat('m', 43)), false, 'un token mal formado no sirve');
select ok((select token_hash = app.cart_token_hash(repeat('n', 43)) and recovery_token_hash is null
             from public.carts where id = tests.fx('c_due')), 'la cookie nueva queda ligada al carrito');

select is(pg_temp.gw_recover(null, null, null), false, 'sin datos responde falso, sin error');
select tests.login('owner_a');
select is(pg_temp.err($$ select system.cart_recovery_due(1) $$), 'permission denied for schema system',
          'una persona no puede pedir los tokens');
select tests.logout();

select * from finish();
rollback;
