-- =============================================================================
-- ADR-029 · Al marcar un envío como entregado se encola `order.delivered`: el
-- comprador recibe el aviso de entrega con la invitación a opinar sobre su
-- compra desde la página de su pedido. El resto de la función no cambia.
-- =============================================================================
create or replace function public.orders_mark_delivered(p_store_id uuid, p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ship  public.shipments;
  v_order public.orders;
begin
  perform app.require_store_permission(p_store_id, 'orders.fulfill');
  select * into v_ship from public.shipments s where s.store_id = p_store_id and s.id = p_shipment_id;
  if v_ship.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'shipment';
  end if;
  select * into v_order from public.orders o where o.id = v_ship.order_id for update;
  -- Con el pedido bloqueado se vuelve a leer el envío (dos clics simultáneos).
  select * into v_ship from public.shipments s where s.id = v_ship.id for update;
  if v_ship.status = 'delivered' then
    return;
  end if;
  if v_ship.status <> 'shipped' then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'shipment_not_shipped';
  end if;
  update public.shipments set status = 'delivered', delivered_at = now() where id = v_ship.id;
  perform app.set_order_actor('staff');
  if v_order.status = 'open' and v_order.fulfillment_status = 'fulfilled' and not v_order.needs_attention
     and not exists (select 1 from public.refunds r where r.order_id = v_order.id and r.status = 'pending')
     and not exists (select 1 from public.shipments s where s.order_id = v_order.id and s.status = 'shipped') then
    update public.orders set status = 'completed', completed_at = now() where id = v_order.id;
  end if;
  insert into public.order_events (store_id, order_id, type, message, customer_visible, actor_type, actor_user_id)
  values (p_store_id, v_order.id, 'order.delivered', 'Pedido entregado', true, 'staff', auth.uid());
  -- Aviso al comprador con la invitación a opinar (ADR-029); una vez por envío.
  perform app.enqueue_job('order.delivered', jsonb_build_object('order_id', v_order.id, 'shipment_id', v_ship.id),
                          p_store_id, 'order.delivered:' || v_ship.id);
end
$$;

revoke all on function public.orders_mark_delivered(uuid, uuid) from public;
grant execute on function public.orders_mark_delivered(uuid, uuid) to authenticated;
