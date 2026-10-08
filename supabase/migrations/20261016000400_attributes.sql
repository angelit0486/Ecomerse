-- =============================================================================
-- Fase R · R-T04 — Atributos filtrables (ADR-022, GATE0 §14.4). La tienda define
-- sus atributos ("Objetivo", "Sabor"…) con su lista de valores; un producto lleva
-- varios. La tienda pública filtra por ellos con conteo por valor, en PostgreSQL
-- (ADR-020). `specs` sigue siendo solo de presentación.
--
-- Permisos sin claves nuevas (PermissionKey es contrato crítico, §43): definir
-- atributos es taxonomía del catálogo (`categories.manage`); asignarlos a un
-- producto es editarlo (`products.update`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas de tienda (store_id, RLS forzado, FK compuestas, §44.2)
-- -----------------------------------------------------------------------------
create table public.attributes (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  key           text not null,
  name          text not null,
  is_filterable boolean not null default true,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, key),
  -- La clave va en la URL de la tienda (?objetivo=energia): nunca un parámetro propio de los listados.
  constraint attributes_key_format check (key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and char_length(key) <= 40),
  constraint attributes_key_reserved check (key not in ('q', 'orden', 'disponible', 'desde', 'marca', 'categoria',
                                                        'precio', 'pagina', 'vista', 'filtro', 'filtros', 'buscar')),
  constraint attributes_name_format check (char_length(name) between 1 and 60 and name = btrim(name)
                                           and name !~ '[[:cntrl:]]'),
  constraint attributes_position_range check (position between 0 and 10000)
);
create unique index attributes_name_uq on public.attributes (store_id, lower(name));

create table public.attribute_values (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores (id) on delete cascade,
  attribute_id uuid not null,
  key          text not null,
  label        text not null,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (store_id, id),
  unique (attribute_id, key),
  foreign key (store_id, attribute_id) references public.attributes (store_id, id) on delete cascade,
  constraint attribute_values_key_format check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(key) <= 60),
  constraint attribute_values_label_format check (char_length(label) between 1 and 60 and label = btrim(label)
                                                  and label !~ '[[:cntrl:]]'),
  constraint attribute_values_position_range check (position between 0 and 10000)
);
create unique index attribute_values_label_uq on public.attribute_values (attribute_id, lower(label));

create table public.product_attribute_values (
  product_id uuid not null,
  value_id   uuid not null,
  store_id   uuid not null references public.stores (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, value_id),
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade,
  foreign key (store_id, value_id) references public.attribute_values (store_id, id) on delete cascade
);
create index product_attribute_values_value_idx on public.product_attribute_values (store_id, value_id, product_id);

create trigger attributes_set_updated_at before update on public.attributes
  for each row execute function app.set_updated_at();
create trigger attribute_values_set_updated_at before update on public.attribute_values
  for each row execute function app.set_updated_at();
create trigger attributes_prevent_tenant_change before update on public.attributes
  for each row execute function app.prevent_tenant_change();
create trigger attribute_values_prevent_tenant_change before update on public.attribute_values
  for each row execute function app.prevent_tenant_change();
create trigger product_attribute_values_prevent_tenant_change before update on public.product_attribute_values
  for each row execute function app.prevent_tenant_change();
create trigger attribute_values_immutable before update on public.attribute_values
  for each row execute function app.prevent_column_change('attribute_id');
create trigger product_attribute_values_immutable before update on public.product_attribute_values
  for each row execute function app.prevent_column_change('product_id', 'value_id');
-- Asignar o quitar un valor recalcula la búsqueda del producto (los valores entran en el vector).
create trigger product_attribute_values_touch after insert or update or delete on public.product_attribute_values
  for each row execute function app.touch_product();

-- Renombrar un valor recalcula la búsqueda de sus productos.
create or replace function app.touch_products_of_value()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- La clave temporal de catalog_save_attribute no cuenta: el nombre final llega enseguida.
  if new.label is distinct from old.label and new.label !~ '^tmp-[0-9a-f]{32}$' then
    update public.products p set updated_at = now()
      from public.product_attribute_values pav
     where pav.store_id = new.store_id and pav.value_id = new.id and p.id = pav.product_id;
  end if;
  return null;
end
$$;
revoke all on function app.touch_products_of_value() from public;
create trigger attribute_values_touch_products after update of label on public.attribute_values
  for each row execute function app.touch_products_of_value();

