-- =============================================================================
-- Revisión del 2026-11-05 de la misión «mejoras»: correcciones confirmadas.
--   1. Devoluciones (ADR-061): al anonimizar una tienda cerrada (ADR-046) se
--      borran también la nota del cliente y el mensaje de la tienda; el guardia
--      de return_requests lo permite solo dentro de la anonimización.
--   2. Ajustes → Funciones: la tienda ya no reemplaza una excepción que puso la
--      plataforma para su tienda; la pantalla la muestra bloqueada.
--   3. Resumen semanal: «stock bajo» ordenado por número (antes como texto: 10
--      salía antes que 2).
--   4. Devoluciones: return_options dice si el plazo ya pasó (la página decía
--      «terminó» con un plazo aún vigente cuando no había nada por devolver).
-- Reversa: volver a las definiciones de 20261105000600 (guardia),
--   20261029001500 (anonimización), 20261104000400 (funciones de la tienda) y
--   20261105000300 (resumen). No cambia datos existentes.
-- =============================================================================

-- 1. Guardia: lo que pidió el cliente no se reescribe, salvo para borrar su nota
--    al anonimizar la tienda (marca local app.anonymizing, la de ADR-046).
create or replace function app.return_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id <> old.order_id or new.items <> old.items or new.reason <> old.reason
     or new.requested_at <> old.requested_at
     or (new.customer_note is distinct from old.customer_note
         and not (new.customer_note is null and coalesce(current_setting('app.anonymizing', true), '') = 'on')) then
    raise exception using errcode = '42501', message = 'append_only',
      detail = 'public.return_requests: lo que pidió el cliente no se modifica';
  end if;
  if new.status <> old.status and (old.status, new.status) not in
     (('requested', 'approved'), ('requested', 'rejected'), ('approved', 'received'),
      ('approved', 'closed'), ('received', 'closed')) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_status';
  end if;
  return new;
end
$$;

-- (anonimización de ADR-046 con las devoluciones)
create or replace function system.anonymize_closed_stores(p_limit integer default 5)
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

    -- Paso 2: las cuentas de Auth de sus compradores se revisan después (el
    -- vínculo se pierde al anonimizar). Solo se borra la que nadie más usa.
    insert into system.auth_user_purge_queue (user_id)
    select distinct c.user_id from public.customers c
     where c.store_id = v_store.id and c.user_id is not null
    on conflict (user_id) do nothing;

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
    -- ADR-061: lo que escribieron cliente y tienda en las devoluciones.
    update public.return_requests q set customer_note = null, customer_message = null
     where q.store_id = v_store.id and (q.customer_note is not null or q.customer_message is not null);

    perform set_config('app.anonymizing', 'off', true);
    update public.stores s set anonymized_at = now() where s.id = v_store.id;
    perform audit.record('store.anonymized', 'store', v_store.id, v_store.organization_id, v_store.id, null,
                         jsonb_build_object('orders', v_orders, 'customers', v_customers),
                         'ADR-046: 30 días después del cierre');
    v_count := v_count + 1;
  end loop;
  -- Paso 2: archivos pendientes de tiendas ya anonimizadas (cada hora). Las
  -- cuentas en cola esperan ADR-055; el job no se encola solo por ellas.
  if exists (select 1 from public.stores s where s.anonymized_at is not null and s.files_purged_at is null) then
    perform app.enqueue_job('privacy.purge_anonymized', '{}'::jsonb, null,
                            'privacy.purge_anonymized:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24'),
                            now(), 3);
  end if;
  return v_count;
end
$$;

-- 2. Una excepción de alcance `store` que puso la plataforma (cualquier motivo
--    distinto del que escribe la tienda) solo la cambia la plataforma.
create or replace function app.store_toggle_reason()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'La tienda lo cambió desde Ajustes → Funciones'::text
$$;
revoke all on function app.store_toggle_reason() from public;

create or replace function app.platform_store_override(p_key text, p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.feature_flag_overrides o
                  where o.flag_key = p_key and o.scope = 'store' and o.scope_id = p_store_id
                    and o.reason is distinct from app.store_toggle_reason()
                    and (o.expires_at is null or o.expires_at > now()))
$$;
revoke all on function app.platform_store_override(text, uuid) from public;

