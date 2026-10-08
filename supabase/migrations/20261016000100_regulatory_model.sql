-- =============================================================================
-- Fase R · R-T01 — Módulo regulatorio v1: suplementos alimenticios en México
-- (ADR-021; Q-B3 revisada el 2026-10-08, DECISIONS §11; GATE0 §14.3 y §48).
--
-- * Reglas de la PLATAFORMA por jurisdicción (país + categoría regulada),
--   versionadas. La plataforma nunca redacta el texto legal (D-S-01): el perfil
--   nace `pending` y, mientras no lo revise platform_admin con las reglas que dé
--   el asesor regulatorio, ningún producto de esa categoría se publica.
-- * La TIENDA declara qué categorías vende. Mientras declare alguna, todo
--   producto necesita una clasificación explícita para publicarse (la categoría
--   o "no regulado"): denegación por defecto.
-- * Invariante: producto activo ⇒ cumple. Se valida al publicar, al editar uno
--   publicado y al guardar su ficha; tras un cambio de reglas (o al declarar una
--   categoría) el worker despublica lo que deje de cumplir (compliance.recheck).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo de categorías reguladas (plataforma)
-- -----------------------------------------------------------------------------
create table public.regulated_categories (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]{2,39}$'),
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
insert into public.regulated_categories (key, name) values ('dietary_supplement', 'Suplemento alimenticio');

alter table public.regulated_categories enable row level security;
alter table public.regulated_categories force row level security;
revoke all on table public.regulated_categories from public, anon, authenticated, service_role;
grant select on table public.regulated_categories to authenticated;
create policy regulated_categories_select on public.regulated_categories for select to authenticated
  using ((select auth.uid()) is not null);

-- -----------------------------------------------------------------------------
-- 2. Perfiles por jurisdicción (plataforma). `active` exige quién lo revisó.
-- -----------------------------------------------------------------------------
create table public.compliance_profiles (
  id           uuid primary key default app.uuid_v7(),
  country      text not null check (country ~ '^[A-Z]{2}$'),
  category_key text not null references public.regulated_categories (key) on delete restrict,
  status       text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  version      integer not null default 1 check (version >= 1),
  reviewed_by  text check (reviewed_by is null or char_length(reviewed_by) between 2 and 120),
  reviewed_at  timestamptz,
  review_notes text check (review_notes is null or char_length(review_notes) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (country, category_key),
  constraint compliance_profiles_review check (status <> 'active' or (reviewed_by is not null and reviewed_at is not null))
);
-- Sin reglas ni texto: el asesor regulatorio del propietario las define (D-S-01).
insert into public.compliance_profiles (country, category_key) values ('MX', 'dietary_supplement');

create trigger compliance_profiles_set_updated_at before update on public.compliance_profiles
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Reglas de un perfil
--    required_field  → la ficha debe traer ese campo (field_key).
--    required_legend → texto (body) que se muestra donde diga placements.
--    forbidden_term  → término (body) que no puede aparecer en el producto.
-- -----------------------------------------------------------------------------
create table public.compliance_rules (
  id         uuid primary key default app.uuid_v7(),
  profile_id uuid not null references public.compliance_profiles (id) on delete restrict,
  kind       text not null check (kind in ('required_field', 'required_legend', 'forbidden_term')),
  key        text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label      text not null check (char_length(btrim(label)) between 1 and 120),
  body       text check (body is null or char_length(btrim(body)) between 1 and 2000),
  field_key  text,
  placements text[] not null default '{}'::text[]
             check (placements <@ array['product_page', 'cart', 'checkout']::text[]),
  position   integer not null default 0 check (position between 0 and 1000),
  status     text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, key),
  constraint compliance_rules_shape check (
    case kind
      when 'required_field' then field_key is not null and body is null and cardinality(placements) = 0
      when 'required_legend' then field_key is null and body is not null and cardinality(placements) >= 1
      else field_key is null and body is not null and char_length(btrim(body)) between 2 and 60
           and cardinality(placements) = 0
    end)
);
create index compliance_rules_profile_idx on public.compliance_rules (profile_id, status, kind);
create trigger compliance_rules_set_updated_at before update on public.compliance_rules
  for each row execute function app.set_updated_at();

alter table public.compliance_profiles enable row level security;
alter table public.compliance_profiles force row level security;
alter table public.compliance_rules enable row level security;
alter table public.compliance_rules force row level security;
-- Sin grants ni políticas: la plataforma lee por platform_compliance_list y cada
-- tienda por compliance_store_status (solo lo de su país y categorías).
revoke all on table public.compliance_profiles, public.compliance_rules from public, anon, authenticated, service_role;

