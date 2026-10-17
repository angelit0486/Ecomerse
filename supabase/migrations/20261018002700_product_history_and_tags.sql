-- =============================================================================
-- Panel de productos, tanda 6.
--
-- * catalog_product_history: los cambios auditados de UN producto (quién, qué y
--   cuándo), para la ficha. Exige audit.read, como Actividad; los movimientos
--   de existencias ya tienen su historial por presentación en Inventario.
-- * catalog_bulk_tags: agregar o quitar una etiqueta a varios productos. Mismas
--   reglas que las ediciones en bloque de la tanda 4 (products.update, máximo
--   100 de la misma tienda, todo o nada, auditado por producto).
-- =============================================================================

create or replace function public.catalog_product_history(p_store_id uuid, p_product_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  perform app.require_store_permission(p_store_id, 'audit.read');
  if not exists (select 1 from public.products p where p.store_id = p_store_id and p.id = p_product_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'occurred_at', x.occurred_at, 'actor_type', x.actor_type,
             -- Igual que audit_list (APP-M2): alguien ajeno a la organización nunca con su email.
             'actor_label', case when x.actor_type = 'user' and x.actor_label like '%@%'
                                      and not exists (select 1 from public.organization_members m
                                                        join public.stores s on s.organization_id = m.organization_id
                                                       where s.id = p_store_id and m.user_id = x.actor_user_id)
                                 then 'Cliente ' || coalesce(app.mask_email(x.actor_label), '')
                                 else x.actor_label end,
             'via_support', x.support_grant_id is not null,
             'action', x.action, 'before', x.before, 'after', x.after, 'metadata', x.metadata)
           order by x.occurred_at desc, x.id desc)
      from (select a.* from audit.audit_logs a
             where a.store_id = p_store_id and a.entity_type = 'product' and a.entity_id = p_product_id
             order by a.occurred_at desc, a.id desc
             limit v_limit) x), '[]'::jsonb);
end
$$;

create or replace function public.catalog_bulk_tags(p_store_id uuid, p_product_ids uuid[], p_tag text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids     uuid[];
  v_tag     text := btrim(coalesce(p_tag, ''));
  v_changed integer := 0;
  v_org     uuid := (select s.organization_id from public.stores s where s.id = p_store_id);
  v_r       record;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  if p_mode is null or p_mode not in ('add', 'remove') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'mode';
  end if;
  if char_length(v_tag) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'tags';
  end if;
  v_ids := app.bulk_products(p_store_id, p_product_ids);
  -- Mismo límite que el editor: máximo 50 etiquetas por producto.
  if p_mode = 'add' and exists (
       select 1 from public.products p
        where p.id = any (v_ids) and not (lower(v_tag) = any (select lower(t) from unnest(p.tags) t))
          and cardinality(p.tags) >= 50) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'tags';
  end if;
  for v_r in
    update public.products p
       set tags = case when p_mode = 'add' then p.tags || v_tag
                       else array(select t from unnest(p.tags) t where lower(t) <> lower(v_tag)) end
      from (select x.id, x.tags from public.products x where x.id = any (v_ids)) old
     where p.id = old.id
       and case when p_mode = 'add' then not (lower(v_tag) = any (select lower(t) from unnest(old.tags) t))
                else lower(v_tag) = any (select lower(t) from unnest(old.tags) t) end
    returning p.id, old.tags as before, p.tags as after
  loop
    v_changed := v_changed + 1;
    perform audit.record('product.updated', 'product', v_r.id, v_org, p_store_id,
                         jsonb_build_object('tags', to_jsonb(v_r.before)), jsonb_build_object('tags', to_jsonb(v_r.after)),
                         null, jsonb_build_object('bulk', true));
  end loop;
  -- Las etiquetas están en el texto que revisa el cumplimiento (términos prohibidos).
  perform app.bulk_check_publishable(v_ids);
  return jsonb_build_object('changed', v_changed);
end
$$;

revoke all on function public.catalog_product_history(uuid, uuid, integer) from public;
revoke all on function public.catalog_bulk_tags(uuid, uuid[], text, text) from public;
grant execute on function public.catalog_product_history(uuid, uuid, integer) to authenticated;
grant execute on function public.catalog_bulk_tags(uuid, uuid[], text, text) to authenticated;