alter table public.attributes enable row level security;
alter table public.attributes force row level security;
alter table public.attribute_values enable row level security;
alter table public.attribute_values force row level security;
alter table public.product_attribute_values enable row level security;
alter table public.product_attribute_values force row level security;

revoke all on table public.attributes, public.attribute_values, public.product_attribute_values
  from public, anon, authenticated, service_role;
grant select on table public.attributes, public.attribute_values, public.product_attribute_values to authenticated;

create policy attributes_select on public.attributes for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy attribute_values_select on public.attribute_values for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy product_attribute_values_select on public.product_attribute_values for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));

-- -----------------------------------------------------------------------------
-- 2. Búsqueda (§23): los valores del producto pesan como las categorías (C)
-- -----------------------------------------------------------------------------
create or replace function app.product_search_vector(p_product public.products)
returns tsvector
language sql
stable
set search_path = ''
as $$
  select
    setweight(to_tsvector('spanish', extensions.unaccent(coalesce(p_product.title, ''))), 'A')
    || setweight(to_tsvector('spanish', extensions.unaccent(concat_ws(' ',
         (select b.name from public.brands b where b.store_id = p_product.store_id and b.id = p_product.brand_id),
         array_to_string(p_product.tags, ' '),
         (select string_agg(pv.sku, ' ') from public.product_variants pv
           where pv.product_id = p_product.id and pv.deleted_at is null)))), 'B')
    || setweight(to_tsvector('spanish', extensions.unaccent(concat_ws(' ',
         (select string_agg(c.name, ' ') from public.product_categories pc
            join public.categories c on c.id = pc.category_id
           where pc.product_id = p_product.id and c.deleted_at is null),
         (select string_agg(av.label, ' ') from public.product_attribute_values pav
            join public.attribute_values av on av.id = pav.value_id
           where pav.product_id = p_product.id)))), 'C')
    || setweight(to_tsvector('spanish', extensions.unaccent(left(
         regexp_replace(coalesce(p_product.description_html, ''), '<[^>]*>', ' ', 'g'), 20000))), 'D')
$$;
revoke all on function app.product_search_vector(public.products) from public;

-- -----------------------------------------------------------------------------
-- 3. Cumplimiento (ADR-021): el nombre y los valores de los atributos se ven
--    junto al producto, así que también se revisan contra los términos prohibidos.
--    Igual que en R-T01, más los atributos en el texto revisado.
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
    (select string_agg(n ->> 'name', ' ') from jsonb_array_elements(coalesce(v_info.data -> 'nutrition', '[]')) n),
    (select string_agg(a.name || ' ' || av.label, ' ')
       from public.product_attribute_values pav
       join public.attribute_values av on av.id = pav.value_id
       join public.attributes a on a.id = av.attribute_id
      where pav.product_id = p_product_id)));
  return query
    select 'compliance_forbidden_term:' || r.key, 'error'::text
      from public.compliance_rules r
     where r.profile_id = v_profile.id and r.status = 'active' and r.kind = 'forbidden_term'
       and v_corpus ~ app.compliance_term_regex(r.body)
     order by r.position, r.key;
end
$$;
revoke all on function app.validate_product_compliance(uuid) from public;

-- -----------------------------------------------------------------------------
-- 4. Listados de la tienda pública
-- -----------------------------------------------------------------------------

