-- =============================================================================
-- Fase 3 · Catálogo: tablas, invariantes y RLS (F3-T01)
-- Contrato: GATE0 §13 (FK compuestas sin excepciones), §14.1–§14.2 (modelo),
-- §23 (búsqueda: FTS spanish + unaccent + trigram con índices por tienda),
-- §44 (reglas de no regresión).
--
-- Lecturas por RLS (products.read; costos con products.cost.read). Ninguna
-- escritura directa: todo cambio pasa por las RPC de catálogo (F3-T02), que
-- validan; el cliente nunca es autoridad sobre precios ni estructura (§44.8).
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists btree_gin with schema extensions;

-- Slug: minúsculas, números y guiones simples.
create or replace function app.slug_valid(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(p_slug) <= 120 $$;
revoke all on function app.slug_valid(text) from public;
grant execute on function app.slug_valid(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Marcas
-- -----------------------------------------------------------------------------
create table public.brands (
  id              uuid primary key default app.uuid_v7(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  slug            text not null check (app.slug_valid(slug)),
  logo_media_id   uuid,
  seo_title       text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 320),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (store_id, id)
);
create unique index brands_slug_uq on public.brands (store_id, slug) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Categorías: árbol de hasta 4 niveles (depth 0..3) con path de slugs.
-- -----------------------------------------------------------------------------
create table public.categories (
  id              uuid primary key default app.uuid_v7(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  parent_id       uuid,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  slug            text not null check (app.slug_valid(slug)),
  path            text not null default '',
  depth           smallint not null default 0 check (depth between 0 and 3),
  position        integer not null default 0,
  is_visible      boolean not null default true,
  description     text check (description is null or char_length(description) <= 2000),
  seo_title       text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 320),
  image_media_id  uuid,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (store_id, id),
  constraint categories_not_own_parent check (parent_id is null or parent_id <> id),
  foreign key (store_id, parent_id) references public.categories (store_id, id) on delete restrict
);
create unique index categories_slug_uq on public.categories (store_id, parent_id, slug) nulls not distinct
  where deleted_at is null;
create unique index categories_path_uq on public.categories (store_id, path) where deleted_at is null;
create index categories_parent_idx on public.categories (store_id, parent_id);

-- path y depth derivados del padre; impide ciclos (un nodo no puede colgar de sí
-- mismo ni de un descendiente) y más de 4 niveles.
create or replace function app.categories_derive_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_path  text;
  v_parent_depth smallint;
begin
  if new.parent_id is null then
    new.path := new.slug;
    new.depth := 0;
  else
    select c.path, c.depth into v_parent_path, v_parent_depth
      from public.categories c where c.store_id = new.store_id and c.id = new.parent_id;
    if tg_op = 'UPDATE' and (v_parent_path = old.path or v_parent_path like old.path || '/%') then
      raise exception using errcode = '23514', message = 'category_cycle';
    end if;
    new.path := v_parent_path || '/' || new.slug;
    new.depth := v_parent_depth + 1;
  end if;
  if new.depth > 3 then
    raise exception using errcode = '23514', message = 'category_too_deep';
  end if;
  return new;
end
$$;
revoke all on function app.categories_derive_path() from public;

-- Al cambiar el path, los hijos lo recalculan (en cascada, nivel por nivel).
create or replace function app.categories_cascade_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.path is distinct from old.path then
    update public.categories c set slug = c.slug where c.store_id = new.store_id and c.parent_id = new.id;
  end if;
  return null;
end
$$;
revoke all on function app.categories_cascade_path() from public;

create trigger categories_derive_path before insert or update of parent_id, slug on public.categories
  for each row execute function app.categories_derive_path();
create trigger categories_cascade_path after update on public.categories
  for each row execute function app.categories_cascade_path();

-- -----------------------------------------------------------------------------
-- Productos
-- -----------------------------------------------------------------------------
create table public.products (
  id               uuid primary key default app.uuid_v7(),
  store_id         uuid not null references public.stores (id) on delete cascade,
  brand_id         uuid,
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  slug             text not null check (app.slug_valid(slug)),
  description_html text check (description_html is null or octet_length(description_html) <= 102400),
  product_type     text not null default 'physical' check (product_type in ('physical', 'digital', 'service')),
  status           text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  published_at     timestamptz,
  tags             text[] not null default '{}' check (cardinality(tags) <= 50),
  specs            jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  seo_title        text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description  text check (seo_description is null or char_length(seo_description) <= 320),
  min_price        bigint check (min_price is null or min_price >= 0),
  max_price        bigint check (max_price is null or max_price >= 0),
  sales_count      integer not null default 0 check (sales_count >= 0),
  search_vector    tsvector,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_id, id),
  constraint products_active_was_published check (status <> 'active' or published_at is not null),
  foreign key (store_id, brand_id) references public.brands (store_id, id) on delete set null (brand_id)
);
create unique index products_slug_uq on public.products (store_id, slug) where deleted_at is null;
create index products_listing_idx on public.products (store_id, status, published_at desc);
create index products_price_idx on public.products (store_id, min_price);
create index products_sales_idx on public.products (store_id, sales_count desc);
create index products_search_idx on public.products using gin (store_id, search_vector);
create index products_title_trgm_idx on public.products using gin (store_id, title extensions.gin_trgm_ops);
create index products_tags_idx on public.products using gin (tags);

-- -----------------------------------------------------------------------------
-- Medios (imágenes; el procesamiento llega en F3-T03). Nunca se sirve un medio
-- que no esté `ready`.
-- -----------------------------------------------------------------------------
create table public.media (
  id               uuid primary key default app.uuid_v7(),
  store_id         uuid not null references public.stores (id) on delete cascade,
  owner_type       text not null check (owner_type in ('product', 'brand', 'category', 'store_branding', 'banner')),
  product_id       uuid,
  kind             text not null default 'image' check (kind in ('image')),
  status           text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  storage_path     text not null unique check (char_length(storage_path) between 1 and 500),
  mime_type        text check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  bytes            bigint check (bytes is null or bytes between 1 and 10485760),
  width            integer check (width is null or width between 1 and 10000),
  height           integer check (height is null or height between 1 and 10000),
  alt_text         text check (alt_text is null or char_length(alt_text) <= 250),
  position         integer not null default 0,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 200),
  created_by       uuid references auth.users (id) on delete set null,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_id, id),
  constraint media_product_owner check ((owner_type = 'product') = (product_id is not null)),
  constraint media_product_position_uq unique (product_id, position) deferrable initially deferred,
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade
);
create index media_store_idx on public.media (store_id, owner_type, status);