create or replace function public.store_features(p_store_id uuid)
returns table (key text, enabled boolean, locked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_store_permission(p_store_id, 'store.read') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  return query
    select f.key, app.flag_enabled(f.key, p_store_id),
           f.kill_switch or app.platform_store_override(f.key, p_store_id)
      from public.feature_flags f
     where f.store_toggle
     order by f.key;
end
$$;

create or replace function public.store_set_feature(p_store_id uuid, p_key text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_store_permission(p_store_id, 'store.update');
  v_flag public.feature_flags;
  v_org  uuid;
  v_was  boolean;
begin
  select * into v_flag from public.feature_flags f where f.key = p_key;
  if v_flag.key is null or not v_flag.store_toggle then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'feature';
  end if;
  if p_enabled is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'enabled';
  end if;
  if v_flag.kill_switch then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'kill_switch';
  end if;
  if app.platform_store_override(p_key, p_store_id) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'platform_override';
  end if;
  select s.organization_id into v_org from public.stores s where s.id = p_store_id;
  v_was := app.flag_enabled(p_key, p_store_id);

  insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason, created_by)
  values (p_key, 'store', p_store_id, p_enabled, app.store_toggle_reason(), v_uid)
  on conflict (flag_key, scope, scope_id) do update
    set enabled = excluded.enabled, expires_at = null, reason = excluded.reason, created_by = excluded.created_by;

  perform audit.record('store.feature_changed', 'feature_flag_override', null, v_org, p_store_id,
                       jsonb_build_object('key', p_key, 'enabled', v_was),
                       jsonb_build_object('key', p_key, 'enabled', p_enabled));
  return app.flag_enabled(p_key, p_store_id);
end
$$;

-- 3. Resumen semanal con «stock bajo» en orden numérico.
create or replace function system.weekly_summaries(p_after uuid, p_limit integer default 50)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store', jsonb_build_object('id', s.id, 'name', s.name, 'handle', s.handle,
                                'organization_id', s.organization_id, 'currency', s.currency),
    'recipients', to_jsonb(coalesce(
      nullif((select n.staff_emails from public.store_notification_settings n where n.store_id = s.id),
             '{}'::text[]),
      case when s.contact_email is not null then array[s.contact_email] else '{}'::text[] end)),
    'sales', (select coalesce(sum(o.total), 0) from public.orders o
               where o.store_id = s.id and o.paid_at >= now() - interval '7 days'),
    'orders', (select count(*) from public.orders o
                where o.store_id = s.id and o.paid_at >= now() - interval '7 days'),
    'sales_prev', (select coalesce(sum(o.total), 0) from public.orders o
                    where o.store_id = s.id and o.paid_at >= now() - interval '14 days'
                      and o.paid_at < now() - interval '7 days'),
    'refunds', (select coalesce(sum(r.amount), 0) from public.refunds r
                 where r.store_id = s.id and r.status = 'succeeded'
                   and r.updated_at >= now() - interval '7 days'),
    'to_fulfill', (select count(*) from public.orders o
                    where o.store_id = s.id and o.status = 'open'
                      and o.fulfillment_status in ('unfulfilled', 'partially_fulfilled')),
    'needs_attention', (select count(*) from public.orders o
                         where o.store_id = s.id and o.needs_attention),
    'pending_payment', (select count(*) from public.orders o
                         where o.store_id = s.id and o.status = 'pending_payment'),
    'abandoned_carts', (select count(*) from public.carts c
                         where c.store_id = s.id and c.status = 'abandoned'
                           and c.last_activity_at >= now() - interval '7 days'),
    'low_stock', (select coalesce(jsonb_agg(x order by (x ->> 'available')::integer, x ->> 'title'), '[]'::jsonb)
                    from (select jsonb_build_object('title', p.title, 'sku', v.sku,
                                                    'available', l.available) as x
                            from public.inventory_levels l
                            join public.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
                                                          and v.deleted_at is null
                            join public.products p on p.store_id = v.store_id and p.id = v.product_id
                                                  and p.deleted_at is null
                           where l.store_id = s.id and l.low_stock_threshold is not null
                             and l.available <= l.low_stock_threshold
                           order by l.available, l.id limit 5) t),
    'top_products', (select coalesce(jsonb_agg(t order by (t ->> 'quantity')::integer desc, t ->> 'title'),
                                     '[]'::jsonb)
                       from (select jsonb_build_object('title', min(i.product_title),
                                                       'quantity', sum(i.quantity)::integer) as t
                               from public.order_items i
                               join public.orders o on o.store_id = i.store_id and o.id = i.order_id
                              where o.store_id = s.id and o.paid_at >= now() - interval '7 days'
                              group by coalesce(i.product_id::text, i.product_title)
                              order by sum(i.quantity) desc limit 3) q))
    from public.stores s
   where s.status = 'active'
     and (p_after is null or s.id > p_after)
     and app.flag_enabled('weekly_summary', s.id)
   order by s.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- 4. Devoluciones: si el plazo ya pasó, según la base.
create or replace function storefront.return_options(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_deadline timestamptz;
  v_last     public.return_requests;
begin
  if not app.flag_enabled('returns', p_store_id) then
    return null;
  end if;
  select * into v_order from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and p_token_hash is not null and o.guest_access_token_hash = p_token_hash;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  v_deadline := app.return_deadline(p_store_id, p_order_id);
  select * into v_last from public.return_requests q
   where q.store_id = p_store_id and q.order_id = p_order_id
   order by q.requested_at desc, q.id desc limit 1;
  return jsonb_build_object(
    'deadline', v_deadline,
    -- La base decide si el plazo ya pasó (la página no compara con su reloj).
    'window_closed', v_deadline is not null and now() > v_deadline,
    'open', v_deadline is not null and now() <= v_deadline
            and v_order.payment_status in ('paid', 'partially_refunded')
            and (v_last.id is null or v_last.status in ('rejected', 'closed')),
    'window_days', (select s.return_window_days from public.stores s where s.id = p_store_id),
    'last', case when v_last.id is null then null else app.return_public(v_last) end,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'order_item_id', i.id, 'title', i.product_title, 'variant', i.variant_title,
                'available', a.available) order by i.position), '[]'::jsonb)
                from app.return_available(p_store_id, p_order_id) a
                join public.order_items i on i.store_id = p_store_id and i.id = a.order_item_id
               where a.available > 0));
end
$$;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000900'::text
$$;
