-- =============================================================================
-- ADR-061 (aprobado el 2026-11-05): devoluciones, detrás del interruptor por
-- tienda `returns` (apagado; la tienda lo enciende en Ajustes → Funciones).
--   * El cliente la pide desde la página de su pedido (enlace con token), con
--     motivo, unidades y nota, dentro del plazo de la tienda (30 días por defecto,
--     contados desde la última entrega o, si no se marcó, el último envío).
--   * La tienda aprueba o rechaza (con mensaje para el cliente), registra que la
--     recibió y reembolsa por el flujo de reembolsos que ya existe
--     (app.request_refund: mismo dinero, misma idempotencia, reposición opcional),
--     o la cierra sin reembolso (cambio o sin devolución de dinero).
--   * Una solicitud abierta por pedido. Nada se borra; las partidas y el motivo
--     no se reescriben. Correos al cliente y a la tienda; auditoría.
-- Reversa: `update public.feature_flags set kill_switch = true where key =
--   'returns'` lo apaga en todas las tiendas (la tabla queda, sin usarse).
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner, store_toggle) values
  ('returns', 'Devoluciones: el cliente las pide desde su pedido y la tienda las aprueba, recibe y reembolsa',
   false, 'plataforma', true)
on conflict (key) do nothing;

-- Plazo para pedir una devolución, por tienda.
alter table public.stores add column return_window_days smallint not null default 30
  check (return_window_days between 1 and 365);

create table public.return_requests (
  id               uuid primary key default app.uuid_v7(),
  store_id         uuid not null references public.stores (id) on delete restrict,
  order_id         uuid not null,
  status           text not null default 'requested'
                   check (status in ('requested', 'approved', 'rejected', 'received', 'closed')),
  reason           text not null
                   check (reason in ('damaged', 'wrong_item', 'not_as_described', 'no_longer_needed', 'other')),
  customer_note    text check (customer_note is null or char_length(customer_note) <= 1000),
  -- [{order_item_id, quantity}]: lo que el cliente quiere devolver.
  items            jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  -- Lo que la tienda le dice al cliente (instrucciones al aprobar, motivo al rechazar).
  customer_message text check (customer_message is null or char_length(customer_message) <= 1000),
  resolution       text check (resolution is null or resolution in ('refund', 'exchange', 'none')),
  refund_id        uuid,
  restock          boolean,
  requested_at     timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid,
  received_at      timestamptz,
  received_by      uuid,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict,
  foreign key (store_id, refund_id) references public.refunds (store_id, id) on delete restrict,
  check ((status = 'closed') = (closed_at is not null and resolution is not null)),
  check ((resolution = 'refund') = (refund_id is not null))
);
-- Una sola solicitud abierta por pedido.
create unique index return_requests_open_uq on public.return_requests (store_id, order_id)
  where status in ('requested', 'approved', 'received');
create index return_requests_store_idx on public.return_requests (store_id, status, requested_at desc, id desc);
create index return_requests_order_idx on public.return_requests (store_id, order_id);
create index return_requests_refund_idx on public.return_requests (store_id, refund_id) where refund_id is not null;

create trigger return_requests_set_updated_at before update on public.return_requests
  for each row execute function app.set_updated_at();
create trigger return_requests_prevent_tenant_change before update on public.return_requests
  for each row execute function app.prevent_tenant_change();
create trigger return_requests_no_delete before delete on public.return_requests
  for each row execute function app.forbid_mutation();

-- Lo que pidió el cliente no se reescribe y el estado solo avanza.
create function app.return_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id <> old.order_id or new.items <> old.items or new.reason <> old.reason
     or new.customer_note is distinct from old.customer_note or new.requested_at <> old.requested_at then
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
revoke all on function app.return_requests_guard() from public;
create trigger return_requests_guard before update on public.return_requests
  for each row execute function app.return_requests_guard();

alter table public.return_requests enable row level security;
alter table public.return_requests force row level security;
revoke all on table public.return_requests from public, anon, authenticated, service_role;
grant select on table public.return_requests to authenticated;
create policy return_requests_select on public.return_requests for select to authenticated
  using (app.has_store_permission(store_id, 'orders.read'));

-- -----------------------------------------------------------------------------
-- Reglas comunes.
-- -----------------------------------------------------------------------------

