-- =============================================================================
-- ADR-046: 30 días después de cerrar una tienda se anonimizan los datos
-- personales de sus compradores; montos, fechas y productos no cambian.
-- =============================================================================
begin;
select plan(19);

select tests.create_user('owner_a', 'owner@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_user('owner_c', 'owner@c.io');
select tests.create_tenant('a', 'owner_a');   -- cerrada hace 31 días
select tests.create_tenant('b', 'owner_b');   -- cerrada hace 10 días
select tests.create_tenant('c', 'owner_c');   -- abierta

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;
create function pg_temp.order_in(p_store text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name, phone,
                             requires_shipping, shipping_address, billing_address, customer_note, currency,
                             prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                             subtotal, discount_total, shipping_total, tax_total, total)
  values (tests.fx('store_' || p_store), 5001, 'X', 'idem-' || gen_random_uuid(), 'ana@cliente.io', 'Ana Ruiz',
          '2221234567', true,
          '{"line1":"Av. Juárez 10","city":"Puebla","region":"Puebla","country":"MX","postal_code":"72000","recipient_name":"Ana Ruiz","phone":"2221234567"}',
          '{"line1":"Av. Juárez 10","region":"Puebla","country":"MX"}', 'Tocar el timbre', 'MXN', true, 1600, true,
          30000, 0, 0, 0, 30000)
  returning id into v;
  return v;
end $$;

select tests.set_fx('oa', pg_temp.order_in('a'));
select tests.set_fx('ob', pg_temp.order_in('b'));
select tests.set_fx('oc', pg_temp.order_in('c'));
update public.orders set paid_total = 30000, payment_status = 'paid', paid_at = now() where id = tests.fx('oa');
insert into public.customers (store_id, email, first_name, last_name, phone, note)
values (tests.fx('store_a'), 'ana@cliente.io', 'Ana', 'Ruiz', '2221234567', 'cliente frecuente');
insert into public.customer_addresses (store_id, customer_id, recipient_name, line1, city, region, postal_code, country)
select tests.fx('store_a'), id, 'Ana', 'Calle 1', 'Puebla', 'Puebla', '72000', 'MX'
  from public.customers where store_id = tests.fx('store_a');
insert into public.carts (store_id, token_hash, email, shipping_address)
values (tests.fx('store_a'), sha256('cart-anon'::bytea), 'ana@cliente.io', '{"line1":"Av. Juárez 10"}');
insert into public.products (store_id, title, slug) values (tests.fx('store_a'), 'Taza', 'taza');
insert into public.product_reviews (store_id, product_id, order_id, rating, body, author_name, status)
select tests.fx('store_a'), p.id, tests.fx('oa'), 5, 'Muy buena taza, llegó a tiempo y bien empacada.', 'Ana R.', 'pending'
  from public.products p where p.store_id = tests.fx('store_a');

update public.stores set status = 'closed', closed_at = now() - interval '31 days' where id = tests.fx('store_a');
update public.stores set status = 'closed', closed_at = now() - interval '10 days' where id = tests.fx('store_b');

-- Fuera de la anonimización, los datos del pedido siguen siendo inmutables.
select is(pg_temp.err(format($$ update public.orders set customer_name = 'Anónimo' where id = %L $$, tests.fx('oc'))),
          'immutable/orders', 'sin la marca del sistema, el nombre del pedido no cambia');
select is(pg_temp.err($$ select set_config('app.anonymizing', 'on', true) $$ ||
                       format($$; update public.orders set total = 1 where id = %L $$, tests.fx('oc'))),
          'immutable/orders', 'con la marca, el total sigue sin poder cambiar');
select is(pg_temp.err(format($$ select set_config('app.anonymizing', 'on', true);
                                update public.orders set customer_name = 'Otro nombre' where id = %L $$, tests.fx('oc'))),
          'immutable/orders', 'con la marca, solo se aceptan los valores anónimos exactos');
select set_config('app.anonymizing', 'off', true);
select is(pg_temp.err($$ update public.product_reviews set author_name = 'Otro' $$),
          'column_immutable/public.product_reviews.author_name es inmutable', 'el nombre de la opinión no se edita');

-- La corrida del sistema (system_worker).
create function pg_temp.run() returns integer language plpgsql as $$
declare v integer;
begin
  perform tests.as_role('system_worker');
  v := system.anonymize_closed_stores(5);
  perform tests.logout();
  return v;
end $$;
select is(pg_temp.run(), 1, 'anonimiza solo la tienda cerrada hace más de 30 días');
select is(pg_temp.run(), 0, 'correr otra vez no hace nada');

select is((select email from public.orders where id = tests.fx('oa')),
          'anonimo-' || replace(tests.fx('oa')::text, '-', '') || '@anonimizado.invalid', 'correo anónimo en el pedido');
select is((select customer_name || '|' || coalesce(phone, '-') || '|' || coalesce(customer_note, '-')
             from public.orders where id = tests.fx('oa')), 'Anónimo|-|-', 'nombre, teléfono y nota anónimos');
select is((select shipping_address from public.orders where id = tests.fx('oa')),
          '{"country":"MX","region":"Puebla"}'::jsonb, 'de la dirección solo quedan país y estado');
select is((select total || '|' || paid_total || '|' || payment_status from public.orders where id = tests.fx('oa')),
          '30000|30000|paid', 'montos y estado del pago intactos');
select is((select first_name is null and last_name is null and phone is null and note is null
                  and anonymized_at is not null and email like 'anonimo-%@anonimizado.invalid'
             from public.customers where store_id = tests.fx('store_a')), true, 'cliente anonimizado');
select is((select count(*)::int from public.customer_addresses where store_id = tests.fx('store_a')), 0,
          'sus direcciones guardadas se borran');
select is((select email is null and shipping_address is null from public.carts where store_id = tests.fx('store_a')),
          true, 'carritos sin correo ni dirección');
select is((select author_name from public.product_reviews where store_id = tests.fx('store_a')), 'Anónimo',
          'opiniones con autor anónimo');
select ok((select anonymized_at is not null from public.stores where id = tests.fx('store_a')),
          'la tienda queda marcada como anonimizada');
select is((select count(*)::int from audit.audit_logs where action = 'store.anonymized' and store_id = tests.fx('store_a')),
          1, 'queda en la auditoría');
select is((select count(*)::int from public.orders where store_id = tests.fx('store_a')), 1, 'el pedido no se borra');

select is((select customer_name from public.orders where id = tests.fx('ob')), 'Ana Ruiz',
          'una tienda cerrada hace 10 días no se toca');
select is((select customer_name from public.orders where id = tests.fx('oc')), 'Ana Ruiz', 'una tienda abierta no se toca');

select * from finish();
rollback;
