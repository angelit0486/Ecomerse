-- =============================================================================
-- ADR-025 · Inventario: lo que hay a la venta con proveedores.
--
-- Inventario muestra la bodega principal (en mano, reservado, disponible). Con
-- despacho directo, una variante puede estar en venta con 0 propias: la página
-- decía «Disponible 0» mientras la tienda la vendía. Esta función devuelve, por
-- variante, lo disponible y reservado en ubicaciones de proveedor ACTIVAS
-- (cantidades solamente: ni proveedor ni costos, que exigen products.cost.read).
-- Lectura con inventory.read, como inventory_search.
-- =============================================================================
create or replace function public.inventory_supplier_totals(p_store_id uuid, p_variant_ids uuid[])
returns table (variant_id uuid, available integer, reserved integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'inventory.read');
  if p_variant_ids is null or cardinality(p_variant_ids) = 0 then
    return;
  end if;
  if cardinality(p_variant_ids) > 200 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'variant_ids';
  end if;
  return query
  select l.variant_id, sum(l.available)::integer, sum(l.reserved)::integer
    from public.inventory_levels l
    join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
   where l.store_id = p_store_id and l.variant_id = any (p_variant_ids)
     and loc.kind = 'supplier' and loc.is_active
   group by l.variant_id;
end
$$;
revoke all on function public.inventory_supplier_totals(uuid, uuid[]) from public;
grant execute on function public.inventory_supplier_totals(uuid, uuid[]) to authenticated;