-- Fecha límite: el último paquete (su entrega o, si no se marcó, su envío) +
-- el plazo de la tienda. Sin envíos, no hay devolución.
create function app.return_deadline(p_store_id uuid, p_order_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(coalesce(sh.delivered_at, sh.shipped_at))
         + make_interval(days => (select s.return_window_days from public.stores s where s.id = p_store_id))
    from public.shipments sh
   where sh.store_id = p_store_id and sh.order_id = p_order_id and sh.status in ('shipped', 'delivered')
$$;

-- Unidades que aún se pueden devolver por renglón: enviadas − reembolsadas − en
-- reembolsos pendientes − en la solicitud abierta.
create function app.return_available(p_store_id uuid, p_order_id uuid)
returns table (order_item_id uuid, available integer)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         greatest(i.fulfilled_quantity - i.refunded_quantity
           - coalesce((select sum((y ->> 'quantity')::integer) from public.refunds r, jsonb_array_elements(r.items) y
                        where r.store_id = i.store_id and r.order_id = i.order_id and r.status = 'pending'
                          and y ->> 'order_item_id' = i.id::text), 0)
           - coalesce((select sum((y ->> 'quantity')::integer) from public.return_requests q, jsonb_array_elements(q.items) y
                        where q.store_id = i.store_id and q.order_id = i.order_id
                          and q.status in ('requested', 'approved', 'received')
                          and y ->> 'order_item_id' = i.id::text), 0), 0)::integer
    from public.order_items i
   where i.store_id = p_store_id and i.order_id = p_order_id
$$;

-- Lo que el cliente ve de una solicitud (sin datos del personal).
create function app.return_public(p_return public.return_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_return.id, 'status', p_return.status, 'reason', p_return.reason,
    'requested_at', p_return.requested_at, 'customer_message', p_return.customer_message,
    'resolution', p_return.resolution,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'title', i.product_title, 'variant', i.variant_title, 'quantity', (x ->> 'quantity')::integer)
                order by i.position), '[]'::jsonb)
                from jsonb_array_elements(p_return.items) x
                join public.order_items i on i.store_id = p_return.store_id and i.id::text = x ->> 'order_item_id'))
$$;

-- -----------------------------------------------------------------------------
-- Tienda (storefront_gateway): el cliente con el enlace de su pedido.
-- -----------------------------------------------------------------------------