-- Filtros de la URL ({"objetivo": ["energia", "fuerza"]}) → valores de atributos
-- filtrables de la tienda. Claves o valores desconocidos se ignoran (como un
-- cursor manipulado); la forma y el tamaño se validan.
create or replace function app.attribute_selection(p_store_id uuid, p_attributes jsonb)
returns table (attribute_id uuid, value_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_attributes is null or p_attributes = '{}'::jsonb then
    return;
  end if;
  if jsonb_typeof(p_attributes) <> 'object'
     or (select count(*) from jsonb_object_keys(p_attributes)) > 10
     or exists (select 1 from jsonb_each(p_attributes) e
                 where jsonb_typeof(e.value) <> 'array' or jsonb_array_length(e.value) > 20
                    or exists (select 1 from jsonb_array_elements(e.value) x where jsonb_typeof(x) <> 'string')) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'attributes';
  end if;
  return query
    select distinct av.attribute_id, av.id
      from jsonb_each(p_attributes) e
      join public.attributes a on a.store_id = p_store_id and a.key = e.key and a.is_filterable
      join public.attribute_values av on av.store_id = p_store_id and av.attribute_id = a.id
     where av.key in (select jsonb_array_elements_text(e.value));
end
$$;
revoke all on function app.attribute_selection(uuid, jsonb) from public;

-- Productos de un listado (categoría con sus descendientes, marca, búsqueda y
-- precio): la misma definición para la página de resultados y para los conteos
-- de los filtros.
create or replace function app.listing_products(p_store_id uuid, p_category_path text, p_brand_slug text,
                                                p_query text, p_min_price bigint, p_max_price bigint)
returns table (product_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q   text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq tsquery;
begin
  if v_q is not null then
    v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(left(v_q, 200)));
  end if;
  return query
    select p.id
      from public.products p
      left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
       and (p_category_path is null or exists (
              select 1 from public.product_categories pc
                join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
               where pc.product_id = p.id and c.deleted_at is null and app.category_public(p_store_id, c.id)
                 and (c.path = p_category_path or c.path like p_category_path || '/%')))
       and (p_brand_slug is null or b.slug = p_brand_slug)
       and (p_min_price is null or p.min_price >= p_min_price)
       and (p_max_price is null or p.min_price <= p_max_price)
       and (v_q is null
            or p.search_vector @@ v_tsq
            or extensions.similarity(p.title, v_q) > 0.3
            or exists (select 1 from public.product_variants sv
                        where sv.product_id = p.id and sv.deleted_at is null and sv.status = 'active'
                          and (sv.sku = upper(v_q) or sv.barcode = v_q)));
end
$$;
revoke all on function app.listing_products(uuid, text, text, text, bigint, bigint) from public;

-- Cuántos de los atributos seleccionados cumple un producto (OR dentro de un atributo).
create or replace function app.product_attribute_groups(p_store_id uuid, p_product_id uuid, p_values uuid[])
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct av.attribute_id)::integer
    from public.product_attribute_values pav
    join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
   where pav.product_id = p_product_id and pav.store_id = p_store_id and pav.value_id = any (p_values)
$$;
revoke all on function app.product_attribute_groups(uuid, uuid, uuid[]) from public;

-- Mismo contrato que F5 más `p_attributes` (al final, con default: las llamadas
-- existentes no cambian). Entre atributos se exigen todos (AND).
drop function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer);
create function storefront.list_products(
  p_store_id      uuid,
  p_category_path text default null,
  p_brand_slug    text default null,
  p_query         text default null,
  p_sort          text default null,
  p_min_price     bigint default null,
  p_max_price     bigint default null,
  p_available     boolean default false,
  p_cursor        jsonb default null,
  p_limit         integer default 24,
  p_attributes    jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_tsq    tsquery;
  v_sort   text := coalesce(p_sort, case when nullif(btrim(coalesce(p_query, '')), '') is null
                                         then 'newest' else 'relevance' end);
  v_limit  integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_c_key  numeric := (p_cursor ->> 'k')::numeric;
  v_c_id   uuid := (p_cursor ->> 'id')::uuid;
  v_values uuid[];
  v_groups integer;
  v_items  jsonb;
  v_more   boolean;
  v_next   jsonb;
begin
  if not app.store_publicly_readable(p_store_id) then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;
  if v_sort not in ('relevance', 'newest', 'price_asc', 'price_desc', 'best_selling')
     or (v_sort = 'relevance' and v_q is null) then
    v_sort := 'newest';
  end if;
  if v_q is not null then
    v_tsq := websearch_to_tsquery('spanish', extensions.unaccent(left(v_q, 200)));
  end if;
  select coalesce(array_agg(s.value_id), '{}'), count(distinct s.attribute_id)
    into v_values, v_groups
    from app.attribute_selection(p_store_id, p_attributes) s;

  with base as (
    select p.id,
           case v_sort
             when 'newest' then extract(epoch from p.published_at)::numeric
             when 'price_asc' then -coalesce(p.min_price, 9223372036854775807)::numeric
             when 'price_desc' then coalesce(p.min_price, -1)::numeric
             when 'best_selling' then p.sales_count::numeric
             else round((ts_rank(p.search_vector, v_tsq)
                         + extensions.similarity(p.title, v_q)
                         + case when exists (select 1 from public.product_variants sv
                                              where sv.product_id = p.id and sv.deleted_at is null
                                                and sv.status = 'active' and (sv.sku = upper(v_q) or sv.barcode = v_q))
                                then 10 else 0 end)::numeric, 6)
           end as k,
           p.slug, p.title, b.name as brand, p.min_price, p.max_price,
           (select min(v.compare_at_price) from public.product_variants v
             where v.product_id = p.id and v.status = 'active' and v.deleted_at is null
               and v.price = p.min_price) as compare_at
      from app.listing_products(p_store_id, p_category_path, p_brand_slug, v_q, p_min_price, p_max_price) l
      join public.products p on p.store_id = p_store_id and p.id = l.product_id
      left join public.brands b on b.store_id = p.store_id and b.id = p.brand_id and b.deleted_at is null
     where v_groups = 0 or app.product_attribute_groups(p_store_id, p.id, v_values) = v_groups
  ),
  page as (
    select b.*, row_number() over (order by b.k desc, b.id desc) as rn
      from base b
     where (v_c_key is null or (b.k, b.id) < (v_c_key, v_c_id))
       and (not coalesce(p_available, false) or app.product_state(p_store_id, b.id) <> 'out_of_stock')
     order by b.k desc, b.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'slug', x.slug, 'title', x.title, 'brand', x.brand,
           'min_price', x.min_price, 'max_price', x.max_price, 'compare_at_price', x.compare_at,
           'availability', app.product_state(p_store_id, x.id),
           'image', app.product_cover(p_store_id, x.id)) order by x.rn) filter (where x.rn <= v_limit), '[]'::jsonb),
         count(*) > v_limit,
         (array_agg(jsonb_build_object('k', x.k, 'id', x.id) order by x.rn))[v_limit]
    into v_items, v_more, v_next
    from page x;

  return jsonb_build_object('items', v_items, 'sort', v_sort, 'next_cursor', case when v_more then v_next end);