create trigger regulated_categories_log_change after insert or update or delete on public.regulated_categories
  for each row execute function audit.log_change();
create trigger compliance_profiles_log_change after insert or update or delete on public.compliance_profiles
  for each row execute function audit.log_change();
create trigger compliance_rules_log_change after insert or update or delete on public.compliance_rules
  for each row execute function audit.log_change();

-- -----------------------------------------------------------------------------
-- 4. Categorías que declara cada tienda
-- -----------------------------------------------------------------------------
create table public.store_regulated_categories (
  id           uuid primary key default app.uuid_v7(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  category_key text not null references public.regulated_categories (key) on delete restrict,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, category_key)
);
create trigger store_regulated_categories_prevent_tenant_change before update on public.store_regulated_categories
  for each row execute function app.prevent_tenant_change();

alter table public.store_regulated_categories enable row level security;
alter table public.store_regulated_categories force row level security;
revoke all on table public.store_regulated_categories from public, anon, authenticated, service_role;
grant select on table public.store_regulated_categories to authenticated;
create policy store_regulated_categories_select on public.store_regulated_categories for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));

-- -----------------------------------------------------------------------------
-- 5. Clasificación y ficha de cada producto (1:1). category_key NULL = "no
--    regulado" (también es una clasificación explícita). La FK compuesta a las
--    categorías declaradas impide clasificar en una categoría que la tienda no
--    vende y retirar una categoría que todavía usa algún producto.
-- -----------------------------------------------------------------------------
create table public.product_regulatory_info (
  store_id       uuid not null references public.stores (id) on delete cascade,
  product_id     uuid primary key,
  category_key   text,
  schema_version integer not null default 1 check (schema_version = 1),
  data           jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (store_id, product_id),
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade,
  -- NO ACTION (no RESTRICT): se comprueba al final de la sentencia, así que borrar la
  -- tienda en cascada funciona y retirar una categoría en uso sigue fallando.
  foreign key (store_id, category_key) references public.store_regulated_categories (store_id, category_key),
  constraint product_regulatory_info_unregulated check (category_key is not null or data = '{}'::jsonb)
);
create index product_regulatory_info_category_idx on public.product_regulatory_info (store_id, category_key);
create trigger product_regulatory_info_set_updated_at before update on public.product_regulatory_info
  for each row execute function app.set_updated_at();
create trigger product_regulatory_info_prevent_tenant_change before update on public.product_regulatory_info
  for each row execute function app.prevent_tenant_change();

alter table public.product_regulatory_info enable row level security;
alter table public.product_regulatory_info force row level security;
revoke all on table public.product_regulatory_info from public, anon, authenticated, service_role;
grant select on table public.product_regulatory_info to authenticated;
create policy product_regulatory_info_select on public.product_regulatory_info for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));

