-- =============================================================================
-- ADR-034 §6 · Importar un diseño (archivo exportado o copia de otra tienda de la
-- misma organización) al BORRADOR, en una transacción. El servidor ya quitó las
-- imágenes y referencias de la tienda de origen (src/lib/theme/portable.ts);
-- aquí se aplican las mismas validaciones que al guardar a mano.
--
-- Solo reemplaza las claves de diseño (colores, tipografía, forma, encabezado,
-- ficha y listados); SEO, contacto, redes, favicon y pie se quedan como están.
-- =============================================================================

create or replace function public.appearance_import_design(p_store_id uuid, p_settings jsonb, p_sections jsonb,
                                                          p_expected_revision integer, p_source text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys  text[] := array['colors', 'typography', 'shape', 'header', 'product_page', 'listing'];
  v_patch jsonb;
  v_rev   integer;
begin
  perform app.theme_require_editor(p_store_id);
  if jsonb_typeof(p_settings) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_settings) k where not (k = any (v_keys)))
     or p_source is null or p_source !~ '^(file|store:[0-9a-f-]{36})$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'design';
  end if;
  -- Las claves de diseño que no vienen se quitan (null en el parche).
  select jsonb_object_agg(k, coalesce(p_settings -> k, 'null'::jsonb)) into v_patch from unnest(v_keys) k;
  v_rev := public.appearance_save_theme_draft(p_store_id, v_patch, p_expected_revision);
  v_rev := public.appearance_save_home_draft(p_store_id, p_sections, v_rev);
  perform audit.record('theme.design_imported', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('source', p_source));
  return v_rev;
end
$$;

revoke all on function public.appearance_import_design(uuid, jsonb, jsonb, integer, text) from public;
grant execute on function public.appearance_import_design(uuid, jsonb, jsonb, integer, text) to authenticated;
