-- ADR-046 (aprobado por el propietario el 2026-10-29): 30 días después de cerrar
-- una tienda, se anonimizan los datos personales de sus compradores. Los pedidos
-- no se borran (regla 9) y sus montos, fechas, productos e inventario no cambian.
-- Es la ÚNICA excepción a la inmutabilidad del snapshot del pedido: solo la puede
-- usar system.anonymize_closed_stores, que marca la transacción, y el guardián
-- solo acepta exactamente los valores anónimos (no sirve para editar pedidos).
--
-- Fuera de alcance de esta migración (paso 2, requiere Auth/Storage Admin):
-- cuentas de compradores en Auth y archivos de fotos en Storage.

alter table public.stores add column anonymized_at timestamptz;

-- ¿Está la transacción anonimizando? Solo la función del sistema fija la marca.
create function app.anonymizing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.anonymizing', true), '') = 'on'
$$;
revoke all on function app.anonymizing() from public;

-- Dirección anónima: conserva país y estado (estadística y fiscal), nada más.
create function app.anonymous_address(p_address jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_address is null then null
              else jsonb_strip_nulls(jsonb_build_object('country', p_address -> 'country',
                                                        'region', p_address -> 'region'))
         end
$$;
revoke all on function app.anonymous_address(jsonb) from public;

-- -----------------------------------------------------------------------------
-- 1. Guardián de pedidos: la excepción de anonimización.
-- -----------------------------------------------------------------------------
create or replace function app.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := array['paid_total', 'refunded_total', 'status', 'payment_status', 'fulfillment_status',
                            'needs_attention', 'cancel_reason', 'staff_note', 'paid_at', 'cancelled_at',
                            'completed_at', 'customer_id', 'shipping_rate_id', 'cart_id', 'updated_at'];
  -- ADR-046: datos personales que se pueden reemplazar SOLO por los valores anónimos.
  v_personal text[] := array['email', 'customer_name', 'phone', 'shipping_address', 'billing_address',
                             'customer_note'];
  v_actor   text := coalesce(nullif(current_setting('app.order_actor', true), ''), 'unknown');
begin
  if app.anonymizing() then
    if new.email <> 'anonimo-' || replace(new.id::text, '-', '') || '@anonimizado.invalid'
       or new.customer_name <> 'Anónimo' or new.phone is not null or new.customer_note is not null
       or new.shipping_address is distinct from app.anonymous_address(old.shipping_address)
       or new.billing_address is distinct from app.anonymous_address(old.billing_address)
       or (to_jsonb(new) - v_mutable - v_personal) is distinct from (to_jsonb(old) - v_mutable - v_personal) then
      raise exception using errcode = '42501', message = 'immutable', detail = 'orders';
    end if;
  elsif (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable)
     or (new.customer_id is distinct from old.customer_id and new.customer_id is not null)
     or (new.shipping_rate_id is distinct from old.shipping_rate_id and new.shipping_rate_id is not null)
     or (new.cart_id is distinct from old.cart_id and new.cart_id is not null) then
    raise exception using errcode = '42501', message = 'immutable', detail = 'orders';
  end if;
  perform app.assert_order_transition('status', old.status, new.status, v_actor);
  perform app.assert_order_transition('payment', old.payment_status, new.payment_status, v_actor);
  perform app.assert_order_transition('fulfillment', old.fulfillment_status, new.fulfillment_status, v_actor);
  if old.fulfillment_status = 'unfulfilled' and new.fulfillment_status <> 'unfulfilled'
     and new.payment_status not in ('paid', 'partially_refunded') then
    raise exception using errcode = 'P0001', message = 'invalid_transition', detail = 'fulfillment_requires_payment';
  end if;
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Opiniones: el nombre de quien opina solo puede pasar a «Anónimo», y solo así.
-- -----------------------------------------------------------------------------
drop trigger product_reviews_immutable on public.product_reviews;
create trigger product_reviews_immutable before update on public.product_reviews
  for each row execute function app.prevent_column_change('product_id', 'order_id', 'rating', 'title', 'body',
                                                          'created_at');
create function app.product_reviews_author_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_name is distinct from old.author_name
     and not (app.anonymizing() and new.author_name = 'Anónimo') then
    raise exception using errcode = '42501', message = 'column_immutable',
                          detail = 'public.product_reviews.author_name es inmutable';
  end if;
  return new;
end
$$;
revoke all on function app.product_reviews_author_guard() from public;
create trigger product_reviews_author_guard before update of author_name on public.product_reviews
  for each row execute function app.product_reviews_author_guard();

-- -----------------------------------------------------------------------------
-- 3. Anonimizar las tiendas cerradas hace más de 30 días (de a pocas por corrida).
-- -----------------------------------------------------------------------------
create function system.anonymize_closed_stores(p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_count integer := 0;
  v_orders integer;
  v_customers integer;
begin
  for v_store in
    select s.* from public.stores s
     where s.status = 'closed' and s.anonymized_at is null and s.closed_at < now() - interval '30 days'
     order by s.closed_at
     limit least(greatest(coalesce(p_limit, 5), 1), 50)
     for update skip locked
  loop
    perform set_config('app.anonymizing', 'on', true);

    update public.orders o
       set email = 'anonimo-' || replace(o.id::text, '-', '') || '@anonimizado.invalid',
           customer_name = 'Anónimo', phone = null, customer_note = null,
           shipping_address = app.anonymous_address(o.shipping_address),
           billing_address = app.anonymous_address(o.billing_address)
     where o.store_id = v_store.id
       and o.email <> 'anonimo-' || replace(o.id::text, '-', '') || '@anonimizado.invalid';
    get diagnostics v_orders = row_count;

    delete from public.customer_addresses a where a.store_id = v_store.id;
    -- Mismo resultado que «Borrar datos» de un cliente (customers_anonymize).
    update public.customers c
       set email = 'anonimo-' || replace(c.id::text, '-', '') || '@anonimizado.invalid',
           first_name = null, last_name = null, phone = null, note = null, user_id = null,
           accepts_marketing = false, marketing_consent_at = null, marketing_consent_source = null,
           anonymized_at = now()
     where c.store_id = v_store.id and c.anonymized_at is null;
    get diagnostics v_customers = row_count;

    update public.carts c set email = null, shipping_address = null
     where c.store_id = v_store.id and (c.email is not null or c.shipping_address is not null);
    update public.product_reviews r set author_name = 'Anónimo'
     where r.store_id = v_store.id and r.author_name is distinct from 'Anónimo';

    perform set_config('app.anonymizing', 'off', true);
    update public.stores s set anonymized_at = now() where s.id = v_store.id;
    perform audit.record('store.anonymized', 'store', v_store.id, v_store.organization_id, v_store.id, null,
                         jsonb_build_object('orders', v_orders, 'customers', v_customers),
                         'ADR-046: 30 días después del cierre');
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke all on function system.anonymize_closed_stores(integer) from public;
grant execute on function system.anonymize_closed_stores(integer) to system_worker;

-- -----------------------------------------------------------------------------
-- 4. Corre con el mantenimiento (misma función que 20261028000400, más el paso nuevo).
-- -----------------------------------------------------------------------------
create or replace function system.enqueue_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_job('media.purge_orphans', '{}'::jsonb, null,
                          'media.purge_orphans:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('orders.expire', '{}'::jsonb, null,
                          'orders.expire:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('rate_limits.purge', '{}'::jsonb, null,
                          'rate_limits.purge:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  perform app.enqueue_job('payments.reconcile', '{}'::jsonb, null,
                          'payments.reconcile:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 10) * interval '10 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
  perform app.enqueue_job('orders.complete', '{}'::jsonb, null,
                          'orders.complete:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now(), 3);
  -- Tanda 7: publicaciones programadas que ya vencieron.
  perform app.enqueue_job('catalog.publish_scheduled', '{}'::jsonb, null,
                          'catalog.publish_scheduled:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'),
                          now(), 3);
  -- ADR-030: ofertas con fechas que empiezan o terminan.
  perform app.enqueue_job('catalog.apply_sales', '{}'::jsonb, null,
                          'catalog.apply_sales:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'),
                          now(), 3);
  -- Paso 8: copias en varios tamaños de las fotos que aún no las tienen (por hora).
  if exists (select 1 from public.media m
              where m.status = 'ready' and not m.variants_done and m.deleted_at is null) then
    perform app.enqueue_job('media.backfill_variants', '{}'::jsonb, null,
                            'media.backfill_variants:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24'),
                            now(), 3);
  end if;
  perform system.fail_stuck_imports();
  -- F10: periodos vencidos → pago pendiente → pausa (§19.4). Solo toca filas vencidas.
  perform system.subscriptions_advance();
  -- ADR-041: llaves de Mercado Pago de los comercios que vencen en menos de 30 días.
  perform system.mercadopago_enqueue_refresh();
  -- ADR-046: datos personales de tiendas cerradas hace más de 30 días.
  perform system.anonymize_closed_stores(5);
  -- Misión vendible F1.6: revisión de salud cada 15 minutos (el job solo avisa si hay problemas).
  perform app.enqueue_job('platform.health_check', '{}'::jsonb, null,
                          'platform.health_check:' || to_char(date_trunc('hour', now() at time zone 'utc')
                            + floor(extract(minute from now() at time zone 'utc') / 15) * interval '15 minutes',
                            'YYYY-MM-DD"T"HH24:MI'), now(), 3);
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000600'::text
$$;