-- -----------------------------------------------------------------------------
-- 6. Ficha v1 de suplementos: lista blanca de campos, límites y normalización
--    (espejo en src/server/catalog/regulatory.ts). Texto plano: la tienda lo
--    escribe y el storefront lo escapa; nunca HTML.
-- -----------------------------------------------------------------------------
create or replace function app.regulatory_fields(p_category text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_category
    when 'dietary_supplement' then array['form', 'serving_size', 'servings_per_container', 'ingredients',
                                         'nutrition', 'usage', 'warnings', 'storage', 'allergens',
                                         'sanitary_notice']
  end
$$;
revoke all on function app.regulatory_fields(text) from public;

-- Normaliza la ficha (recorta, quita vacíos) o lanza validation_failed con los
-- campos inválidos en el hint.
create or replace function app.regulatory_normalize(p_category text, p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_limits constant jsonb := '{"form": 100, "serving_size": 100, "ingredients": 5000, "usage": 2000,
                                "warnings": 3000, "storage": 1000, "allergens": 1000, "sanitary_notice": 300}';
  v_cells  constant jsonb := '{"name": 100, "amount": 30, "unit": 20, "dv": 10}';
  v_out    jsonb := '{}'::jsonb;
  v_bad    text[] := '{}';
  v_key    text;
  v_val    jsonb;
  v_txt    text;
  v_row    jsonb;
  v_cell   text;
  v_clean  jsonb;
  v_rows   jsonb;
  v_row_ok boolean;
begin
  if app.regulatory_fields(p_category) is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'category';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'regulatory', hint = 'data';
  end if;

  for v_key, v_val in select e.key, e.value from jsonb_each(p_data) e loop
    if jsonb_typeof(v_val) = 'null' then
      continue;
    end if;
    if v_limits ? v_key then
      v_txt := case when jsonb_typeof(v_val) = 'string' then btrim(v_val #>> '{}') end;
      if v_txt is null or char_length(v_txt) > (v_limits ->> v_key)::integer
         or v_txt ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
        v_bad := v_bad || v_key;
      elsif v_txt <> '' then
        v_out := v_out || jsonb_build_object(v_key, v_txt);
      end if;
    elsif v_key = 'servings_per_container' then
      if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}') !~ '^[0-9]{1,6}$'
         or (v_val #>> '{}')::integer not between 1 and 100000 then
        v_bad := v_bad || v_key;
      else
        v_out := v_out || jsonb_build_object(v_key, (v_val #>> '{}')::integer);
      end if;
    elsif v_key = 'nutrition' then
      v_rows := '[]'::jsonb;
      v_row_ok := jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) <= 60;
      if v_row_ok then
        for v_row in select r.value from jsonb_array_elements(v_val) r loop
          v_clean := '{}'::jsonb;
          if jsonb_typeof(v_row) <> 'object'
             or exists (select 1 from jsonb_object_keys(v_row) k where not (v_cells ? k)) then
            v_row_ok := false;
            exit;
          end if;
          for v_cell in select jsonb_object_keys(v_cells) loop
            continue when not (v_row ? v_cell) or jsonb_typeof(v_row -> v_cell) = 'null';
            v_txt := case when jsonb_typeof(v_row -> v_cell) = 'string' then btrim(v_row ->> v_cell) end;
            if v_txt is null or char_length(v_txt) > (v_cells ->> v_cell)::integer
               or v_txt ~ '[\x01-\x1F\x7F]' then
              v_row_ok := false;
            elsif v_txt <> '' then
              v_clean := v_clean || jsonb_build_object(v_cell, v_txt);
            end if;
          end loop;
          exit when not v_row_ok;
          continue when v_clean = '{}'::jsonb;  -- renglón vacío del formulario
          if not (v_clean ? 'name') or not (v_clean ? 'amount') then
            v_row_ok := false;
            exit;
          end if;
          v_rows := v_rows || jsonb_build_array(v_clean);
        end loop;
      end if;
      if not v_row_ok then
        v_bad := v_bad || v_key;
      elsif jsonb_array_length(v_rows) > 0 then
        v_out := v_out || jsonb_build_object(v_key, v_rows);
      end if;
    else
      v_bad := array_append(v_bad, 'data');  -- campo fuera de la lista blanca (sin repetir el nombre recibido)
    end if;
  end loop;

  if cardinality(v_bad) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'regulatory',
                          hint = (select string_agg(distinct b, ',') from unnest(v_bad) b);
  end if;
  return v_out;
end
$$;
revoke all on function app.regulatory_normalize(text, jsonb) from public;

-- Texto comparable para términos prohibidos: minúsculas y sin acentos.
create or replace function app.compliance_text(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(extensions.unaccent(coalesce(p_text, '')))
$$;
revoke all on function app.compliance_text(text) from public;

-- Expresión de palabra completa para un término ("cura" no coincide con "procurar").
create or replace function app.compliance_term_regex(p_term text)
returns text
language sql
stable
set search_path = ''
as $$
  select '\m' || regexp_replace(app.compliance_text(btrim(p_term)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'
$$;
revoke all on function app.compliance_term_regex(text) from public;

-- -----------------------------------------------------------------------------
-- 7. Validador de cumplimiento (extensión de §14.3)
-- -----------------------------------------------------------------------------
create or replace function app.validate_product_compliance(p_product_id uuid)
returns table (code text, level text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_country text;
  v_info    public.product_regulatory_info;
  v_profile public.compliance_profiles;
  v_corpus  text;
begin
  select * into v_product from public.products p where p.id = p_product_id;
  if v_product.id is null then
    return;
  end if;
  select * into v_info from public.product_regulatory_info r where r.product_id = p_product_id;
  if v_info.product_id is null then
    if exists (select 1 from public.store_regulated_categories d where d.store_id = v_product.store_id) then
      return query select 'compliance_classification_missing'::text, 'error'::text;
    end if;
    return;
  end if;
  if v_info.category_key is null then
    return;  -- clasificado como no regulado
  end if;

  select s.country::text into v_country from public.stores s where s.id = v_product.store_id;
  select * into v_profile from public.compliance_profiles cp
   where cp.country = v_country and cp.category_key = v_info.category_key;
  if v_profile.id is null or v_profile.status <> 'active' then
    return query select 'compliance_profile_pending'::text, 'error'::text;
    return;
  end if;

  return query
    select 'compliance_field_missing:' || r.field_key, 'error'::text
      from public.compliance_rules r
     where r.profile_id = v_profile.id and r.status = 'active' and r.kind = 'required_field'
       and not (v_info.data ? r.field_key)
     order by r.position, r.key;

  v_corpus := app.compliance_text(concat_ws(' ',
    v_product.title,
    regexp_replace(coalesce(v_product.description_html, ''), '<[^>]*>', ' ', 'g'),
    v_product.seo_title,
    v_product.seo_description,
    (select string_agg(e.value, ' ') from jsonb_each_text(v_info.data - 'nutrition') e),
    (select string_agg(n ->> 'name', ' ') from jsonb_array_elements(coalesce(v_info.data -> 'nutrition', '[]')) n)));
  return query
    select 'compliance_forbidden_term:' || r.key, 'error'::text
      from public.compliance_rules r
     where r.profile_id = v_profile.id and r.status = 'active' and r.kind = 'forbidden_term'
       and v_corpus ~ app.compliance_term_regex(r.body)
     order by r.position, r.key;
end
$$;
revoke all on function app.validate_product_compliance(uuid) from public;

-- §14.3 + cumplimiento. Mismo contrato (code, level); las llamadas existentes
-- (publicar, editar uno publicado, importar) quedan cubiertas sin cambios.
create or replace function app.validate_product_for_publish(p_product_id uuid)
returns table (code text, level text)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.products where id = p_product_id),
  v as (select * from public.product_variants where product_id = p_product_id and deleted_at is null)
  select 'title_missing', 'error' from p where char_length(btrim(p.title)) = 0
  union all
  select 'no_active_variant', 'error' where not exists (select 1 from v where v.status = 'active')
  union all
  select 'price_zero', 'error' where exists (select 1 from v where v.status = 'active' and v.price = 0)
  union all
  select 'compare_at_price_invalid', 'error'
   where exists (select 1 from v where v.compare_at_price is not null and v.compare_at_price <= v.price)
  union all
  select 'product_type_not_supported', 'error' from p where p.product_type <> 'physical'
  union all
  select c.code, c.level from app.validate_product_compliance(p_product_id) c
  union all
  select 'image_alt_missing', 'warning'
   where exists (select 1 from public.media m where m.product_id = p_product_id and m.deleted_at is null
                   and m.status = 'ready' and coalesce(btrim(m.alt_text), '') = '')
$$;
revoke all on function app.validate_product_for_publish(uuid) from public;

-- -----------------------------------------------------------------------------
-- 8. Validación de lanzamiento: cada categoría declarada necesita su perfil
--    revisado. Se envuelve la versión de F7 (sin duplicar su lógica).
-- -----------------------------------------------------------------------------
alter function app.validate_store_for_launch(uuid) rename to validate_store_for_launch_base;

create or replace function app.validate_store_for_launch(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_issues jsonb := app.validate_store_for_launch_base(p_store_id);
  v_cat    record;
begin
  for v_cat in
    select rc.name
      from public.store_regulated_categories d
      join public.regulated_categories rc on rc.key = d.category_key
      join public.stores s on s.id = d.store_id
      left join public.compliance_profiles cp on cp.country = s.country::text and cp.category_key = d.category_key
     where d.store_id = p_store_id and cp.status is distinct from 'active'
     order by rc.name
  loop
    v_issues := v_issues || jsonb_build_object('code', 'compliance_profile',
      'message', format('Las reglas sanitarias de "%s" aún no están revisadas: esos productos no se pueden publicar.',
                        v_cat.name));
  end loop;
  return v_issues;
end
$$;
revoke all on function app.validate_store_for_launch(uuid) from public;
revoke all on function app.validate_store_for_launch_base(uuid) from public;

-- -----------------------------------------------------------------------------
-- 9. Revisión tras cambios: despublica los productos activos que dejaron de
--    cumplir (denegación por defecto). Por lotes; encola su continuación.
-- -----------------------------------------------------------------------------
create or replace function app.enqueue_compliance_recheck(p_profile_id uuid, p_store_id uuid, p_dedupe text)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.enqueue_job('compliance.recheck',
                         jsonb_strip_nulls(jsonb_build_object('profile_id', p_profile_id, 'store_id', p_store_id)),
                         p_store_id, p_dedupe, now(), 5);
$$;
revoke all on function app.enqueue_compliance_recheck(uuid, uuid, text) from public;

create or replace function system.compliance_recheck(p_profile_id uuid, p_store_id uuid, p_after uuid,
                                                     p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.compliance_profiles;
  v_limit   integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_product record;
  v_codes   text[];
  v_checked integer := 0;
  v_down    integer := 0;
  v_stores  uuid[] := '{}';
  v_last    uuid;
begin
  if (p_profile_id is null) = (p_store_id is null) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'scope';
  end if;
  if p_profile_id is not null then
    select * into v_profile from public.compliance_profiles cp where cp.id = p_profile_id;
    if v_profile.id is null then
      return jsonb_build_object('checked', 0, 'unpublished', 0, 'stores', '[]'::jsonb, 'done', true);
    end if;
  end if;

  for v_product in
    select p.id, p.store_id, s.organization_id
      from public.products p
      join public.stores s on s.id = p.store_id
     where p.status = 'active' and p.deleted_at is null
       and (p_after is null or p.id > p_after)
       and (p_store_id is null or p.store_id = p_store_id)
       and (p_profile_id is null or (s.country::text = v_profile.country and exists (
             select 1 from public.product_regulatory_info r
              where r.store_id = p.store_id and r.product_id = p.id and r.category_key = v_profile.category_key)))
     order by p.id
     limit v_limit
       for update of p  -- sin skip locked: un producto en edición se revisa al soltarse
  loop
    v_checked := v_checked + 1;
    v_last := v_product.id;
    select array_agg(c.code order by c.code) into v_codes
      from app.validate_product_compliance(v_product.id) c where c.level = 'error';
    if v_codes is not null then
      update public.products set status = 'draft' where id = v_product.id;
      perform audit.record('product.unpublished', 'product', v_product.id, v_product.organization_id,
                           v_product.store_id, jsonb_build_object('status', 'active'),
                           jsonb_build_object('status', 'draft'), 'compliance',
                           jsonb_build_object('codes', to_jsonb(v_codes)));
      v_down := v_down + 1;
      if not (v_product.store_id = any (v_stores)) then
        v_stores := v_stores || v_product.store_id;
      end if;
    end if;
  end loop;

  if v_checked = v_limit then
    perform app.enqueue_job('compliance.recheck',
                            jsonb_strip_nulls(jsonb_build_object('profile_id', p_profile_id, 'store_id', p_store_id,
                                                                 'after', v_last)),
                            p_store_id, 'compliance.recheck:after:' || v_last::text, now(), 5);
  end if;
  return jsonb_build_object('checked', v_checked, 'unpublished', v_down, 'stores', to_jsonb(v_stores),
                            'done', v_checked < v_limit);
end
$$;
revoke all on function system.compliance_recheck(uuid, uuid, uuid, integer) from public;
grant execute on function system.compliance_recheck(uuid, uuid, uuid, integer) to system_worker;

-- -----------------------------------------------------------------------------
-- 10. RPC de la tienda
-- -----------------------------------------------------------------------------

-- Estado para Ajustes → Cumplimiento y el editor de producto: categorías con
-- perfil en el país de la tienda, si las declara, y sus reglas activas.
create or replace function public.compliance_store_status(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_country text;
begin
  perform app.require_store_permission(p_store_id, 'store.read');
  select s.country::text into v_country from public.stores s where s.id = p_store_id;
  return jsonb_build_object(
    'country', v_country,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', rc.key, 'name', rc.name,
               'declared', exists (select 1 from public.store_regulated_categories d
                                    where d.store_id = p_store_id and d.category_key = rc.key),
               'profile', jsonb_build_object('status', cp.status, 'version', cp.version,
                                             'reviewed_by', cp.reviewed_by, 'reviewed_at', cp.reviewed_at),
               'required_fields', coalesce((select jsonb_agg(r.field_key order by r.position, r.key)
                                              from public.compliance_rules r
                                             where r.profile_id = cp.id and r.status = 'active'
                                               and r.kind = 'required_field'), '[]'::jsonb),
               'legends', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'label', r.label,
                                                                        'text', r.body, 'placements', r.placements)
                                                     order by r.position, r.key)
                                      from public.compliance_rules r
                                     where r.profile_id = cp.id and r.status = 'active'
                                       and r.kind = 'required_legend'), '[]'::jsonb),
               'forbidden_terms', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'label', r.label,
                                                                                'term', r.body)
                                                             order by r.position, r.key)
                                              from public.compliance_rules r
                                             where r.profile_id = cp.id and r.status = 'active'
                                               and r.kind = 'forbidden_term'), '[]'::jsonb),
               'products', (select count(*) from public.product_regulatory_info i
                              join public.products p on p.store_id = i.store_id and p.id = i.product_id
                             where i.store_id = p_store_id and i.category_key = rc.key and p.deleted_at is null))
             order by rc.name)
        from public.compliance_profiles cp
        join public.regulated_categories rc on rc.key = cp.category_key
       where cp.country = v_country), '[]'::jsonb),
    'unclassified_active', (select count(*) from public.products p
                             where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
                               and not exists (select 1 from public.product_regulatory_info i
                                                where i.store_id = p.store_id and i.product_id = p.id)));
