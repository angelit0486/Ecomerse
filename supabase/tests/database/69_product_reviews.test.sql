-- =============================================================================
-- ADR-029 · Opiniones verificadas: solo con el enlace del pedido, pedido pagado
-- y entregado, producto del pedido, una por producto y pedido; nacen pendientes;
-- la tienda pública solo ve las publicadas (sin email ni pedido); moderación con
-- permisos, auditada, aislada y sin borrar.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '');
end $$;

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('a', 'owner');
select tests.create_tenant('b', 'owner_b');
select tests.add_store_member('a', 'viewer', 'viewer');
update public.stores set status = 'active', launched_at = now() where id = tests.fx('store_a');

select tests.login('owner');
select tests.set_fx('prod', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Creatina","slug":"creatina","variants":[{"price":49900,"sku":"CRE-1"}]}') ->> 'id')::uuid);
select public.catalog_publish_product(tests.fx('store_a'), tests.fx('prod'));
select tests.set_fx('other', (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Proteína","slug":"proteina","variants":[{"price":89900,"sku":"PRO-1"}]}') ->> 'id')::uuid);
select tests.logout();

-- Pedido pagado de «Ana  García López» con la creatina; token del enlace = 'tok-1'.
insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total, guest_access_token_hash)
values (tests.fx('store_a'), 3001, '#3001', 'test-' || gen_random_uuid(), 'ana@example.test', 'Ana  García López',
        false, 'MXN', true, 0, false, 49900, 49900, sha256(convert_to('tok-1', 'UTF8')));
select tests.set_fx('o1', (select id from public.orders where store_id = tests.fx('store_a') and number = 3001));
insert into public.order_items (store_id, order_id, variant_id, product_id, product_title, variant_title, sku,
                                product_type, requires_shipping, unit_price, quantity, line_total)
select tests.fx('store_a'), tests.fx('o1'), v.id, v.product_id, 'Creatina', null, v.sku, 'physical', false, v.price, 1,
       v.price
  from public.product_variants v where v.sku = 'CRE-1';
update public.orders set status = 'open', payment_status = 'paid', paid_total = total, paid_at = now()
 where id = tests.fx('o1');

create function pg_temp.submit(p_token text, p_product uuid, p_review text) returns text language sql as $$
  select pg_temp.err(format('select storefront.submit_review(%L, %L, sha256(convert_to(%L, ''UTF8'')), %L, %L)',
                            tests.fx('store_a'), tests.fx('o1'), p_token, p_product, p_review))
$$;

-- ============================================================================ Elegibilidad
select is(pg_temp.submit('tok-1', tests.fx('prod'), '{"rating":5,"body":"Se disuelve muy bien."}'),
          'conflict/order_not_delivered', 'sin entrega no se opina');
select is(jsonb_array_length(storefront.order_reviewables(tests.fx('store_a'), tests.fx('o1'),
            sha256(convert_to('tok-1', 'UTF8')))), 0, 'y el pedido no ofrece productos para opinar');
insert into public.shipments (store_id, order_id, status, shipped_at, delivered_at, idempotency_key)
values (tests.fx('store_a'), tests.fx('o1'), 'delivered', now(), now(), 'ship-review-test-0001');
select is(storefront.order_reviewables(tests.fx('store_a'), tests.fx('o1'), sha256(convert_to('tok-1', 'UTF8')))
            -> 0 ->> 'title', 'Creatina', 'entregado: ofrece la creatina');
select is(jsonb_array_length(storefront.order_reviewables(tests.fx('store_a'), tests.fx('o1'),
            sha256(convert_to('otro', 'UTF8')))), 0, 'con otro token no ofrece nada');
select is(pg_temp.submit('otro', tests.fx('prod'), '{"rating":5,"body":"Se disuelve muy bien."}'),
          'not_found/order', 'sin el token del enlace no se opina');
select is(pg_temp.submit('tok-1', tests.fx('other'), '{"rating":5,"body":"Se disuelve muy bien."}'),
          'not_found/product', 'un producto que no compró no se califica');
select is(pg_temp.submit('tok-1', tests.fx('prod'), '{"rating":6,"body":"Se disuelve muy bien."}'),
          'validation_failed/rating', 'calificación de 1 a 5');
select is(pg_temp.submit('tok-1', tests.fx('prod'), '{"rating":"x","body":"Se disuelve muy bien."}'),
          'validation_failed/rating', 'calificación numérica');
select is(pg_temp.submit('tok-1', tests.fx('prod'), '{"rating":4,"body":"corto"}'),
          'validation_failed/body', 'opinión de al menos 10 caracteres');

-- ============================================================================ Alta
select is(pg_temp.submit('tok-1', tests.fx('prod'),
            '{"rating":4,"title":"Buena","body":"Se disuelve muy bien y no sabe a nada.","author_name":"Admin"}'),
          'ok', 'el comprador opina');
select is((select status || '|' || author_name || '|' || rating from public.product_reviews
            where order_id = tests.fx('o1')), 'pending|Ana G.|4',
          'nace pendiente y el nombre visible lo calcula la base (nunca el navegador)');
select is(pg_temp.submit('tok-1', tests.fx('prod'), '{"rating":1,"body":"Cambio de opinión total."}'),
          'conflict/already_reviewed', 'una opinión por producto y pedido');
select ok((storefront.order_reviewables(tests.fx('store_a'), tests.fx('o1'), sha256(convert_to('tok-1', 'UTF8')))
            -> 0 ->> 'reviewed')::boolean, 'el pedido la marca como enviada');
select is((storefront.product_reviews(tests.fx('store_a'), tests.fx('prod')) ->> 'count')::integer, 0,
          'pendiente: la tienda pública no la muestra');

-- ============================================================================ Moderación
select tests.set_fx('r1', (select id from public.product_reviews where order_id = tests.fx('o1')));
select tests.login('viewer');
select is(public.reviews_list(tests.fx('store_a')) -> 'counts' ->> 'pending', '1', 'con products.read se ve la cola');
select is(pg_temp.err(format($$select public.reviews_moderate(%L, %L, 'published')$$, tests.fx('store_a'), tests.fx('r1'))),
          'forbidden', 'sin products.update no se publica');
select tests.logout();
select tests.login('owner');
select is(public.reviews_moderate(tests.fx('store_a'), tests.fx('r1'), 'published'), 'published', 'la dueña la publica');
select tests.logout();
select is(storefront.product_reviews(tests.fx('store_a'), tests.fx('prod')) - 'items',
          '{"count": 1, "average": 4.0, "distribution": {"1": 0, "2": 0, "3": 0, "4": 1, "5": 0}}'::jsonb,
          'publicada: cuenta, promedio y distribución reales');
select ok((storefront.product_reviews(tests.fx('store_a'), tests.fx('prod')))::text !~ 'ana@example|#3001|García',
          'sin email, sin número de pedido y sin apellido');
select ok(exists (select 1 from audit.audit_logs where action = 'review.published' and store_id = tests.fx('store_a')),
          'la moderación queda auditada');

-- ============================================================================ Integridad y aislamiento
select throws_ok(format('update public.product_reviews set body = %L where id = %L', 'Texto cambiado por alguien', tests.fx('r1')),
                 '42501', null, 'el texto de una opinión no se edita');
select throws_ok(format('delete from public.product_reviews where id = %L', tests.fx('r1')), '42501', null,
                 'las opiniones nunca se borran');
select tests.login('owner_b');
select is(pg_temp.err(format($$select public.reviews_list(%L)$$, tests.fx('store_a'))), 'forbidden',
          'otra tienda no ve la cola');
select is(tests.row_count('select * from public.product_reviews'), 0::bigint, 'ni por RLS');
select tests.logout();

select * from finish();
rollback;
