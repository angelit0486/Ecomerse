-- =============================================================================
-- Calidad del catálogo (super prompt §16): qué le falta a cada producto, para
-- corregirlo desde el panel. Avisos, no bloqueos: lo que impide publicar sigue
-- en app.validate_product_for_publish (y su código también se lista aquí).
--
-- Códigos: brand_missing, category_missing, image_missing, description_missing,
-- variant_sku_missing, variant_barcode_missing, variant_weight_missing (una
-- variante activa que se envía sin peso: la tarifa por peso no la calcula) y
-- los de publicación (title_missing, price_zero, compliance_…). Exige
-- products.read; los primeros 500 por título, `total` cuenta todos.
-- =============================================================================
create or replace function public.catalog_quality_report(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  with base as (
    select p.id, p.title, p.status, p.brand_id, p.description_html
      from public.products p
     where p.store_id = p_store_id and p.deleted_at is null and p.status <> 'archived'
  ),
  checked as (
    select b.id, b.title, b.status,
           array_remove(array[
             case when b.brand_id is null then 'brand_missing' end,
             case when not exists (select 1 from public.product_categories pc
                                    where pc.store_id = p_store_id and pc.product_id = b.id) then 'category_missing' end,
             case when not exists (select 1 from public.media m
                                    where m.store_id = p_store_id and m.product_id = b.id and m.status = 'ready'
                                      and m.deleted_at is null) then 'image_missing' end,
             case when coalesce(btrim(regexp_replace(coalesce(b.description_html, ''), '<[^>]*>', '', 'g')), '') = ''
                  then 'description_missing' end,
             case when exists (select 1 from public.product_variants v
                                where v.store_id = p_store_id and v.product_id = b.id and v.deleted_at is null
                                  and v.status = 'active' and nullif(btrim(coalesce(v.sku, '')), '') is null)
                  then 'variant_sku_missing' end,
             case when exists (select 1 from public.product_variants v
                                where v.store_id = p_store_id and v.product_id = b.id and v.deleted_at is null
                                  and v.status = 'active' and nullif(btrim(coalesce(v.barcode, '')), '') is null)
                  then 'variant_barcode_missing' end,
             case when exists (select 1 from public.product_variants v
                                where v.store_id = p_store_id and v.product_id = b.id and v.deleted_at is null
                                  and v.status = 'active' and v.requires_shipping and v.weight_g is null)
                  then 'variant_weight_missing' end
           ]::text[], null)
           || coalesce((select array_agg(c.code order by c.code)
                          from app.validate_product_for_publish(b.id) c
                         where c.level = 'error'), '{}') as codes
      from base b
  ),
  flagged as (select * from checked where cardinality(codes) > 0)
  select jsonb_build_object(
           'checked', (select count(*) from checked),
           'total', (select count(*) from flagged),
           'by_code', coalesce((select jsonb_object_agg(code, n) from (
                                  select c as code, count(*) as n from flagged, unnest(codes) c group by c) x),
                               '{}'::jsonb),
           'products', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title,
                                                                    'status', f.status, 'codes', to_jsonb(f.codes))
                                                  order by f.title, f.id)
                                   from (select * from flagged order by title, id limit 500) f), '[]'::jsonb))
    into v_out;
  return v_out;
end
$$;
revoke all on function public.catalog_quality_report(uuid) from public;
grant execute on function public.catalog_quality_report(uuid) to authenticated;