-- Opciones de devolución del pedido; null si la tienda no las ofrece.
create function storefront.return_options(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
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

create function storefront.request_return(p_store_id uuid, p_order_id uuid, p_token_hash bytea, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_deadline timestamptz;
  v_reason   text := p_request ->> 'reason';
  v_note     text := nullif(btrim(coalesce(p_request ->> 'note', '')), '');
  v_items    jsonb := p_request -> 'items';
  v_line     record;
  v_return   public.return_requests;
begin
  if not app.flag_enabled('returns', p_store_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'returns';
  end if;
  select * into v_order from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and p_token_hash is not null and o.guest_access_token_hash = p_token_hash
   for update;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  if not app.rate_limit_take('return:' || p_order_id, 10, 3600) then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;
  v_deadline := app.return_deadline(p_store_id, p_order_id);
  if v_order.payment_status not in ('paid', 'partially_refunded') or v_deadline is null or now() > v_deadline then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_window';
  end if;
  if exists (select 1 from public.return_requests q
              where q.store_id = p_store_id and q.order_id = p_order_id
                and q.status in ('requested', 'approved', 'received')) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_open';
  end if;
  if v_reason is null or v_reason not in ('damaged', 'wrong_item', 'not_as_described', 'no_longer_needed', 'other') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reason';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'note';
  end if;
  -- Partidas: renglones del pedido, sin repetir, enteros positivos y no más de lo disponible.
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 100
     or exists (select 1 from jsonb_array_elements(v_items) x
                 where jsonb_typeof(x) <> 'object' or coalesce(jsonb_typeof(x -> 'quantity'), '') <> 'number'
                    or (x ->> 'quantity')::numeric <> floor((x ->> 'quantity')::numeric)
                    or (x ->> 'quantity')::numeric < 1)
     or (select count(*) from jsonb_array_elements(v_items))
        <> (select count(distinct x ->> 'order_item_id') from jsonb_array_elements(v_items) x) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
  end if;
  for v_line in
    select x ->> 'order_item_id' as item, (x ->> 'quantity')::integer as q, a.available
      from jsonb_array_elements(v_items) x
      left join app.return_available(p_store_id, p_order_id) a on a.order_item_id::text = x ->> 'order_item_id'
  loop
    if v_line.available is null or v_line.q > v_line.available then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'items';
    end if;
  end loop;
  insert into public.return_requests (store_id, order_id, reason, customer_note, items)
  values (p_store_id, p_order_id, v_reason, v_note,
          (select jsonb_agg(jsonb_build_object('order_item_id', (x ->> 'order_item_id')::uuid,
                                               'quantity', (x ->> 'quantity')::integer))
             from jsonb_array_elements(v_items) x))
  returning * into v_return;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, metadata)
  values (p_store_id, p_order_id, 'return.requested', 'Devolución solicitada', true, 'customer',
          jsonb_build_object('return_id', v_return.id, 'reason', v_reason));
  perform app.enqueue_job('return.requested',
                          jsonb_build_object('order_id', p_order_id, 'return_id', v_return.id), p_store_id,
                          'return.requested:' || v_return.id);
  return app.return_public(v_return);
end
$$;

-- -----------------------------------------------------------------------------
-- Panel (authenticated): cada función revisa su permiso en la tienda.
-- -----------------------------------------------------------------------------

create function app.return_for_update(p_store_id uuid, p_return_id uuid)
returns public.return_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.return_requests;
begin
  select * into v_return from public.return_requests q
   where q.store_id = p_store_id and q.id = p_return_id for update;
  if v_return.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'return';
  end if;
  return v_return;
end
$$;

-- Lista por estado, con cuántas hay en cada uno.
create function public.returns_list(p_store_id uuid, p_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'orders.read');
  if p_status is null or p_status not in ('requested', 'approved', 'received', 'closed', 'rejected') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb)
                 from (select q.status, count(*) as n from public.return_requests q
                        where q.store_id = p_store_id group by q.status) c),
    'items', (select coalesce(jsonb_agg(t.item order by t.requested_at desc, t.id desc), '[]'::jsonb)
                from (select q.id, q.requested_at, jsonb_build_object(
                        'id', q.id, 'status', q.status, 'reason', q.reason, 'requested_at', q.requested_at,
                        'units', (select sum((y ->> 'quantity')::integer) from jsonb_array_elements(q.items) y),
                        'order', jsonb_build_object('id', o.id, 'display_number', o.display_number,
                                                    'customer_name', o.customer_name)) as item
                        from public.return_requests q
                        join public.orders o on o.store_id = q.store_id and o.id = q.order_id
                       where q.store_id = p_store_id and q.status = p_status
                       order by q.requested_at desc, q.id desc
                       limit 100) t));
end
$$;

-- Detalle para decidir: partidas con su precio, lo cobrado y lo reembolsable.
create function public.returns_get(p_store_id uuid, p_return_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_return public.return_requests;
  v_order  public.orders;
  v_pending bigint;
begin
  perform app.require_store_permission(p_store_id, 'orders.read');
  select * into v_return from public.return_requests q where q.store_id = p_store_id and q.id = p_return_id;
  if v_return.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'return';
  end if;
  select * into v_order from public.orders o where o.store_id = p_store_id and o.id = v_return.order_id;
  select coalesce(sum(r.amount), 0) into v_pending from public.refunds r
   where r.store_id = p_store_id and r.order_id = v_order.id and r.status = 'pending';
  return jsonb_build_object(
    'id', v_return.id, 'status', v_return.status, 'reason', v_return.reason,
    'customer_note', v_return.customer_note, 'customer_message', v_return.customer_message,
    'resolution', v_return.resolution, 'restock', v_return.restock,
    'requested_at', v_return.requested_at, 'decided_at', v_return.decided_at,
    'received_at', v_return.received_at, 'closed_at', v_return.closed_at,
    'refund', (select jsonb_build_object('id', r.id, 'amount', r.amount, 'status', r.status)
                 from public.refunds r where r.store_id = p_store_id and r.id = v_return.refund_id),
    'order', jsonb_build_object('id', v_order.id, 'display_number', v_order.display_number,
                                'customer_name', v_order.customer_name, 'currency', v_order.currency,
                                'payment_status', v_order.payment_status,
                                'refundable', greatest(v_order.paid_total - v_order.refunded_total - v_pending, 0)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'order_item_id', i.id, 'title', i.product_title, 'variant', i.variant_title, 'sku', i.sku,
                'quantity', (x ->> 'quantity')::integer, 'ordered', i.quantity,
                -- Parte proporcional del renglón (con su descuento); la tienda puede ajustarla.
                'amount', round(i.line_total::numeric * (x ->> 'quantity')::integer / i.quantity)::bigint)
                order by i.position), '[]'::jsonb)
                from jsonb_array_elements(v_return.items) x
                join public.order_items i on i.store_id = p_store_id and i.id::text = x ->> 'order_item_id'));