end
$$;
revoke all on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb, integer,
                                                jsonb) from public;
grant execute on function storefront.list_products(uuid, text, text, text, text, bigint, bigint, boolean, jsonb,
                                                   integer, jsonb) to storefront_gateway;

-- Filtros con conteo (faceted search): el conteo de un valor del atributo A son
-- los productos del listado con ese valor que cumplen los demás atributos
-- seleccionados (no A), así se puede sumar otra opción del mismo atributo. Sin
-- productos, un valor no se muestra (salvo si está seleccionado).
create or replace function storefront.list_facets(
  p_store_id      uuid,
  p_category_path text default null,
  p_brand_slug    text default null,
  p_query         text default null,
  p_available     boolean default false,
  p_attributes    jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_values uuid[];
  v_attrs  uuid[];
  v_result jsonb;
begin
  if not app.store_publicly_readable(p_store_id) then
    return '[]'::jsonb;
  end if;
  select coalesce(array_agg(s.value_id), '{}'), coalesce(array_agg(distinct s.attribute_id), '{}')
    into v_values, v_attrs
    from app.attribute_selection(p_store_id, p_attributes) s;

  with base as (
    select l.product_id
      from app.listing_products(p_store_id, p_category_path, p_brand_slug, v_q, null, null) l
     where not coalesce(p_available, false) or app.product_state(p_store_id, l.product_id) <> 'out_of_stock'
  ),
  hits as (
    select b.product_id, av.attribute_id
      from base b
      join public.product_attribute_values pav on pav.store_id = p_store_id and pav.product_id = b.product_id
      join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
     where pav.value_id = any (v_values)
     group by b.product_id, av.attribute_id
  ),
  sat as (
    select b.product_id, count(h.attribute_id)::integer as n
      from base b
      left join hits h on h.product_id = b.product_id
     group by b.product_id
  ),
  counts as (
    select pav.value_id, count(*)::integer as n
      from sat s
      join public.product_attribute_values pav on pav.store_id = p_store_id and pav.product_id = s.product_id
      join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
     where s.n = cardinality(v_attrs)
        or (av.attribute_id = any (v_attrs) and s.n = cardinality(v_attrs) - 1
            and not exists (select 1 from hits h where h.product_id = s.product_id and h.attribute_id = av.attribute_id))
     group by pav.value_id
  )
  select coalesce(jsonb_agg(f.facet order by f.position, f.name), '[]'::jsonb) into v_result
    from (select a.position, a.name,
                 jsonb_build_object('key', a.key, 'name', a.name, 'values',
                   jsonb_agg(jsonb_build_object('key', av.key, 'label', av.label, 'count', coalesce(c.n, 0),
                                                'selected', av.id = any (v_values))
                             order by av.position, av.label)) as facet
            from public.attributes a
            join public.attribute_values av on av.store_id = a.store_id and av.attribute_id = a.id
            left join counts c on c.value_id = av.id
           where a.store_id = p_store_id and a.is_filterable
             and (c.n is not null or av.id = any (v_values))
           group by a.id, a.position, a.name, a.key) f;
  return v_result;
end
$$;
revoke all on function storefront.list_facets(uuid, text, text, text, boolean, jsonb) from public;
grant execute on function storefront.list_facets(uuid, text, text, text, boolean, jsonb) to storefront_gateway;

-- Atributos de un producto publicado, para su ficha.
create or replace function storefront.get_product_attributes(p_store_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.attr order by x.position, x.name), '[]'::jsonb)
    from (select a.position, a.name,
                 jsonb_build_object('key', a.key, 'name', a.name, 'filterable', a.is_filterable,
                   'values', jsonb_agg(jsonb_build_object('key', av.key, 'label', av.label)
                                       order by av.position, av.label)) as attr
            from public.products p
            join public.product_attribute_values pav on pav.store_id = p.store_id and pav.product_id = p.id
            join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
            join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
           where p.store_id = p_store_id and p.slug = p_slug and p.status = 'active' and p.deleted_at is null
             and app.store_publicly_readable(p_store_id)
           group by a.id, a.position, a.name, a.key, a.is_filterable) x
