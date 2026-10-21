-- =============================================================================
-- ADR-034 §5 · Plantillas de tienda por giro. La plantilla (en código, ver
-- src/lib/templates) trae estilo, portada, categorías y productos de ejemplo; se
-- aplica en UNA transacción reutilizando las RPC de siempre, así que valen las
-- mismas reglas (esquema del tema, contraste, referencias, permisos).
--
-- * Solo antes del primer lanzamiento: una tienda publicada no recibe datos de
--   ejemplo.
-- * Los productos de ejemplo quedan en BORRADOR (solo se ven en la vista previa
--   privada, nunca se compran), con «Ejemplo · » en el título, la etiqueta
--   `ejemplo` y sin inventario ni SKU. Mientras exista uno, la tienda no se
--   puede publicar (`sample_products`).
-- * Volver a aplicar no duplica: las categorías se reutilizan por slug y los
--   productos cuyo slug ya existe se omiten.
-- * La descripción llega como texto plano; aquí se envuelve en <p> (sin HTML de
--   la plantilla, ni siquiera el nuestro).
-- =============================================================================

create or replace function public.store_apply_template(p_store_id uuid, p_template jsonb,
                                                      p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store      public.stores;
  v_rev        integer;
  v_cats       jsonb := '{}'::jsonb;
  v_cat        jsonb;
  v_cat_id     uuid;
  v_prod       jsonb;
  v_slug       text;
  v_desc       text;
  v_new_cats   integer := 0;
  v_new_prods  integer := 0;
  v_skipped    integer := 0;
begin
  perform app.theme_require_editor(p_store_id);
  perform app.require_store_permission(p_store_id, 'categories.manage');
  perform app.require_store_permission(p_store_id, 'products.create');

  select * into v_store from public.stores s where s.id = p_store_id for update;
  if v_store.launched_at is not null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'launched';
  end if;
  if jsonb_typeof(p_template) is distinct from 'object'
     or coalesce(p_template ->> 'key', '') !~ '^[a-z][a-z0-9-]{1,30}$'
     or jsonb_typeof(p_template -> 'settings') is distinct from 'object'
     or jsonb_typeof(p_template -> 'home_sections') is distinct from 'array'
     or jsonb_typeof(p_template -> 'categories') is distinct from 'array'
     or jsonb_typeof(p_template -> 'products') is distinct from 'array'
     or jsonb_array_length(p_template -> 'categories') > 12
     or jsonb_array_length(p_template -> 'products') > 24 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'template';
  end if;

  -- Estilo y portada al borrador (mismas validaciones y la misma revisión optimista).
  v_rev := public.appearance_save_theme_draft(p_store_id, p_template -> 'settings', p_expected_revision);
  v_rev := public.appearance_save_home_draft(p_store_id, p_template -> 'home_sections', v_rev);

  -- Categorías raíz, reutilizadas por slug.
  for v_cat in select * from jsonb_array_elements(p_template -> 'categories') loop
    v_slug := coalesce(nullif(btrim(v_cat ->> 'slug'), ''), app.slugify(v_cat ->> 'name'));
    select c.id into v_cat_id from public.categories c
     where c.store_id = p_store_id and c.parent_id is null and c.slug = v_slug and c.deleted_at is null;
    if v_cat_id is null then
      v_cat_id := public.catalog_upsert_category(p_store_id, jsonb_build_object(
        'name', v_cat ->> 'name', 'slug', v_slug, 'description', v_cat ->> 'description',
        'position', v_new_cats));
      v_new_cats := v_new_cats + 1;
    end if;
    v_cats := v_cats || jsonb_build_object(v_slug, v_cat_id);
  end loop;

  -- Productos de ejemplo: el marcado lo pone la base, no la plantilla.
  for v_prod in select * from jsonb_array_elements(p_template -> 'products') loop
    if jsonb_typeof(v_prod -> 'variants') is distinct from 'array' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'template';
    end if;
    v_desc := btrim(coalesce(v_prod ->> 'description', ''));
    if v_desc ~ '[<>&]' or char_length(v_desc) > 600 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'template';
    end if;
    v_slug := 'ejemplo-' || app.slugify(v_prod ->> 'title');
    if exists (select 1 from public.products p
                where p.store_id = p_store_id and p.slug = v_slug and p.deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    perform public.catalog_upsert_product(p_store_id, jsonb_build_object(
      'title', 'Ejemplo · ' || btrim(v_prod ->> 'title'),
      'slug', v_slug,
      'description_html', case when v_desc = '' then null else '<p>' || v_desc || '</p>' end,
      'tags', jsonb_build_array('ejemplo'),
      'options', coalesce(v_prod -> 'options', '[]'::jsonb),
      'variants', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'options', coalesce(x.value -> 'options', '{}'::jsonb),
                     'price', x.value -> 'price', 'compare_at_price', x.value -> 'compare_at_price',
                     'net_content', x.value -> 'net_content',
                     'servings_per_container', x.value -> 'servings_per_container',
                     'position', x.ordinality - 1,
                     'track_inventory', false, 'requires_shipping', true)) order by x.ordinality)
                     from jsonb_array_elements(v_prod -> 'variants') with ordinality x),
      'categories', case when v_cats ? (v_prod ->> 'category')
                         then jsonb_build_array(jsonb_build_object('id', v_cats ->> (v_prod ->> 'category'),
                                                                   'is_primary', true))
                         else '[]'::jsonb end));
    v_new_prods := v_new_prods + 1;
  end loop;

  perform audit.record('store.template_applied', 'store', p_store_id, v_store.organization_id, p_store_id,
                       null, jsonb_build_object('template', p_template ->> 'key', 'categories', v_new_cats,
                                                'products', v_new_prods, 'skipped', v_skipped));
  return jsonb_build_object('revision', v_rev, 'categories', v_new_cats, 'products', v_new_prods,
                            'skipped', v_skipped);
end
$$;

-- Quita (borrado lógico, como siempre) los productos con la etiqueta `ejemplo`.
create or replace function public.store_remove_sample_products(p_store_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  perform app.require_store_permission(p_store_id, 'products.delete');
  for v_id in select p.id from public.products p
               where p.store_id = p_store_id and p.deleted_at is null and 'ejemplo' = any (p.tags)
               order by p.id loop
    perform public.catalog_soft_delete_product(p_store_id, v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

-- Lanzamiento: mientras haya productos de ejemplo, no se publica. Se envuelve la
-- versión vigente (20261016000100) sin duplicar su lógica.
alter function app.validate_store_for_launch(uuid) rename to validate_store_for_launch_regulatory;

create or replace function app.validate_store_for_launch(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_issues jsonb := app.validate_store_for_launch_regulatory(p_store_id);
begin
  if exists (select 1 from public.products p
              where p.store_id = p_store_id and p.deleted_at is null and 'ejemplo' = any (p.tags)) then
    v_issues := v_issues || jsonb_build_object('code', 'sample_products',
      'message', 'Quita los productos de ejemplo de la plantilla (etiqueta «ejemplo») antes de publicar.');
  end if;
  return v_issues;
end
$$;

revoke all on function app.validate_store_for_launch(uuid) from public;
revoke all on function app.validate_store_for_launch_regulatory(uuid) from public;
revoke all on function public.store_apply_template(uuid, jsonb, integer) from public;
grant execute on function public.store_apply_template(uuid, jsonb, integer) to authenticated;
revoke all on function public.store_remove_sample_products(uuid) from public;
grant execute on function public.store_remove_sample_products(uuid) to authenticated;