end
$$;

-- Aprobar o rechazar, con mensaje para el cliente (instrucciones o motivo).
create function public.returns_decide(p_store_id uuid, p_return_id uuid, p_approve boolean, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return  public.return_requests;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  perform app.require_store_permission(p_store_id, 'orders.refund');
  v_return := app.return_for_update(p_store_id, p_return_id);
  if v_return.status <> 'requested' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_status';
  end if;
  if p_approve is null or (v_message is not null and char_length(v_message) > 1000) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'message';
  end if;
  if not p_approve and v_message is null then
    -- Rechazar sin decir por qué deja al cliente sin respuesta.
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'message';
  end if;
  update public.return_requests q
     set status = case when p_approve then 'approved' else 'rejected' end,
         customer_message = v_message, decided_at = now(), decided_by = auth.uid()
   where q.id = v_return.id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id, metadata)
  values (p_store_id, v_return.order_id, case when p_approve then 'return.approved' else 'return.rejected' end,
          case when p_approve then 'Devolución aprobada' else 'Devolución rechazada' end, true, 'staff', auth.uid(),
          jsonb_build_object('return_id', v_return.id));
  perform app.enqueue_job(case when p_approve then 'return.approved' else 'return.rejected' end,
                          jsonb_build_object('order_id', v_return.order_id, 'return_id', v_return.id), p_store_id,
                          'return.decided:' || v_return.id);
  perform audit.record(case when p_approve then 'order.return_approved' else 'order.return_rejected' end,
                       'return_request', v_return.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('status', v_return.status),
                       jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end));
end
$$;

-- La tienda ya tiene el paquete de vuelta.
create function public.returns_receive(p_store_id uuid, p_return_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.return_requests;
begin
  perform app.require_store_permission(p_store_id, 'orders.fulfill');
  v_return := app.return_for_update(p_store_id, p_return_id);
  if v_return.status <> 'approved' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_status';
  end if;
  update public.return_requests q set status = 'received', received_at = now(), received_by = auth.uid()
   where q.id = v_return.id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id, metadata)
  values (p_store_id, v_return.order_id, 'return.received', 'Devolución recibida', true, 'staff', auth.uid(),
          jsonb_build_object('return_id', v_return.id));
  perform audit.record('order.return_received', 'return_request', v_return.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'received'));
end
$$;