alter table public.brands
  add constraint brands_logo_fk foreign key (store_id, logo_media_id)
  references public.media (store_id, id) on delete set null (logo_media_id);
alter table public.categories
  add constraint categories_image_fk foreign key (store_id, image_media_id)
  references public.media (store_id, id) on delete set null (image_media_id);

-- -----------------------------------------------------------------------------
-- Opciones (≤ 3 por producto) y sus valores
-- -----------------------------------------------------------------------------
create table public.product_options (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null,
  name       text not null check (char_length(btrim(name)) between 1 and 60 and name !~ '[=|]'),
  position   smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade
);
create unique index product_options_name_uq on public.product_options (product_id, lower(name));

create table public.product_option_values (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  option_id  uuid not null,
  value      text not null check (char_length(btrim(value)) between 1 and 60 and value !~ '[=|]'),
  position   smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, id, option_id),
  foreign key (store_id, option_id) references public.product_options (store_id, id) on delete cascade
);
create unique index product_option_values_uq on public.product_option_values (option_id, lower(value));

create or replace function app.product_options_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.product_options o where o.product_id = new.product_id) >= 3 then
    raise exception using errcode = 'P0001', message = 'limit_reached',
      detail = json_build_object('key', 'max_options_per_product', 'limit', 3)::text;
  end if;
  return new;