end
$$;
revoke all on function public.compliance_store_status(uuid) from public;
grant execute on function public.compliance_store_status(uuid) to authenticated;

-- Declarar o retirar una categoría. Declarar exige que los productos publicados
-- ya estén clasificados; si una publicación concurrente se cuela, la revisión
-- que se encola aquí la despublica.
create or replace function public.compliance_set_store_category(p_store_id uuid, p_category_key text,
                                                                p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_store_permission(p_store_id, 'store.update');
  v_store   public.stores;
  v_pending bigint;
begin
  select * into v_store from public.stores s where s.id = p_store_id for update;
  if p_enabled is null or not exists (select 1 from public.compliance_profiles cp
                                       where cp.country = v_store.country::text and cp.category_key = p_category_key) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'category';
  end if;

  if p_enabled then
    if exists (select 1 from public.store_regulated_categories d
                where d.store_id = p_store_id and d.category_key = p_category_key) then
      return;
    end if;
    select count(*) into v_pending from public.products p
     where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
       and not exists (select 1 from public.product_regulatory_info i where i.store_id = p.store_id and i.product_id = p.id);
    if v_pending > 0 then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'unclassified_products',
                            hint = v_pending::text;
    end if;
    insert into public.store_regulated_categories (store_id, category_key, created_by)
    values (p_store_id, p_category_key, v_uid);
    perform app.enqueue_compliance_recheck(null, p_store_id, null);
    perform audit.record('store.compliance_category_enabled', 'store', p_store_id, v_store.organization_id,
                         p_store_id, null, jsonb_build_object('category', p_category_key));
  else
    if not exists (select 1 from public.store_regulated_categories d
                    where d.store_id = p_store_id and d.category_key = p_category_key) then
      return;
    end if;
    -- Los productos eliminados no cuentan: su clasificación se descarta.
    delete from public.product_regulatory_info i
     using public.products p
     where i.store_id = p_store_id and i.category_key = p_category_key
       and p.store_id = i.store_id and p.id = i.product_id and p.deleted_at is not null;
    if exists (select 1 from public.product_regulatory_info i
                where i.store_id = p_store_id and i.category_key = p_category_key) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'category_in_use';
    end if;
    delete from public.store_regulated_categories d where d.store_id = p_store_id and d.category_key = p_category_key;
    perform audit.record('store.compliance_category_disabled', 'store', p_store_id, v_store.organization_id,
                         p_store_id, jsonb_build_object('category', p_category_key), null);
  end if;
end
$$;
revoke all on function public.compliance_set_store_category(uuid, text, boolean) from public;
grant execute on function public.compliance_set_store_category(uuid, text, boolean) to authenticated;

create or replace function public.catalog_get_regulatory_info(p_store_id uuid, p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_info public.product_regulatory_info;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  if not exists (select 1 from public.products p where p.store_id = p_store_id and p.id = p_product_id
                   and p.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  select * into v_info from public.product_regulatory_info i where i.store_id = p_store_id and i.product_id = p_product_id;
  if v_info.product_id is null then
    return null;
  end if;
  return jsonb_build_object('category_key', v_info.category_key, 'schema_version', v_info.schema_version,
                            'data', v_info.data, 'updated_at', v_info.updated_at);
end
$$;
revoke all on function public.catalog_get_regulatory_info(uuid, uuid) from public;
grant execute on function public.catalog_get_regulatory_info(uuid, uuid) to authenticated;

-- Clasifica el producto y guarda su ficha. Un producto publicado no puede
-- quedar sin cumplir (mismo criterio que catalog_upsert_product, Gate F3).
create or replace function public.catalog_save_regulatory_info(p_store_id uuid, p_product_id uuid,
                                                               p_category_key text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_store_permission(p_store_id, 'products.update');
  v_product public.products;
  v_before  public.product_regulatory_info;
  v_data    jsonb := '{}'::jsonb;
  v_errors  text;
begin
  v_product := app.lock_product(p_store_id, p_product_id);
  if p_category_key is not null then
    if not exists (select 1 from public.store_regulated_categories d
                    where d.store_id = p_store_id and d.category_key = p_category_key) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'category';
    end if;
    v_data := app.regulatory_normalize(p_category_key, coalesce(p_data, '{}'::jsonb));
  end if;

  select * into v_before from public.product_regulatory_info i
   where i.store_id = p_store_id and i.product_id = p_product_id;
  insert into public.product_regulatory_info (store_id, product_id, category_key, data, updated_by)
  values (p_store_id, p_product_id, p_category_key, v_data, v_uid)
  on conflict (product_id) do update
    set category_key = excluded.category_key, data = excluded.data, updated_by = excluded.updated_by;

  if v_product.status = 'active' then
    select string_agg(v.code, ',') into v_errors
      from app.validate_product_for_publish(p_product_id) v where v.level = 'error';
    if v_errors is not null then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish', hint = v_errors;
    end if;
  end if;

  perform audit.record('product.regulatory_updated', 'product', p_product_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       case when v_before.product_id is not null then
                         jsonb_build_object('category', v_before.category_key,
                                            'fields', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                                                         from jsonb_object_keys(v_before.data) k)) end,
                       jsonb_build_object('category', p_category_key,
                                          'fields', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                                                       from jsonb_object_keys(v_data) k)));
end
$$;
revoke all on function public.catalog_save_regulatory_info(uuid, uuid, text, jsonb) from public;
grant execute on function public.catalog_save_regulatory_info(uuid, uuid, text, jsonb) to authenticated;

-- Clasificación masiva como "no regulado" de productos aún sin clasificar (la
-- ficha de un suplemento se captura producto por producto). Devuelve cuántos.
create or replace function public.catalog_classify_unregulated(p_store_id uuid, p_product_ids uuid[])
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
  if p_product_ids is null or cardinality(p_product_ids) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'product_ids';
  end if;
  for v_id in
    insert into public.product_regulatory_info (store_id, product_id, category_key, updated_by)
    select p_store_id, p.id, null, v_uid
      from public.products p
     where p.store_id = p_store_id and p.id = any (p_product_ids) and p.deleted_at is null
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
revoke all on function public.catalog_classify_unregulated(uuid, uuid[]) from public;
grant execute on function public.catalog_classify_unregulated(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. RPC de la plataforma (platform_owner / platform_admin con aal2; la
--     auditoría la escribe audit.log_change en cada tabla)
-- -----------------------------------------------------------------------------
create or replace function public.platform_compliance_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin', 'platform_support']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', cp.id, 'country', cp.country, 'category_key', cp.category_key, 'category_name', rc.name,
             'status', cp.status, 'version', cp.version, 'reviewed_by', cp.reviewed_by,
             'reviewed_at', cp.reviewed_at, 'review_notes', cp.review_notes,
             'rules', coalesce((select jsonb_agg(jsonb_build_object(
                                         'id', r.id, 'kind', r.kind, 'key', r.key, 'label', r.label, 'body', r.body,
                                         'field_key', r.field_key, 'placements', r.placements,
                                         'position', r.position, 'status', r.status)
                                       order by r.status, r.position, r.key)
                                  from public.compliance_rules r where r.profile_id = cp.id), '[]'::jsonb))
           order by cp.country, rc.name)
      from public.compliance_profiles cp
      join public.regulated_categories rc on rc.key = cp.category_key), '[]'::jsonb);