$$;
revoke all on function storefront.get_product_attributes(uuid, text) from public;
grant execute on function storefront.get_product_attributes(uuid, text) to storefront_gateway;

-- -----------------------------------------------------------------------------
-- 5. RPC del panel
-- -----------------------------------------------------------------------------
create or replace function public.catalog_list_attributes(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'key', a.key, 'name', a.name, 'is_filterable', a.is_filterable, 'position', a.position,
             'products', (select count(distinct pav.product_id) from public.product_attribute_values pav
                            join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
                            join public.products p on p.store_id = pav.store_id and p.id = pav.product_id
                           where pav.store_id = p_store_id and av.attribute_id = a.id and p.deleted_at is null),
             'values', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', av.id, 'key', av.key, 'label', av.label, 'position', av.position,
                        'products', (select count(*) from public.product_attribute_values pav
                                       join public.products p on p.store_id = pav.store_id and p.id = pav.product_id
                                      where pav.store_id = p_store_id and pav.value_id = av.id
                                        and p.deleted_at is null))
                      order by av.position, av.label)
                 from public.attribute_values av
                where av.store_id = p_store_id and av.attribute_id = a.id), '[]'::jsonb))
           order by a.position, a.name)
      from public.attributes a
     where a.store_id = p_store_id), '[]'::jsonb);
end
$$;
revoke all on function public.catalog_list_attributes(uuid) from public;
grant execute on function public.catalog_list_attributes(uuid) to authenticated;