end
$$;
revoke all on function app.product_options_limit() from public;
create trigger product_options_limit before insert on public.product_options
  for each row execute function app.product_options_limit();

-- -----------------------------------------------------------------------------
-- Variantes: la unidad vendible (un producto simple = una variante, firma '').
-- -----------------------------------------------------------------------------
create table public.product_variants (
  id                uuid primary key default app.uuid_v7(),
  store_id          uuid not null references public.stores (id) on delete cascade,
  product_id        uuid not null,
  sku               text check (sku is null or (char_length(sku) between 1 and 64 and sku = upper(btrim(sku)))),
  barcode           text check (barcode is null or barcode ~ '^[0-9A-Za-z-]{4,32}$'),
  price             bigint not null check (price >= 0),
  compare_at_price  bigint check (compare_at_price is null or compare_at_price > price),
  weight_g          integer check (weight_g is null or weight_g >= 0),
  length_mm         integer check (length_mm is null or length_mm >= 0),
  width_mm          integer check (width_mm is null or width_mm >= 0),
  height_mm         integer check (height_mm is null or height_mm >= 0),
  image_id          uuid,
  status            text not null default 'active' check (status in ('active', 'inactive')),
  track_inventory   boolean not null default true,
  inventory_policy  text not null default 'deny' check (inventory_policy in ('deny', 'continue')),
  requires_shipping boolean not null default true,
  position          integer not null default 0,
  option_signature  text not null default '',
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (store_id, id),
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade,
  foreign key (store_id, image_id) references public.media (store_id, id) on delete set null (image_id)
);
create unique index product_variants_sku_uq on public.product_variants (store_id, sku)
  where sku is not null and deleted_at is null;
create unique index product_variants_barcode_uq on public.product_variants (store_id, barcode)
  where barcode is not null and deleted_at is null;
create unique index product_variants_signature_uq on public.product_variants (product_id, option_signature)
  where deleted_at is null;
create index product_variants_product_idx on public.product_variants (store_id, product_id);

-- SKU normalizado (trim + mayúsculas) antes de los CHECK.
create or replace function app.product_variants_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sku := nullif(upper(btrim(coalesce(new.sku, ''))), '');
  return new;
end
$$;
revoke all on function app.product_variants_normalize() from public;
create trigger product_variants_normalize before insert or update of sku on public.product_variants
  for each row execute function app.product_variants_normalize();

-- Un valor por opción del producto, declarativo: UNIQUE (variant_id, option_id) y
-- la FK compuesta garantiza que el valor pertenece a esa opción.
create table public.variant_option_values (
  variant_id      uuid not null,
  option_value_id uuid not null,
  option_id       uuid not null,
  store_id        uuid not null references public.stores (id) on delete cascade,
  primary key (variant_id, option_value_id),
  unique (variant_id, option_id),
  foreign key (store_id, variant_id) references public.product_variants (store_id, id) on delete cascade,
  foreign key (store_id, option_value_id, option_id)
    references public.product_option_values (store_id, id, option_id) on delete cascade
);

