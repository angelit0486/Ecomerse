-- =============================================================================
-- Fase 7 · Validación de lanzamiento (F7-T05).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

select tests.create_user('owner', 'owner@a.io');
select tests.create_user('viewer', 'viewer@a.io');
select tests.create_tenant('a', 'owner');
select tests.add_store_member('a', 'viewer', 'viewer');
select tests.create_user('owner_b', 'owner@b.io');
select tests.create_tenant('b', 'owner_b');

create function tests.codes() returns text language sql as $$
  select coalesce(string_agg(i ->> 'code', ',' order by i ->> 'code'), '')
    from jsonb_array_elements(app.validate_store_for_launch(tests.fx('store_a'))) i $$;
create function tests.publish_policy(p_type text, p_body text) returns void language sql as $$
  update public.store_pages set body_html = p_body, is_published = true, published_at = now()
   where store_id = tests.fx('store_a') and type = p_type and deleted_at is null $$;

-- ============================================================================ Tienda vacía
select is(tests.codes(), 'active_product,contact,payment_method,policy_privacy,policy_returns,policy_terms',
  'tienda nueva: todos los bloqueos (sin envío mientras no haya productos físicos)');
select tests.login('viewer');
select is(jsonb_array_length(public.stores_launch_checklist(tests.fx('store_a')) -> 'issues'), 6,
  'viewer ve el checklist');
select throws_ok(format($$ select public.stores_launch(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'viewer no publica');
select tests.logout();
select tests.login('owner_b');
select throws_ok(format($$ select public.stores_launch_checklist(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'B no ve el checklist de A');
select throws_ok(format($$ select public.stores_launch(%L) $$, tests.fx('store_a')), '42501', 'forbidden',
  'B no publica A');
select tests.logout();
select tests.login('owner');
select throws_ok(format($$ select public.stores_launch(%L) $$, tests.fx('store_a')), 'P0001', 'validation_failed',
  'una tienda sin pagos ni políticas no se publica');
select tests.logout();
select is((select status from public.stores where id = tests.fx('store_a')), 'draft', 'sigue en borrador');

-- ============================================================================ Completar paso a paso
insert into public.payment_accounts (store_id, provider, status, display_name) values
  (tests.fx('store_a'), 'fake', 'active', 'Prueba');
select ok(position('payment_method' in tests.codes()) > 0, 'fake no cuenta como método de pago');
insert into public.payment_accounts (store_id, provider, status, mode, display_name) values
  (tests.fx('store_a'), 'manual', 'active', 'test', 'Transferencia');
select ok(position('payment_method' in tests.codes()) > 0, 'una cuenta en modo test no cuenta');
select tests.login('viewer');
select throws_ok(format($$ select public.payments_save_manual(%L, 'Transferencia', 'CLABE 012345678901234567', true) $$,
  tests.fx('store_a')), '42501', 'forbidden', 'viewer no configura pagos');
select tests.logout();
select tests.login('owner');
select throws_ok(format($$ select public.payments_save_manual(%L, 'Transferencia', 'corto', true) $$, tests.fx('store_a')),
  'P0001', 'validation_failed', 'instrucciones demasiado cortas: rechazadas');
select is(public.payments_save_manual(tests.fx('store_a'), 'Transferencia', 'CLABE 012345678901234567', true),
  (select id from public.payment_accounts where store_id = tests.fx('store_a') and provider = 'manual'),
  'actualiza la cuenta manual existente (una por tienda)');
select tests.logout();
select ok(position('payment_method' in tests.codes()) = 0, 'manual live activo: cumple');

select tests.login('owner');
select public.catalog_publish_product(tests.fx('store_a'), (public.catalog_upsert_product(tests.fx('store_a'),
  '{"title":"Taza","variants":[{"price":10000,"sku":"TAZA-1"}]}') ->> 'id')::uuid);
select tests.logout();
select ok(position('active_product' in tests.codes()) = 0 and position('shipping_zone' in tests.codes()) > 0
          and position('policy_shipping' in tests.codes()) > 0,
  'producto físico activo: exige zona de envío y política de envíos');
insert into public.shipping_zones (store_id, name, countries) values (tests.fx('store_a'), 'México', '{MX}')
  returning tests.set_fx('zone', id);
insert into public.shipping_rates (store_id, zone_id, name, type, price, is_active)
  values (tests.fx('store_a'), tests.fx('zone'), 'Estándar', 'flat', 9900, false);
select ok(position('shipping_zone' in tests.codes()) > 0, 'una tarifa inactiva no cuenta');
update public.shipping_rates set is_active = true where store_id = tests.fx('store_a');
select ok(position('shipping_zone' in tests.codes()) = 0, 'zona con tarifa activa: cumple');

-- La plantilla publicada tal cual no cuenta (no se inventa contenido legal).
select tests.publish_policy('policy_privacy', (select body_html from public.store_pages
  where store_id = tests.fx('store_a') and type = 'policy_privacy'));
select ok(position('policy_privacy' in tests.codes()) > 0, 'la plantilla publicada sin completar no cuenta');
select tests.publish_policy('policy_privacy', '<h2>Responsable</h2><p>[Razón social]</p><p>Texto real.</p>');
select ok(position('policy_privacy' in tests.codes()) > 0, 'un marcador [..] pendiente no cuenta');
select tests.publish_policy('policy_privacy', '<p>Aviso de privacidad de la tienda A.</p>');
select tests.publish_policy('policy_terms', '<p>Términos de la tienda A.</p>');
select tests.publish_policy('policy_returns', '<p>Devoluciones en 30 días.</p>');
select tests.publish_policy('policy_shipping', '<p>Enviamos en 3 días.</p>');
update public.stores set contact_email = 'hola@a.io' where id = tests.fx('store_a');
select is(tests.codes(), '', 'todo completo: sin bloqueos');

-- ============================================================================ Publicar
select tests.login('owner');
select is(public.stores_launch(tests.fx('store_a')) ->> 'replayed', 'false', 'publicada');
select is(public.stores_launch(tests.fx('store_a')) ->> 'replayed', 'true', 'publicar dos veces: idempotente');
select tests.logout();
select is((select status || '/' || (launched_at is not null) from public.stores where id = tests.fx('store_a')),
  'active/true', 'activa con fecha de lanzamiento');
select ok(exists (select 1 from audit.audit_logs where action = 'store.launched' and store_id = tests.fx('store_a')),
  'auditado');

select * from finish();
rollback;