end
$$;
revoke all on function public.platform_compliance_list() from public;
grant execute on function public.platform_compliance_list() to authenticated;

-- Un cambio en un perfil activo sube su versión y encola la revisión de los
-- productos publicados de esa categoría (pueden dejar de cumplir).
create or replace function app.compliance_profile_changed(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  update public.compliance_profiles set version = version + 1
   where id = p_profile_id and status = 'active'
  returning version into v_version;
  if v_version is not null then
    perform app.enqueue_compliance_recheck(p_profile_id, null,
                                           'compliance.recheck:' || p_profile_id::text || ':v' || v_version);
  end if;
end
$$;
revoke all on function app.compliance_profile_changed(uuid) from public;

create or replace function public.platform_compliance_rule_save(p_profile_id uuid, p_rule jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile    public.compliance_profiles;
  v_kind       text := p_rule ->> 'kind';
  v_key        text := p_rule ->> 'key';
  v_label      text := btrim(p_rule ->> 'label');
  v_body       text := nullif(btrim(p_rule ->> 'body'), '');
  v_field      text := nullif(p_rule ->> 'field_key', '');
  v_placements text[];
  v_position   integer;
  v_existing   public.compliance_rules;
  v_id         uuid;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  select * into v_profile from public.compliance_profiles cp where cp.id = p_profile_id for update;
  if v_profile.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'profile';
  end if;
  if jsonb_typeof(p_rule) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rule';
  end if;
  if v_kind is null or v_kind not in ('required_field', 'required_legend', 'forbidden_term') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'kind';
  end if;
  if v_key is null or v_key !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'key';
  end if;
  if coalesce(char_length(v_label), 0) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'label';
  end if;
  if v_kind = 'required_field' then
    if v_field is null or not (v_field = any (app.regulatory_fields(v_profile.category_key))) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'field_key';
    end if;
    v_body := null;
  else
    v_field := null;
    if v_body is null or char_length(v_body) > (case v_kind when 'forbidden_term' then 60 else 2000 end)
       or (v_kind = 'forbidden_term' and char_length(v_body) < 2) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body';
    end if;
  end if;
  if v_kind = 'required_legend' then
    if jsonb_typeof(p_rule -> 'placements') is distinct from 'array' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'placements';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_placements from jsonb_array_elements_text(p_rule -> 'placements') x;
    if cardinality(v_placements) = 0 or not (v_placements <@ array['product_page', 'cart', 'checkout']) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'placements';
    end if;
  else
    v_placements := '{}';
  end if;
  begin
    v_position := coalesce((p_rule ->> 'position')::integer, 0);
  exception when others then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'position';
  end;
  if v_position not between 0 and 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'position';
  end if;

  select * into v_existing from public.compliance_rules r where r.profile_id = p_profile_id and r.key = v_key;
  if v_existing.id is not null and v_existing.kind <> v_kind then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'kind';
  end if;
  insert into public.compliance_rules (profile_id, kind, key, label, body, field_key, placements, position, status)
  values (p_profile_id, v_kind, v_key, v_label, v_body, v_field, v_placements, v_position, 'active')
  on conflict (profile_id, key) do update
    set label = excluded.label, body = excluded.body, field_key = excluded.field_key,
        placements = excluded.placements, position = excluded.position, status = 'active'
  returning id into v_id;
  perform app.compliance_profile_changed(p_profile_id);
  return v_id;
end
$$;
revoke all on function public.platform_compliance_rule_save(uuid, jsonb) from public;
grant execute on function public.platform_compliance_rule_save(uuid, jsonb) to authenticated;

create or replace function public.platform_compliance_rule_retire(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.compliance_rules;
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  select * into v_rule from public.compliance_rules r where r.id = p_rule_id;
  if v_rule.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'rule';
  end if;
  perform 1 from public.compliance_profiles cp where cp.id = v_rule.profile_id for update;
  if v_rule.status = 'retired' then
    return;
  end if;
  update public.compliance_rules set status = 'retired' where id = p_rule_id;
  perform app.compliance_profile_changed(v_rule.profile_id);
end
$$;
revoke all on function public.platform_compliance_rule_retire(uuid) from public;
grant execute on function public.platform_compliance_rule_retire(uuid) to authenticated;

-- Activar exige el nombre de quien revisó (el asesor) y queda con fecha.
-- Suspender o volver a pendiente despublica los productos de la categoría.
create or replace function public.platform_compliance_profile_set_status(p_profile_id uuid, p_status text,
                                                                         p_reviewed_by text, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile  public.compliance_profiles;
  v_reviewer text := nullif(btrim(p_reviewed_by), '');
  v_notes    text := nullif(btrim(p_notes), '');
begin
  perform app.require_platform_role(array['platform_owner', 'platform_admin']);
  select * into v_profile from public.compliance_profiles cp where cp.id = p_profile_id for update;
  if v_profile.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'profile';
  end if;
  if p_status is null or p_status not in ('pending', 'active', 'suspended') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'review_notes';
  end if;

  if p_status = 'active' then
    if v_reviewer is null or char_length(v_reviewer) not between 2 and 120 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reviewed_by';
    end if;
    update public.compliance_profiles
       set status = 'active', reviewed_by = v_reviewer, reviewed_at = now(), review_notes = v_notes,
           version = version + 1
     where id = p_profile_id;
  else
    if v_profile.status = p_status then
      return;
    end if;
    update public.compliance_profiles
       set status = p_status, review_notes = coalesce(v_notes, review_notes), version = version + 1
     where id = p_profile_id;
  end if;
  perform app.enqueue_compliance_recheck(p_profile_id, null,
    'compliance.recheck:' || p_profile_id::text || ':v' || (select cp.version from public.compliance_profiles cp
                                                             where cp.id = p_profile_id));
end
$$;
revoke all on function public.platform_compliance_profile_set_status(uuid, text, text, text) from public;
grant execute on function public.platform_compliance_profile_set_status(uuid, text, text, text) to authenticated;
