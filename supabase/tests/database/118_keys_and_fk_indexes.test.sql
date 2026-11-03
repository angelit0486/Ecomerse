-- =============================================================================
-- Metaprueba: toda tabla tiene llave primaria y toda llave foránea tiene un
-- índice que la sirve (al borrar lo referido, Postgres busca las filas que lo
-- usan). Las excepciones son decisiones: catálogos pequeños y columnas de
-- quién creó algo en tablas del staff. Una FK nueva sin índice rompe esta
-- prueba hasta que se le agregue índice o se justifique aquí.
-- =============================================================================
begin;
select plan(3);

select is(array(
  select c.oid::regclass::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and n.nspname in ('public', 'system', 'app', 'audit', 'private')
     and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p')
   order by 1), '{}'::text[], 'toda tabla tiene llave primaria');

create temp table unindexed_fk as
with fk as (
  select c.conrelid, c.conkey,
         (select array_agg(a.attnum) from unnest(c.conkey) k(attnum)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum and a.attname <> 'store_id') nonstore,
         (select string_agg(a.attname, ',' order by a.attname) from unnest(c.conkey) k(attnum)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f' and n.nspname in ('public', 'system', 'app', 'audit', 'private')
)
-- Sirve un índice que empieza por la columna propia de la FK (sin store_id) o
-- cuyas primeras columnas son exactamente las de la FK.
select fk.conrelid::regclass::text || '(' || fk.cols || ')' as fk from fk
 where not exists (
   select 1 from pg_index i where i.indrelid = fk.conrelid
     and ((i.indkey::int2[])[0] = any(coalesce(fk.nonstore, fk.conkey))
          or (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] @> fk.conkey));

create temp table allowed_fk (fk text primary key);
insert into allowed_fk values
  -- Imágenes de marca, categoría, tema y página: pocas filas por tienda.
  ('brands(cover_media_id,store_id)'), ('brands(logo_media_id,store_id)'),
  ('categories(cover_media_id,store_id)'), ('categories(image_media_id,store_id)'),
  ('store_pages(seo_image_media_id,store_id)'), ('store_theme_versions(logo_media_id,store_id)'),
  ('store_themes(draft_logo_media_id,store_id)'), ('store_themes(logo_media_id,store_id)'),
  ('menu_items(parent_id,store_id)'),
  -- Catálogos de la plataforma (decenas de filas).
  ('compliance_profiles(category_key)'), ('store_compliance_legends(category_key)'),
  ('store_regulated_categories(category_key)'), ('role_permissions(permission_key)'),
  ('roles(organization_id)'), ('store_members(role_id)'), ('organization_invitations(store_role_id)'),
  ('subscriptions(plan_id)'), ('system.billing_events(organization_id)'),
  ('system.product_limit_bulk(store_id)'), ('support_access_grants(organization_id,store_id)'),
  -- Quién creó, invitó o publicó (personal; se pone en null al borrar la cuenta).
  ('feature_flag_overrides(created_by)'), ('import_jobs(commit_requested_by)'), ('import_jobs(requested_by)'),
  ('organization_entitlement_overrides(created_by)'), ('organization_invitations(accepted_by)'),
  ('organization_invitations(invited_by)'), ('platform_staff(created_by)'), ('store_redirects(created_by)'),
  ('store_theme_versions(published_by)'), ('store_themes(published_by)'),
  ('support_access_grants(granted_by)'), ('support_access_grants(revoked_by)'),
  ('variant_price_schedules(created_by)');

select is(array(select u.fk from unindexed_fk u where u.fk not in (select a.fk from allowed_fk a) order by 1),
          '{}'::text[], 'toda llave foránea tiene índice o una excepción justificada');
select is(array(select a.fk from allowed_fk a where a.fk not in (select u.fk from unindexed_fk u) order by 1),
          '{}'::text[], 'la lista de excepciones no tiene sobrantes (si ya tiene índice, se quita de aquí)');

select * from finish();
rollback;
