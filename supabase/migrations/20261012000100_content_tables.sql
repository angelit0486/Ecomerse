-- =============================================================================
-- Fase 5 · Contenido: menús, páginas y plantillas de políticas (F5-T01)
-- Contrato: GATE0 §13 (menus, menu_items, store_pages), §21, §24; matriz de
-- permisos: lectura store.read; menús appearance.manage; páginas content.manage.
--
-- * Toda tienda nace con sus menús `main` y `footer` (vacíos: el storefront usa
--   las categorías mientras tanto) y con cuatro políticas en BORRADOR. Las
--   plantillas no son texto legal: son una guía con marcadores para completar
--   (nunca se inventan condiciones de la tienda).
-- * menu_items.target_id es polimórfico (sin FK, aceptado en §13): la escritura
--   (F5-T06) verifica el destino en la misma tienda y la lectura pública omite
--   los ítems cuyo destino no existe o no está publicado.
-- * Escrituras solo por RPC (F5-T06).
-- =============================================================================

create table public.menus (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  handle     text not null check (handle in ('main', 'footer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, handle)
);

create table public.menu_items (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  menu_id    uuid not null,
  parent_id  uuid,
  label      text not null check (char_length(btrim(label)) between 1 and 60),
  link_type  text not null check (link_type in ('home', 'category', 'brand', 'product', 'page', 'collection',
                                                'search', 'url')),
  target_id  uuid,
  url        text check (url is null or (char_length(url) <= 500
                                         and (url ~ '^https://[^\s]+$' or (url ~ '^/[^\s]*$' and url !~ '^//')))),
  position   integer not null default 0 check (position between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  constraint menu_items_not_own_parent check (parent_id is null or parent_id <> id),
  constraint menu_items_link_coherence check (
    case
      when link_type in ('category', 'brand', 'product', 'page', 'collection') then target_id is not null and url is null
      when link_type = 'url' then url is not null and target_id is null
      else target_id is null and url is null
    end),
  foreign key (store_id, menu_id) references public.menus (store_id, id) on delete cascade,
  foreign key (store_id, parent_id) references public.menu_items (store_id, id) on delete cascade
);
create index menu_items_menu_idx on public.menu_items (store_id, menu_id, parent_id, position);

-- Profundidad ≤ 2: un ítem con padre no puede tener hijos; el padre es del mismo menú.
create or replace function app.menu_items_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.menu_items p
                where p.id = new.parent_id and (p.parent_id is not null or p.menu_id <> new.menu_id)) then
      raise exception using errcode = '23514', message = 'menu_too_deep';
    end if;
    if exists (select 1 from public.menu_items c where c.parent_id = new.id) then
      raise exception using errcode = '23514', message = 'menu_too_deep';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.menu_items_depth() from public;

create table public.store_pages (
  id              uuid primary key default app.uuid_v7(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  type            text not null default 'content'
                  check (type in ('content', 'policy_privacy', 'policy_terms', 'policy_returns', 'policy_shipping')),
  slug            text not null check (app.slug_valid(slug)),
  title           text not null check (char_length(btrim(title)) between 1 and 120),
  body_html       text not null default '' check (octet_length(body_html) <= 102400),
  is_published    boolean not null default false,
  published_at    timestamptz,
  seo_title       text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 320),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (store_id, id),
  constraint store_pages_published_at check (not is_published or published_at is not null),
  constraint store_pages_deleted_unpublished check (deleted_at is null or not is_published)
);
create unique index store_pages_slug_uq on public.store_pages (store_id, slug) where deleted_at is null;
create unique index store_pages_policy_uq on public.store_pages (store_id, type)
  where type <> 'content' and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger menus_set_updated_at before update on public.menus
  for each row execute function app.set_updated_at();
create trigger menu_items_set_updated_at before update on public.menu_items
  for each row execute function app.set_updated_at();
create trigger store_pages_set_updated_at before update on public.store_pages
  for each row execute function app.set_updated_at();
create trigger menus_prevent_tenant_change before update on public.menus
  for each row execute function app.prevent_tenant_change();
create trigger menu_items_prevent_tenant_change before update on public.menu_items
  for each row execute function app.prevent_tenant_change();
create trigger store_pages_prevent_tenant_change before update on public.store_pages
  for each row execute function app.prevent_tenant_change();
create trigger menus_immutable before update on public.menus
  for each row execute function app.prevent_column_change('handle');
create trigger menu_items_immutable before update on public.menu_items
  for each row execute function app.prevent_column_change('menu_id');
create trigger store_pages_immutable before update on public.store_pages
  for each row execute function app.prevent_column_change('type');
create trigger menu_items_depth before insert or update of parent_id on public.menu_items
  for each row execute function app.menu_items_depth();

-- -----------------------------------------------------------------------------
-- Contenido inicial de cada tienda (+ backfill)
-- -----------------------------------------------------------------------------
create or replace function app.policy_template(p_type text)
returns table (slug text, title text, body_html text)
language sql
immutable
set search_path = ''
as $$
  select v.slug, v.title,
         '<p><strong>Plantilla en borrador.</strong> Completa cada sección con las condiciones reales de tu tienda '
         || 'y revísala con tu asesoría legal antes de publicarla. Sustituye todo lo que está entre corchetes.</p>'
         || v.body
    from (values
      ('policy_privacy', 'aviso-de-privacidad', 'Aviso de privacidad',
       '<h2>Responsable de tus datos</h2><p>[Razón social, domicilio y contacto del responsable]</p>'
       || '<h2>Datos que recabamos</h2><p>[Qué datos personales se recaban y para qué finalidades]</p>'
       || '<h2>Con quién los compartimos</h2><p>[Proveedores de pago, envío y otros encargados]</p>'
       || '<h2>Tus derechos</h2><p>[Cómo ejercer los derechos de acceso, rectificación, cancelación y oposición]</p>'
       || '<h2>Cambios a este aviso</h2><p>[Cómo se comunican los cambios]</p>'),
      ('policy_terms', 'terminos-y-condiciones', 'Términos y condiciones',
       '<h2>Quiénes somos</h2><p>[Razón social y datos de contacto]</p>'
       || '<h2>Compras</h2><p>[Cómo se forma el contrato, precios, impuestos y medios de pago]</p>'
       || '<h2>Restricciones</h2><p>[Requisitos de edad, zonas de venta u otras restricciones aplicables]</p>'
       || '<h2>Ley aplicable</h2><p>[Legislación y jurisdicción]</p>'),
      ('policy_returns', 'devoluciones', 'Cambios y devoluciones',
       '<h2>Plazo</h2><p>[Plazo para solicitar un cambio o una devolución]</p>'
       || '<h2>Condiciones</h2><p>[Estado del producto y productos excluidos]</p>'
       || '<h2>Cómo solicitarlo</h2><p>[Pasos y contacto]</p>'
       || '<h2>Reembolsos</h2><p>[Medio y plazo del reembolso]</p>'),
      ('policy_shipping', 'envios', 'Envíos',
       '<h2>Zonas de envío</h2><p>[A dónde envías]</p>'
       || '<h2>Tiempos y costos</h2><p>[Plazos de preparación y entrega, y costos]</p>'
       || '<h2>Seguimiento</h2><p>[Cómo se informa el número de guía]</p>')
    ) as v(type, slug, title, body)
   where v.type = p_type
$$;
revoke all on function app.policy_template(text) from public;

create or replace function app.create_store_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.menus (store_id, handle) values (new.id, 'main'), (new.id, 'footer')
  on conflict do nothing;
  insert into public.store_pages (store_id, type, slug, title, body_html)
  select new.id, t.type, p.slug, p.title, p.body_html
    from unnest(array['policy_privacy', 'policy_terms', 'policy_returns', 'policy_shipping']) t(type)
    cross join lateral app.policy_template(t.type) p
  on conflict do nothing;
  return null;
end
$$;
revoke all on function app.create_store_content() from public;
create trigger stores_create_content after insert on public.stores
  for each row execute function app.create_store_content();

insert into public.menus (store_id, handle)
select s.id, h.handle from public.stores s cross join (values ('main'), ('footer')) h(handle)
on conflict do nothing;
insert into public.store_pages (store_id, type, slug, title, body_html)
select s.id, t.type, p.slug, p.title, p.body_html
  from public.stores s
  cross join unnest(array['policy_privacy', 'policy_terms', 'policy_returns', 'policy_shipping']) t(type)
  cross join lateral app.policy_template(t.type) p
 where not exists (select 1 from public.store_pages sp where sp.store_id = s.id and sp.type = t.type
                     and sp.deleted_at is null);

-- -----------------------------------------------------------------------------
-- RLS: lectura con store.read; ninguna escritura directa.
-- -----------------------------------------------------------------------------
alter table public.menus enable row level security;
alter table public.menus force row level security;
alter table public.menu_items enable row level security;
alter table public.menu_items force row level security;
alter table public.store_pages enable row level security;
alter table public.store_pages force row level security;

revoke all on table public.menus, public.menu_items, public.store_pages
  from public, anon, authenticated, service_role;
grant select on table public.menus, public.menu_items, public.store_pages to authenticated;

create policy menus_select on public.menus for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));
create policy menu_items_select on public.menu_items for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));
create policy store_pages_select on public.store_pages for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));