create or replace function public.catalog_product_attribute_values(p_store_id uuid, p_product_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  if not exists (select 1 from public.products p where p.store_id = p_store_id and p.id = p_product_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  return coalesce((select array_agg(pav.value_id order by pav.value_id) from public.product_attribute_values pav
                    where pav.store_id = p_store_id and pav.product_id = p_product_id), '{}');
end
$$;
revoke all on function public.catalog_product_attribute_values(uuid, uuid) from public;
grant execute on function public.catalog_product_attribute_values(uuid, uuid) to authenticated;

-- Crea o edita un atributo con su lista completa de valores: los que traen id se
-- actualizan, los nuevos se crean y los que faltan se borran (salen de sus
-- productos). Las claves son las de la URL de la tienda: se conservan al
-- renombrar, y una nueva sale del nombre. Hasta 20 atributos por tienda y 50
-- valores por atributo. Un producto publicado no puede quedar con un término
-- prohibido (ADR-021).
create or replace function public.catalog_save_attribute(p_store_id uuid, p_attribute jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_name    text := btrim(coalesce(p_attribute ->> 'name', ''));
  v_key     text;
  v_values  jsonb := coalesce(p_attribute -> 'values', '[]'::jsonb);
  v_value   jsonb;
  v_vid     uuid;
  v_vids    uuid[] := '{}';
  v_labels  text[] := '{}';
  v_keys    text[] := '{}';
  v_vlabel  text;
  v_vkey    text;
  v_base    text;
  v_n       integer;
  v_pos     integer := 0;
  v_before  jsonb;
  v_errors  text;
  v_constraint text;
begin
  perform app.require_store_permission(p_store_id, 'categories.manage');
  if p_attribute is null or jsonb_typeof(p_attribute) <> 'object' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'attribute';
  end if;
  begin
    v_id := nullif(p_attribute ->> 'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'attribute';
  end;
  if char_length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  v_key := nullif(btrim(p_attribute ->> 'key'), '');
  if v_key is null and v_id is not null then
    select a.key into v_key from public.attributes a where a.store_id = p_store_id and a.id = v_id;
  end if;
  v_key := coalesce(v_key, app.slugify(v_name));
  if v_key !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' or char_length(v_key) > 40
     or v_key in ('q', 'orden', 'disponible', 'desde', 'marca', 'categoria', 'precio', 'pagina', 'vista', 'filtro',
                  'filtros', 'buscar') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'key';
  end if;
  if jsonb_typeof(v_values) <> 'array' or jsonb_array_length(v_values) not between 1 and 50 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'values';
  end if;

  -- Valores: forma, nombres únicos y claves antes de tocar nada.
  for v_value in select e.value from jsonb_array_elements(v_values) e loop
    if jsonb_typeof(v_value) <> 'object' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'values';
    end if;
    v_vlabel := btrim(coalesce(v_value ->> 'label', ''));
    if char_length(v_vlabel) not between 1 and 60 or v_vlabel ~ '[[:cntrl:]]' or lower(v_vlabel) = any (v_labels) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'values';
    end if;
    begin
      v_vid := nullif(v_value ->> 'id', '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'values';
    end;
    v_vkey := nullif(btrim(v_value ->> 'key'), '');
    if v_vid is not null then
      if v_vid = any (v_vids) then
        raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'values';
      end if;
      if v_vkey is null then
        select av.key into v_vkey from public.attribute_values av
         where av.store_id = p_store_id and av.attribute_id = v_id and av.id = v_vid;
        if v_vkey is null then
          raise exception using errcode = 'P0001', message = 'not_found', detail = 'value';
        end if;
      end if;
      v_vids := v_vids || v_vid;
    end if;
    v_labels := v_labels || lower(v_vlabel);
    v_keys := v_keys || v_vkey;  -- null: valor nuevo sin clave, se asigna abajo
  end loop;
  -- Clave de un valor nuevo: su nombre, con sufijo si ya la usa otro.
  for v_pos in 1 .. jsonb_array_length(v_values) loop
    if v_keys[v_pos] is null then
      v_base := left(app.slugify(v_values -> (v_pos - 1) ->> 'label'), 55);
      v_vkey := v_base;
      v_n := 1;
      while v_vkey = any (v_keys) loop
        v_n := v_n + 1;
        v_vkey := v_base || '-' || v_n;
      end loop;
      v_keys[v_pos] := v_vkey;
    end if;
  end loop;
  if exists (select 1 from unnest(v_keys) k where k !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(k) > 60)
     or (select count(distinct k) from unnest(v_keys) k) <> cardinality(v_keys) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'values';
  end if;

  -- Un candado por tienda: dos altas a la vez no rebasan el máximo.
  perform pg_advisory_xact_lock(hashtextextended('attributes:' || p_store_id::text, 0));
  begin
    if v_id is null then
      if (select count(*) from public.attributes a where a.store_id = p_store_id) >= 20 then
        raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'attributes_limit';
      end if;
      insert into public.attributes (store_id, key, name, is_filterable, position)
      values (p_store_id, v_key, v_name, coalesce((p_attribute ->> 'is_filterable')::boolean, true),
              coalesce((p_attribute ->> 'position')::integer, 0))
      returning id into v_id;
    else
      select jsonb_build_object('name', a.name, 'key', a.key, 'is_filterable', a.is_filterable,
                                'values', (select count(*) from public.attribute_values av where av.attribute_id = a.id))
        into v_before
        from public.attributes a
       where a.store_id = p_store_id and a.id = v_id
         for update;
      if v_before is null then
        raise exception using errcode = 'P0001', message = 'not_found', detail = 'attribute';
      end if;
      update public.attributes
         set key = v_key, name = v_name,
             is_filterable = coalesce((p_attribute ->> 'is_filterable')::boolean, is_filterable),
             position = coalesce((p_attribute ->> 'position')::integer, position)
       where store_id = p_store_id and id = v_id;
    end if;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception using errcode = 'P0001', message = 'validation_failed',
                            detail = case when v_constraint = 'attributes_name_uq' then 'name' else 'key' end;
    when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'attribute';
  end;

  -- Primero se borran los que faltan, y los que cambian de clave o de nombre toman
  -- una temporal: renombrar o intercambiar nombres nunca choca con las claves
  -- únicas a medio camino.
  delete from public.attribute_values
   where store_id = p_store_id and attribute_id = v_id and not (id = any (v_vids));
  update public.attribute_values av
     set key = 'tmp-' || replace(av.id::text, '-', ''), label = 'tmp-' || replace(av.id::text, '-', '')
    from (select (e.value ->> 'id')::uuid as id, e.ordinality::integer as pos
            from jsonb_array_elements(v_values) with ordinality e
           where nullif(e.value ->> 'id', '') is not null) x
   where av.store_id = p_store_id and av.attribute_id = v_id and av.id = x.id
     and (av.key <> v_keys[x.pos] or lower(av.label) <> v_labels[x.pos]);
  v_pos := 0;
  for v_value in select e.value from jsonb_array_elements(v_values) e loop
    v_pos := v_pos + 1;
    v_vid := nullif(v_value ->> 'id', '')::uuid;
    if v_vid is null then
      insert into public.attribute_values (store_id, attribute_id, key, label, position)
      values (p_store_id, v_id, v_keys[v_pos], btrim(v_value ->> 'label'), v_pos);
    else
      update public.attribute_values
         set key = v_keys[v_pos], label = btrim(v_value ->> 'label'), position = v_pos
       where store_id = p_store_id and attribute_id = v_id and id = v_vid;
    end if;
  end loop;

  select string_agg(distinct c.code, ',' order by c.code) into v_errors
    from public.products p
    cross join lateral app.validate_product_compliance(p.id) c
   where p.store_id = p_store_id and p.status = 'active' and p.deleted_at is null
     and c.level = 'error' and starts_with(c.code, 'compliance_forbidden_term:')
     and exists (select 1 from public.product_attribute_values pav
                   join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
                  where pav.store_id = p_store_id and pav.product_id = p.id and av.attribute_id = v_id);
  if v_errors is not null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish', hint = v_errors;
  end if;

  perform audit.record('attribute.saved', 'attribute', v_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       v_before,
                       jsonb_build_object('name', v_name, 'key', v_key,
                                          'is_filterable', (select a.is_filterable from public.attributes a
                                                             where a.id = v_id),
                                          'values', jsonb_array_length(v_values)));
  return v_id;
end
$$;
revoke all on function public.catalog_save_attribute(uuid, jsonb) from public;
grant execute on function public.catalog_save_attribute(uuid, jsonb) to authenticated;

create or replace function public.catalog_delete_attribute(p_store_id uuid, p_attribute_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  perform app.require_store_permission(p_store_id, 'categories.manage');
  delete from public.attributes a where a.store_id = p_store_id and a.id = p_attribute_id
  returning a.name into v_name;
  if v_name is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'attribute';
  end if;
  perform audit.record('attribute.deleted', 'attribute', p_attribute_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('name', v_name), null);
end
$$;
revoke all on function public.catalog_delete_attribute(uuid, uuid) from public;
grant execute on function public.catalog_delete_attribute(uuid, uuid) to authenticated;

-- Valores del producto (lista completa). Uno publicado sigue cumpliendo.
create or replace function public.catalog_set_product_attributes(p_store_id uuid, p_product_id uuid,
                                                                 p_value_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_ids     uuid[] := coalesce((select array_agg(distinct x) from unnest(p_value_ids) x where x is not null), '{}');
  v_before  jsonb;
  v_after   jsonb;
  v_errors  text;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  v_product := app.lock_product(p_store_id, p_product_id);
  if cardinality(v_ids) > 40
     or (select count(*) from public.attribute_values av where av.store_id = p_store_id and av.id = any (v_ids))
        <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'values';
  end if;

  select coalesce(jsonb_agg(a.key || ':' || av.key order by a.key, av.key), '[]'::jsonb) into v_before
    from public.product_attribute_values pav
    join public.attribute_values av on av.store_id = pav.store_id and av.id = pav.value_id
    join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
   where pav.store_id = p_store_id and pav.product_id = p_product_id;
  delete from public.product_attribute_values
   where store_id = p_store_id and product_id = p_product_id and not (value_id = any (v_ids));
  insert into public.product_attribute_values (store_id, product_id, value_id)
  select p_store_id, p_product_id, x from unnest(v_ids) x
  on conflict (product_id, value_id) do nothing;
  select coalesce(jsonb_agg(a.key || ':' || av.key order by a.key, av.key), '[]'::jsonb) into v_after
    from public.attribute_values av
    join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
   where av.store_id = p_store_id and av.id = any (v_ids);

  if v_product.status = 'active' then
    select string_agg(v.code, ',') into v_errors
      from app.validate_product_for_publish(p_product_id) v where v.level = 'error';
    if v_errors is not null then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'publish', hint = v_errors;
    end if;
  end if;

  if v_before is distinct from v_after then
    perform audit.record('product.attributes_updated', 'product', p_product_id,
                         (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                         jsonb_build_object('values', v_before), jsonb_build_object('values', v_after));
  end if;
end
$$;
revoke all on function public.catalog_set_product_attributes(uuid, uuid, uuid[]) from public;
grant execute on function public.catalog_set_product_attributes(uuid, uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Actividad (F8-T05): los atributos van en el área de catálogo
-- -----------------------------------------------------------------------------
create or replace function public.audit_list(p_store_id uuid, p_area text, p_cursor text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefixes text[];
  v_limit    integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_at       timestamptz;
  v_id       uuid;
  v_rows     jsonb;
  v_next     text;
begin
  perform app.require_store_permission(p_store_id, 'audit.read');
  v_prefixes := case coalesce(p_area, '')
    when '' then null
    when 'pedidos' then array['order.', 'payments.']
    when 'clientes' then array['customer.']
    when 'catalogo' then array['product.', 'brand.', 'category.', 'attribute.', 'media.', 'inventory.']
    when 'tienda' then array['store.', 'theme.', 'menu.', 'page.', 'shipping.', 'discount.', 'config.', 'flag.',
                             'override.']
    when 'equipo' then array['member.', 'support_session.']
    when 'datos' then array['import.', 'export.']
    else array['invalid'] end;
  if v_prefixes = array['invalid'] then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'area';
  end if;
  if p_cursor is not null then
    begin
      v_at := split_part(p_cursor, '|', 1)::timestamptz;
      v_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'cursor';
    end;
  end if;

  with page as (
    select a.id, a.occurred_at, a.actor_type, a.actor_user_id, a.actor_label, a.support_grant_id is not null as via_support,
           a.action, a.entity_type, a.entity_id, a.before, a.after, a.reason
      from audit.audit_logs a
     where a.store_id = p_store_id
       and (v_prefixes is null or exists (select 1 from unnest(v_prefixes) p where starts_with(a.action, p)))
       and (v_at is null or (a.occurred_at, a.id) < (v_at, v_id))
     order by a.occurred_at desc, a.id desc
     limit v_limit + 1
  ), numbered as (
    -- APP-M2: un actor ajeno a la organización (comprador) nunca se muestra con su email.
    select page.*, row_number() over (order by occurred_at desc, id desc) as rn, count(*) over () as total,
           (page.actor_type = 'user' and page.actor_label like '%@%' and page.actor_label not like 'Cliente %'
            and not exists (
              select 1 from public.organization_members m join public.stores s on s.organization_id = m.organization_id
               where s.id = p_store_id and m.user_id = page.actor_user_id)) as is_buyer
      from page
  )
  select coalesce(jsonb_agg(jsonb_build_object('occurred_at', occurred_at, 'actor_type', actor_type,
                                               'actor_label', case when is_buyer then 'Cliente ' || coalesce(app.mask_email(actor_label), '')
                                                                   else actor_label end,
                                               'via_support', via_support,
                                               'action', action, 'entity_type', entity_type, 'entity_id', entity_id,
                                               'before', before, 'after', after, 'reason', reason)
                            order by occurred_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         max(case when rn = v_limit and total > v_limit then occurred_at::text || '|' || id end)
    into v_rows, v_next
    from numbered;
  return jsonb_build_object('items', v_rows, 'next_cursor', v_next);
end
$$;
revoke all on function public.audit_list(uuid, text, text, integer) from public;
grant execute on function public.audit_list(uuid, text, text, integer) to authenticated;
