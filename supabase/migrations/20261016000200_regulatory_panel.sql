-- =============================================================================
-- Fase R · R-T02 — Panel del módulo regulatorio (ADR-021, D-R-01).
-- Clasificación masiva como "no regulado" de TODOS los productos publicados que
-- aún no tienen clasificación (lo que pide Ajustes → Cumplimiento antes de
-- declarar una categoría). La ficha de un suplemento se sigue capturando producto
-- por producto.
-- =============================================================================
create or replace function public.catalog_classify_active_unregulated(p_store_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_store_permission(p_store_id, 'products.update');
  v_org uuid := (select s.organization_id from public.stores s where s.id = p_store_id);
  v_id  uuid;
  v_n   integer := 0;
begin
  for v_id in
    insert into public.product_regulatory_info (store_id, product_id, category_key, updated_by)
    select p.store_id, p.id, null, v_uid
      from public.products p
     where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
       and not exists (select 1 from public.product_regulatory_info i
                        where i.store_id = p.store_id and i.product_id = p.id)
    on conflict (product_id) do nothing
    returning product_id
  loop
    v_n := v_n + 1;
    perform audit.record('product.regulatory_updated', 'product', v_id, v_org, p_store_id, null,
                         jsonb_build_object('category', null, 'fields', '[]'::jsonb));
  end loop;
  return v_n;
end
$$;
revoke all on function public.catalog_classify_active_unregulated(uuid) from public;
grant execute on function public.catalog_classify_active_unregulated(uuid) to authenticated;
