-- Misión vendible F3 (panel a escala): la vista previa de una importación dice
-- qué cambia, no solo cuántos productos se actualizan. Con 1000 productos, «1000
-- por actualizar» no deja ver que el archivo sube precios o reemplaza existencias
-- (las del archivo son absolutas, GATE0 §26.1 paso 7). Solo lectura: no toca el
-- contrato de importación ni el inventario.

create or replace function public.import_preview_changes(p_store_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stock boolean;
  v_result jsonb;
begin
  perform app.require_store_permission(p_store_id, 'imports.run');
  -- Las existencias de hoy solo se muestran a quien puede leerlas.
  v_stock := app.has_store_permission(p_store_id, 'inventory.read');

  -- Antes de confirmar, la fila aún no tiene entity_id: el producto se busca por
  -- handle y la presentación con el mismo ayudante que usa la confirmación.
  with file_products as (
    select p.id as product_id, p.title, p.status, r.normalized
      from public.import_job_rows r
      join public.products p
        on p.store_id = p_store_id and p.slug = r.normalized ->> 'handle' and p.deleted_at is null
     where r.store_id = p_store_id and r.import_job_id = p_job_id
       and r.action = 'update' and r.normalized is not null
  ), file_variants as (
    select fp.product_id, fp.title, x ->> 'sku' as sku,
           (x ->> 'price')::bigint as price, (x ->> 'quantity')::integer as quantity,
           app.import_find_variant(fp.product_id, x ->> 'sku', coalesce(x -> 'options', '{}'::jsonb)) as variant_id
      from file_products fp
      cross join lateral jsonb_array_elements(fp.normalized -> 'variants') x
  ), matched as (
    select f.*, v.price as current_price,
           case when v_stock then l.on_hand end as current_quantity,
           f.variant_id is not null as is_known
      from file_variants f
      left join public.product_variants v on v.store_id = p_store_id and v.id = f.variant_id
      left join public.inventory_locations loc on loc.store_id = p_store_id and loc.is_default
      left join public.inventory_levels l
        on l.store_id = p_store_id and l.variant_id = f.variant_id and l.location_id = loc.id
  ), product_status as (
    select count(*) filter (where fp.normalized ? 'status' and fp.status is distinct from (fp.normalized ->> 'status')) as n
      from file_products fp
  )
  select jsonb_build_object(
    'price_changes', count(*) filter (where is_known and price is not null and price <> current_price),
    'price_up', count(*) filter (where is_known and price > current_price),
    'price_down', count(*) filter (where is_known and price < current_price),
    'price_examples', coalesce((
      select jsonb_agg(e) from (
        select jsonb_build_object('title', m.title, 'sku', m.sku, 'from', m.current_price, 'to', m.price) as e
          from matched m
         where m.is_known and m.price is not null and m.price <> m.current_price
         order by abs(m.price - m.current_price)::numeric / greatest(m.current_price, 1) desc, m.sku
         limit 5) s), '[]'::jsonb),
    'stock_visible', v_stock,
    'stock_changes', case when v_stock then count(*) filter (
      where is_known and quantity is not null and quantity is distinct from current_quantity) end,
    'stock_examples', case when v_stock then coalesce((
      select jsonb_agg(e) from (
        select jsonb_build_object('title', m.title, 'sku', m.sku, 'from', m.current_quantity, 'to', m.quantity) as e
          from matched m
         where m.is_known and m.quantity is not null and m.quantity is distinct from m.current_quantity
         order by abs(m.quantity - coalesce(m.current_quantity, 0)) desc, m.sku
         limit 5) s), '[]'::jsonb) end,
    'unmatched_variants', count(*) filter (where not is_known),
    'status_changes', (select n from product_status)
  )
  into v_result
  from matched;
  return v_result;
end
$$;
revoke all on function public.import_preview_changes(uuid, uuid) from public;
grant execute on function public.import_preview_changes(uuid, uuid) to authenticated;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261029000200'::text
$$;