-- Firma esperada de una variante: "Color=Negro|Talla=M" por posición de opción.
create or replace function app.variant_expected_signature(p_variant_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(string_agg(o.name || '=' || v.value, '|' order by o.position, o.name), '')
    from public.variant_option_values vov
    join public.product_option_values v on v.id = vov.option_value_id
    join public.product_options o on o.id = vov.option_id
   where vov.variant_id = p_variant_id
$$;
revoke all on function app.variant_expected_signature(uuid) from public;

-- Al final de la transacción: cada variante viva tiene exactamente un valor por
-- opción de SU producto y su firma coincide. Diferido: la RPC arma producto,
-- opciones y variantes en una sola transacción.
create or replace function app.check_variant(p_variant_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_variant public.product_variants;
begin
  select * into v_variant from public.product_variants pv where pv.id = p_variant_id;
  if v_variant.id is null or v_variant.deleted_at is not null then
    return;
  end if;
  if exists (
    select 1 from public.variant_option_values vov
      join public.product_options o on o.id = vov.option_id
     where vov.variant_id = p_variant_id and o.product_id <> v_variant.product_id
  ) or (select count(*) from public.variant_option_values vov where vov.variant_id = p_variant_id)
       <> (select count(*) from public.product_options o where o.product_id = v_variant.product_id) then
    raise exception using errcode = '23514', message = 'variant_options_incomplete',
      detail = p_variant_id::text;
  end if;
  if v_variant.option_signature <> app.variant_expected_signature(p_variant_id) then
    raise exception using errcode = '23514', message = 'variant_signature_mismatch',
      detail = p_variant_id::text;
  end if;
end
$$;
revoke all on function app.check_variant(uuid) from public;

create or replace function app.check_variant_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  case tg_table_name
    when 'product_variants' then
      perform app.check_variant(new.id);
    when 'variant_option_values' then
      perform app.check_variant(case when tg_op = 'DELETE' then old.variant_id else new.variant_id end);
    when 'product_options' then
      for v_id in select pv.id from public.product_variants pv
                   where pv.product_id = coalesce(new.product_id, old.product_id) loop
        perform app.check_variant(v_id);
      end loop;
    when 'product_option_values' then
      for v_id in select vov.variant_id from public.variant_option_values vov
                   where vov.option_value_id = new.id loop
        perform app.check_variant(v_id);
      end loop;
  end case;
  return null;
end
$$;
revoke all on function app.check_variant_trigger() from public;

create constraint trigger product_variants_validate_options after insert or update on public.product_variants
  deferrable initially deferred for each row execute function app.check_variant_trigger();
create constraint trigger variant_option_values_validate after insert or update or delete on public.variant_option_values
  deferrable initially deferred for each row execute function app.check_variant_trigger();
create constraint trigger product_options_validate_variants after insert or update or delete on public.product_options
  deferrable initially deferred for each row execute function app.check_variant_trigger();
create constraint trigger product_option_values_validate_variants after update on public.product_option_values
  deferrable initially deferred for each row execute function app.check_variant_trigger();

-- -----------------------------------------------------------------------------
-- Costos (sensibles: products.cost.read) y categorías del producto
-- -----------------------------------------------------------------------------
create table public.variant_costs (
  variant_id uuid primary key,
  store_id   uuid not null references public.stores (id) on delete cascade,
  cost       bigint not null check (cost >= 0),
  updated_at timestamptz not null default now(),
  foreign key (store_id, variant_id) references public.product_variants (store_id, id) on delete cascade
);

create table public.product_categories (
  product_id  uuid not null,
  category_id uuid not null,
  store_id    uuid not null references public.stores (id) on delete cascade,
  is_primary  boolean not null default false,
  position    integer not null default 0,
  primary key (product_id, category_id),
  foreign key (store_id, product_id) references public.products (store_id, id) on delete cascade,
  foreign key (store_id, category_id) references public.categories (store_id, id) on delete cascade
);
create unique index product_categories_primary_uq on public.product_categories (product_id) where is_primary;
create index product_categories_category_idx on public.product_categories (store_id, category_id);

-- -----------------------------------------------------------------------------
-- Derivados del producto: rango de precios y vector de búsqueda (§23).
-- A título · B marca, tags y SKU · C categorías · D descripción sin HTML.
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
    || setweight(to_tsvector('spanish', extensions.unaccent(coalesce(
         (select string_agg(c.name, ' ') from public.product_categories pc
            join public.categories c on c.id = pc.category_id
           where pc.product_id = p_product.id and c.deleted_at is null), ''))), 'C')
    || setweight(to_tsvector('spanish', extensions.unaccent(left(
         regexp_replace(coalesce(p_product.description_html, ''), '<[^>]*>', ' ', 'g'), 20000))), 'D')
$$;
revoke all on function app.product_search_vector(public.products) from public;

create or replace function app.products_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select min(pv.price), max(pv.price) into new.min_price, new.max_price
    from public.product_variants pv
   where pv.product_id = new.id and pv.status = 'active' and pv.deleted_at is null;
  new.search_vector := app.product_search_vector(new);
  return new;
end
$$;
revoke all on function app.products_derive() from public;
create trigger products_derive before insert or update on public.products
  for each row execute function app.products_derive();

-- Cambios en hijos que afectan derivados: se "toca" el producto (recalcula).
create or replace function app.touch_product()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.products p set updated_at = now()
   where p.id = case when tg_op = 'DELETE' then old.product_id else new.product_id end;
  return null;
end
$$;
revoke all on function app.touch_product() from public;
create trigger product_variants_touch after insert or update or delete on public.product_variants
  for each row execute function app.touch_product();
create trigger product_categories_touch after insert or update or delete on public.product_categories
  for each row execute function app.touch_product();

-- Renombrar una marca o categoría recalcula la búsqueda de sus productos.
create or replace function app.touch_products_of()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    if tg_table_name = 'brands' then
      update public.products p set updated_at = now() where p.store_id = new.store_id and p.brand_id = new.id;
    else
      update public.products p set updated_at = now()
        from public.product_categories pc
       where pc.product_id = p.id and pc.category_id = new.id;
    end if;
  end if;
  return null;
end
$$;
revoke all on function app.touch_products_of() from public;
create trigger brands_touch_products after update of name on public.brands
  for each row execute function app.touch_products_of();
create trigger categories_touch_products after update of name on public.categories
  for each row execute function app.touch_products_of();

-- -----------------------------------------------------------------------------
-- Límites del plan: max_products (organización) y max_variants_per_product
-- (por producto; 100 si el plan no lo define, GATE0 §14.2).
-- -----------------------------------------------------------------------------
create or replace function app.current_usage(p_org uuid, p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case p_key
    when 'max_stores' then
      return (select count(*) from public.stores s
               where s.organization_id = p_org and s.status <> 'closed');
    when 'max_staff' then
      return (select count(*) from public.organization_members m
               where m.organization_id = p_org and m.status = 'active');
    when 'max_products' then
      return (select count(*) from public.products p
                join public.stores s on s.id = p.store_id
               where s.organization_id = p_org and p.deleted_at is null);
    else
      raise exception using errcode = '22023', message = 'unsupported_limit', detail = p_key;
  end case;
end
$$;

create or replace function app.enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    perform app.assert_within_limit((select s.organization_id from public.stores s where s.id = new.store_id),
                                    'max_products');
  end if;
  return new;
end
$$;
revoke all on function app.enforce_product_limit() from public;
create trigger products_enforce_limit before insert or update of deleted_at on public.products
  for each row execute function app.enforce_product_limit();

create or replace function app.enforce_variant_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid := (select s.organization_id from public.stores s where s.id = new.store_id);
  v_limit integer;
  v_used  integer;
begin
  if tg_op = 'UPDATE' and not (old.deleted_at is not null and new.deleted_at is null) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.product_id::text || ':variants', 0));
  v_limit := coalesce(
    (select o.value_int from public.organization_entitlement_overrides o
      where o.organization_id = v_org and o.key = 'max_variants_per_product'
        and (o.expires_at is null or o.expires_at > now())),
    (select e.value_int from public.subscriptions s
       join public.plan_entitlements e on e.plan_id = s.plan_id and e.key = 'max_variants_per_product'
      where s.organization_id = v_org and s.status <> 'cancelled'),
    100);
  select count(*) into v_used from public.product_variants pv
   where pv.product_id = new.product_id and pv.deleted_at is null and pv.id <> new.id;
  if v_used + 1 > v_limit then
    raise exception using errcode = 'P0001', message = 'limit_reached',
      detail = json_build_object('key', 'max_variants_per_product', 'limit', v_limit, 'used', v_used)::text;
  end if;
  return new;
end
$$;
revoke all on function app.enforce_variant_limit() from public;
create trigger product_variants_enforce_limit before insert or update of deleted_at on public.product_variants
  for each row execute function app.enforce_variant_limit();

-- -----------------------------------------------------------------------------
-- Comunes: updated_at, inmutabilidad del tenant y de padres
-- -----------------------------------------------------------------------------
create trigger brands_set_updated_at before update on public.brands
  for each row execute function app.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
  for each row execute function app.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function app.set_updated_at();
create trigger media_set_updated_at before update on public.media
  for each row execute function app.set_updated_at();
create trigger product_variants_set_updated_at before update on public.product_variants
  for each row execute function app.set_updated_at();
create trigger variant_costs_set_updated_at before update on public.variant_costs
  for each row execute function app.set_updated_at();

create trigger brands_prevent_tenant_change before update on public.brands
  for each row execute function app.prevent_tenant_change();
create trigger categories_prevent_tenant_change before update on public.categories
  for each row execute function app.prevent_tenant_change();
create trigger products_prevent_tenant_change before update on public.products
  for each row execute function app.prevent_tenant_change();
create trigger media_prevent_tenant_change before update on public.media
  for each row execute function app.prevent_tenant_change();
create trigger product_options_prevent_tenant_change before update on public.product_options
  for each row execute function app.prevent_tenant_change();
create trigger product_option_values_prevent_tenant_change before update on public.product_option_values
  for each row execute function app.prevent_tenant_change();
create trigger product_variants_prevent_tenant_change before update on public.product_variants
  for each row execute function app.prevent_tenant_change();
create trigger variant_option_values_prevent_tenant_change before update on public.variant_option_values
  for each row execute function app.prevent_tenant_change();
create trigger variant_costs_prevent_tenant_change before update on public.variant_costs
  for each row execute function app.prevent_tenant_change();
create trigger product_categories_prevent_tenant_change before update on public.product_categories
  for each row execute function app.prevent_tenant_change();

create trigger media_immutable before update on public.media
  for each row execute function app.prevent_column_change('storage_path', 'owner_type', 'product_id');
create trigger product_options_immutable before update on public.product_options
  for each row execute function app.prevent_column_change('product_id');
create trigger product_option_values_immutable before update on public.product_option_values
  for each row execute function app.prevent_column_change('option_id');
create trigger product_variants_immutable before update on public.product_variants
  for each row execute function app.prevent_column_change('product_id');
create trigger variant_option_values_immutable before update on public.variant_option_values
  for each row execute function app.prevent_column_change('variant_id', 'option_value_id', 'option_id');

-- -----------------------------------------------------------------------------
-- RLS: lectura con products.read (costos con products.cost.read); sin escrituras.
-- -----------------------------------------------------------------------------
alter table public.brands enable row level security;
alter table public.brands force row level security;
alter table public.categories enable row level security;
alter table public.categories force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.media enable row level security;
alter table public.media force row level security;
alter table public.product_options enable row level security;
alter table public.product_options force row level security;
alter table public.product_option_values enable row level security;
alter table public.product_option_values force row level security;
alter table public.product_variants enable row level security;
alter table public.product_variants force row level security;
alter table public.variant_option_values enable row level security;
alter table public.variant_option_values force row level security;
alter table public.variant_costs enable row level security;
alter table public.variant_costs force row level security;
alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;

revoke all on table public.brands, public.categories, public.products, public.media, public.product_options,
  public.product_option_values, public.product_variants, public.variant_option_values, public.variant_costs,
  public.product_categories from public, anon, authenticated, service_role;

grant select on table public.brands, public.categories, public.products, public.media, public.product_options,
  public.product_option_values, public.product_variants, public.variant_option_values, public.variant_costs,
  public.product_categories to authenticated;

create policy brands_select on public.brands for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy categories_select on public.categories for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy products_select on public.products for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy media_select on public.media for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy product_options_select on public.product_options for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy product_option_values_select on public.product_option_values for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy product_variants_select on public.product_variants for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy variant_option_values_select on public.variant_option_values for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
create policy variant_costs_select on public.variant_costs for select to authenticated
  using (app.has_store_permission(store_id, 'products.cost.read'));
create policy product_categories_select on public.product_categories for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));
