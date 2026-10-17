-- =============================================================================
-- Panel de productos: filtros por marca y por pendientes («agotados»: alguna
-- presentación activa sin existencias; «sin_foto»: ninguna foto lista).
-- Se reemplaza la firma (dos parámetros opcionales más); el cuerpo es el mismo
-- de 20261010000100 con esos filtros.
-- =============================================================================
drop function public.catalog_search_products(uuid, text, text, uuid, boolean, jsonb, integer);

create or replace function public.catalog_search_products(
  p_store_id    uuid,
  p_query       text default null,
  p_status      text default null,
  p_category_id uuid default null,
  p_deleted     boolean default false,
  p_cursor      jsonb default null,
  p_limit       integer default 50,
  p_brand_id    uuid default null,
  p_issue       text default null
)
returns table (
  id            uuid,
  title         text,
  slug          text,
  status        text,
  min_price     bigint,
  max_price     bigint,
  variant_count integer,
  updated_at    timestamptz,
  deleted_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq    tsquery;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_c_time timestamptz := (p_cursor ->> 'updated_at')::timestamptz;
  v_c_id   uuid := (p_cursor ->> 'id')::uuid;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  if p_status is not null and p_status not in ('draft', 'active', 'archived') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  if p_issue is not null and p_issue not in ('agotados', 'sin_foto') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'issue';
  end if;
  if v_q is not null then
    v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(v_q));
  end if;
  return query
  select p.id, p.title, p.slug, p.status, p.min_price, p.max_price,
         (select count(*)::integer from public.product_variants pv where pv.product_id = p.id and pv.deleted_at is null),
         p.updated_at, p.deleted_at
    from public.products p
   where p.store_id = p_store_id
     and (case when coalesce(p_deleted, false) then p.deleted_at is not null else p.deleted_at is null end)
     and (p_status is null or p.status = p_status)
     and (p_category_id is null or exists (select 1 from public.product_categories pc
                                           where pc.product_id = p.id and pc.category_id = p_category_id))
     and (p_brand_id is null or p.brand_id = p_brand_id)
     -- Sin foto lista: lo primero que hay que resolver para vender.
     and (p_issue is distinct from 'sin_foto' or not exists (
            select 1 from public.media m where m.store_id = p.store_id and m.product_id = p.id
               and m.status = 'ready' and m.deleted_at is null))
     -- Alguna presentación activa sin existencias (y sin venta bajo pedido).
     and (p_issue is distinct from 'agotados' or exists (
            select 1 from public.product_variants v
             where v.product_id = p.id and v.deleted_at is null and v.status = 'active'
               and v.track_inventory and v.inventory_policy = 'deny'
               and coalesce((select sum(l.available) from public.inventory_levels l
                               join public.inventory_locations loc on loc.id = l.location_id and loc.is_active
                              where l.variant_id = v.id), 0) <= 0))
     and (v_q is null
          or p.search_vector @@ v_tsq
          or extensions.similarity(p.title, v_q) > 0.3
          or exists (select 1 from public.product_variants pv where pv.product_id = p.id
                       and pv.sku = upper(v_q) and pv.deleted_at is null))
     and (v_c_time is null or (p.updated_at, p.id) < (v_c_time, v_c_id))
     -- El producto con el SKU exacto va primero solo en la primera página.
     and (v_c_time is null or v_q is null or not exists (
            select 1 from public.product_variants pv where pv.product_id = p.id
               and pv.sku = upper(v_q) and pv.deleted_at is null))
   order by
     (v_q is not null and exists (select 1 from public.product_variants pv where pv.product_id = p.id
                                    and pv.sku = upper(v_q) and pv.deleted_at is null)) desc,
     p.updated_at desc, p.id desc
   limit v_limit;
end
$$;

revoke all on function public.catalog_search_products(uuid, text, text, uuid, boolean, jsonb, integer, uuid, text) from public;
grant execute on function public.catalog_search_products(uuid, text, text, uuid, boolean, jsonb, integer, uuid, text)
  to authenticated;
