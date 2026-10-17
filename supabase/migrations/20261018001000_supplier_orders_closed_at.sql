-- =============================================================================
-- ADR-025 paso 2 · Corrección (revisión adversarial): volver a guardar los datos
-- de un despacho ya entregado o cancelado (guía, nota) no debe mover su fecha de
-- cierre. Mismo contrato que 20261018000800; solo cambia closed_at, que ahora
-- conserva la primera fecha (como requested_at, confirmed_at, shipped_at y
-- delivered_at).
-- =============================================================================

create or replace function public.supplier_orders_set_status(p_store_id uuid, p_supplier_order_id uuid,
                                                             p_status text, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_store_permission(p_store_id, 'orders.update');
  v_so     public.supplier_orders;
  v_data   jsonb := coalesce(p_data, '{}'::jsonb);
  v_ref    text;
  v_car    text;
  v_trk    text;
  v_url    text;
  v_note   text;
  v_sup    text;
  v_labels constant jsonb := '{"pending":"pendiente","requested":"solicitado al proveedor",
    "confirmed":"confirmado por el proveedor","shipped":"enviado por el proveedor","delivered":"entregado",
    "failed":"con problema","cancelled":"cancelado"}';
begin
  if jsonb_typeof(v_data) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'data';
  end if;
  if p_status is null or not (v_labels ? p_status) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  select * into v_so from public.supplier_orders so
   where so.store_id = p_store_id and so.id = p_supplier_order_id for update;
  if v_so.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'supplier_order';
  end if;

  v_ref  := case when v_data ? 'external_reference' then nullif(btrim(v_data ->> 'external_reference'), '')
                 else v_so.external_reference end;
  v_car  := case when v_data ? 'carrier' then nullif(btrim(v_data ->> 'carrier'), '') else v_so.carrier end;
  v_trk  := case when v_data ? 'tracking_number' then nullif(btrim(v_data ->> 'tracking_number'), '')
                 else v_so.tracking_number end;
  v_url  := case when v_data ? 'tracking_url' then nullif(btrim(v_data ->> 'tracking_url'), '')
                 else v_so.tracking_url end;
  v_note := case when v_data ? 'note' then nullif(btrim(v_data ->> 'note'), '') else v_so.note end;
  if v_ref is not null and (char_length(v_ref) > 100 or v_ref ~ '[[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'external_reference';
  end if;
  if v_car is not null and (char_length(v_car) > 80 or v_car ~ '[[:cntrl:]]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'carrier';
  end if;
  if v_trk is not null and v_trk !~ '^[A-Za-z0-9 -]{3,60}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'tracking_number';
  end if;
  if v_url is not null and (v_url !~ '^https://[^\s<>"]+$' or char_length(v_url) > 500) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'tracking_url';
  end if;
  if v_note is not null and (char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'note';
  end if;

  if p_status = v_so.status and v_ref is not distinct from v_so.external_reference
     and v_car is not distinct from v_so.carrier and v_trk is not distinct from v_so.tracking_number
     and v_url is not distinct from v_so.tracking_url and v_note is not distinct from v_so.note then
    return app.supplier_order_json(v_so);
  end if;

  begin
    update public.supplier_orders
       set status = p_status, external_reference = v_ref, carrier = v_car, tracking_number = v_trk,
           tracking_url = v_url, note = v_note,
           requested_at = case when p_status in ('requested', 'confirmed', 'shipped', 'delivered')
                               then coalesce(requested_at, now()) else requested_at end,
           confirmed_at = case when p_status in ('confirmed', 'shipped', 'delivered')
                               then coalesce(confirmed_at, now()) else confirmed_at end,
           shipped_at   = case when p_status in ('shipped', 'delivered') then coalesce(shipped_at, now())
                               else shipped_at end,
           delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
           closed_at    = case when p_status in ('delivered', 'cancelled') then coalesce(closed_at, now())
                               when p_status = 'pending' then null else closed_at end
     where id = v_so.id
     returning * into v_so;
  exception when check_violation then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'invalid_transition';
  end;

  select s.name into v_sup from public.suppliers s where s.store_id = p_store_id and s.id = v_so.supplier_id;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id,
                                   metadata)
  values (p_store_id, v_so.order_id, 'supplier_order.updated',
          left(format('Despacho con %s: %s', v_sup, v_labels ->> p_status), 1000), false, 'staff', v_uid,
          jsonb_build_object('supplier_order_id', v_so.id, 'status', p_status));
  perform audit.record('supplier_order.updated', 'supplier_order', v_so.id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('status', p_status, 'order_id', v_so.order_id));
  return app.supplier_order_json(v_so);
end
$$;
revoke all on function public.supplier_orders_set_status(uuid, uuid, text, jsonb) from public;
grant execute on function public.supplier_orders_set_status(uuid, uuid, text, jsonb) to authenticated;
