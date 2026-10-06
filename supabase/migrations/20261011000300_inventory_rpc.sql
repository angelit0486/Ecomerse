-- =============================================================================
-- Fase 4 · Inventario: lecturas del panel (F4-T03)
-- Tabla de inventario con búsqueda (título o SKU) y filtro de stock bajo
-- (available <= umbral: comparar columnas no se puede por la Data API).
-- =============================================================================
create or replace function public.inventory_search(
  p_store_id  uuid,
  p_query     text default null,
  p_low_stock boolean default false,
  p_offset    integer default 0,
  p_limit     integer default 50
)
returns table (
  level_id            uuid,
  variant_id          uuid,
  product_id          uuid,
  product_title       text,
  option_signature    text,
  sku                 text,
  track_inventory     boolean,
  inventory_policy    text,
  on_hand             integer,
  reserved            integer,
  available           integer,
  low_stock_threshold integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform app.require_store_permission(p_store_id, 'inventory.read');
  return query
  select l.id, v.id, p.id, p.title, v.option_signature, v.sku, v.track_inventory, v.inventory_policy,
         l.on_hand, l.reserved, l.available, l.low_stock_threshold
    from public.inventory_levels l
    join public.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.is_default
    join public.product_variants v on v.store_id = l.store_id and v.id = l.variant_id and v.deleted_at is null
    join public.products p on p.store_id = v.store_id and p.id = v.product_id and p.deleted_at is null
   where l.store_id = p_store_id
     and (not coalesce(p_low_stock, false)
          or (v.track_inventory and l.low_stock_threshold is not null and l.available <= l.low_stock_threshold))
     and (v_q is null or v.sku = upper(v_q) or p.title ilike '%' || replace(replace(v_q, '%', '\%'), '_', '\_') || '%')
   order by p.title, v.position, v.option_signature, l.id
  offset greatest(coalesce(p_offset, 0), 0)
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

revoke all on function public.inventory_search(uuid, text, boolean, integer, integer) from public;
grant execute on function public.inventory_search(uuid, text, boolean, integer, integer) to authenticated;