-- Reembolsar lo devuelto por el flujo de siempre (app.request_refund valida monto,
-- unidades e idempotencia; con reposición, el inventario vuelve al confirmarse).
create function public.returns_refund(p_store_id uuid, p_return_id uuid, p_amount bigint, p_restock boolean,
                                      p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.return_requests;
  v_order  public.orders;
  v_refund uuid;
begin
  perform app.require_store_permission(p_store_id, 'orders.refund');
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'idempotency_key';
  end if;
  v_return := app.return_for_update(p_store_id, p_return_id);
  -- Repetición del mismo envío del formulario: el mismo reembolso.
  if v_return.status = 'closed' and v_return.refund_id is not null
     and exists (select 1 from public.refunds r where r.store_id = p_store_id and r.id = v_return.refund_id
                    and r.idempotency_key = p_idempotency_key) then
    return v_return.refund_id;
  end if;
  if v_return.status not in ('approved', 'received') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_status';
  end if;
  select * into v_order from public.orders o where o.store_id = p_store_id and o.id = v_return.order_id for update;
  v_refund := app.request_refund(v_order, p_amount, v_return.items, coalesce(p_restock, false),
                                 'Devolución ' || v_order.display_number, p_idempotency_key);
  update public.return_requests q
     set status = 'closed', resolution = 'refund', refund_id = v_refund, restock = coalesce(p_restock, false),
         closed_at = now()
   where q.id = v_return.id;
  perform audit.record('order.return_refunded', 'return_request', v_return.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('status', v_return.status),
                       jsonb_build_object('status', 'closed', 'refund_id', v_refund, 'amount', p_amount,
                                          'restock', coalesce(p_restock, false)));
  return v_refund;
end
$$;

-- Cerrar sin reembolso: cambio por otro producto o sin devolución de dinero.
create function public.returns_close(p_store_id uuid, p_return_id uuid, p_resolution text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return  public.return_requests;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  perform app.require_store_permission(p_store_id, 'orders.refund');
  if p_resolution is null or p_resolution not in ('exchange', 'none') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'resolution';
  end if;
  if v_message is not null and char_length(v_message) > 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'message';
  end if;
  v_return := app.return_for_update(p_store_id, p_return_id);
  if v_return.status not in ('approved', 'received') then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'return_status';
  end if;
  update public.return_requests q
     set status = 'closed', resolution = p_resolution, closed_at = now(),
         customer_message = coalesce(v_message, q.customer_message)
   where q.id = v_return.id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id, metadata)
  values (p_store_id, v_return.order_id, 'return.closed',
          case when p_resolution = 'exchange' then 'Devolución cerrada con cambio' else 'Devolución cerrada' end,
          true, 'staff', auth.uid(), jsonb_build_object('return_id', v_return.id, 'resolution', p_resolution));
  perform audit.record('order.return_closed', 'return_request', v_return.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('status', v_return.status),
                       jsonb_build_object('status', 'closed', 'resolution', p_resolution));
end
$$;

-- Plazo de devolución de la tienda.
create function public.returns_set_window(p_store_id uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before smallint;
begin
  perform app.require_store_permission(p_store_id, 'store.update');
  if p_days is null or p_days not between 1 and 365 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'days';
  end if;
  select s.return_window_days into v_before from public.stores s where s.id = p_store_id for update;
  update public.stores s set return_window_days = p_days where s.id = p_store_id;
  perform audit.record('store.return_window_changed', 'store', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('return_window_days', v_before),
                       jsonb_build_object('return_window_days', p_days));
end
$$;

-- -----------------------------------------------------------------------------
-- Correos (system_worker): datos de la solicitud para la plantilla.
-- -----------------------------------------------------------------------------
create function system.return_notification(p_return_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.return_public(q) || jsonb_build_object('order_id', q.order_id, 'customer_note', q.customer_note)
    from public.return_requests q where q.id = p_return_id
$$;

revoke all on function app.return_deadline(uuid, uuid) from public;
revoke all on function app.return_available(uuid, uuid) from public;
revoke all on function app.return_public(public.return_requests) from public;
revoke all on function app.return_for_update(uuid, uuid) from public;
revoke all on function storefront.return_options(uuid, uuid, bytea) from public;
revoke all on function storefront.request_return(uuid, uuid, bytea, jsonb) from public;
revoke all on function public.returns_list(uuid, text) from public;
revoke all on function public.returns_get(uuid, uuid) from public;
revoke all on function public.returns_decide(uuid, uuid, boolean, text) from public;
revoke all on function public.returns_receive(uuid, uuid) from public;
revoke all on function public.returns_refund(uuid, uuid, bigint, boolean, text) from public;
revoke all on function public.returns_close(uuid, uuid, text, text) from public;
revoke all on function public.returns_set_window(uuid, integer) from public;
revoke all on function system.return_notification(uuid) from public;
grant execute on function storefront.return_options(uuid, uuid, bytea) to storefront_gateway;
grant execute on function storefront.request_return(uuid, uuid, bytea, jsonb) to storefront_gateway;
grant execute on function public.returns_list(uuid, text) to authenticated;
grant execute on function public.returns_get(uuid, uuid) to authenticated;
grant execute on function public.returns_decide(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.returns_receive(uuid, uuid) to authenticated;
grant execute on function public.returns_refund(uuid, uuid, bigint, boolean, text) to authenticated;
grant execute on function public.returns_close(uuid, uuid, text, text) to authenticated;
grant execute on function public.returns_set_window(uuid, integer) to authenticated;
grant execute on function system.return_notification(uuid) to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000600'::text
$$;
