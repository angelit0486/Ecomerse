-- =============================================================================
-- Opiniones verificadas de compradores (ADR-029, aprobado por delegación).
-- Contrato: GATE0 §44.1-2 (tabla de tienda), §25 (nunca AggregateRating sin
-- reseñas reales).
--
-- * Solo opina quien compró: con el enlace de su pedido (token del invitado,
--   solo su hash llega aquí), un pedido pagado y entregado, y un producto que
--   esté en ese pedido. Una opinión por producto y pedido.
-- * Toda opinión nace `pending` y la tienda la publica o la rechaza: en
--   suplementos una opinión puede afirmar curas o efectos que no se pueden
--   publicar. Nada se borra.
-- * El nombre visible lo calcula la base («Ana G.»), nunca el navegador; ni el
--   email ni el pedido salen a la tienda pública.
-- =============================================================================

create table public.product_reviews (
  id            uuid primary key default app.uuid_v7(),
  store_id      uuid not null references public.stores (id) on delete restrict,
  product_id    uuid not null,
  order_id      uuid not null,
  rating        smallint not null check (rating between 1 and 5),
  title         text check (title is null or char_length(btrim(title)) between 1 and 120),
  body          text not null check (char_length(btrim(body)) between 10 and 2000),
  author_name   text not null check (char_length(btrim(author_name)) between 1 and 60),
  status        text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  moderated_at  timestamptz,
  moderated_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, order_id, product_id),
  foreign key (store_id, product_id) references public.products (store_id, id) on delete restrict,
  foreign key (store_id, order_id) references public.orders (store_id, id) on delete restrict
);
create index product_reviews_product_idx on public.product_reviews (store_id, product_id, created_at desc)
  where status = 'published';
create index product_reviews_status_idx on public.product_reviews (store_id, status, created_at desc);

create trigger product_reviews_set_updated_at before update on public.product_reviews
  for each row execute function app.set_updated_at();
create trigger product_reviews_prevent_tenant_change before update on public.product_reviews
  for each row execute function app.prevent_tenant_change();
create trigger product_reviews_immutable before update on public.product_reviews
  for each row execute function app.prevent_column_change('product_id', 'order_id', 'rating', 'title', 'body',
                                                          'author_name', 'created_at');
create trigger product_reviews_no_delete before delete on public.product_reviews
  for each row execute function app.forbid_mutation();

alter table public.product_reviews enable row level security;
alter table public.product_reviews force row level security;
revoke all on table public.product_reviews from public, anon, authenticated, service_role;
grant select on public.product_reviews to authenticated;
create policy product_reviews_select on public.product_reviews for select to authenticated
  using (app.has_store_permission(store_id, 'products.read'));

-- -----------------------------------------------------------------------------
-- Nombre visible: primer nombre + inicial del segundo («Ana G.»).
-- -----------------------------------------------------------------------------
create or replace function app.review_author_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when coalesce(btrim(p_name), '') = '' then 'Cliente'
           else left(split_part(regexp_replace(btrim(p_name), '\s+', ' ', 'g'), ' ', 1), 40)
                || coalesce(' ' || nullif(upper(left(split_part(regexp_replace(btrim(p_name), '\s+', ' ', 'g'),
                                                                ' ', 2), 1)), '') || '.', '')
         end
$$;

-- Pedido que puede opinar: pagado (o reembolsado en parte) y entregado.
create or replace function app.order_reviewable(p_store_id uuid, p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
     where o.store_id = p_store_id and o.id = p_order_id
       and o.payment_status in ('paid', 'partially_refunded')
       and (o.status = 'completed'
            or exists (select 1 from public.shipments s
                        where s.store_id = o.store_id and s.order_id = o.id and s.status = 'delivered')))
$$;

-- -----------------------------------------------------------------------------
-- Tienda pública (storefront_gateway).
-- -----------------------------------------------------------------------------
-- Productos del pedido que el comprador puede calificar (con el token del enlace).
create or replace function storefront.order_reviewables(p_store_id uuid, p_order_id uuid, p_token_hash bytea)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', x.product_id, 'title', x.product_title,
           'reviewed', exists (select 1 from public.product_reviews r
                                where r.store_id = p_store_id and r.order_id = p_order_id
                                  and r.product_id = x.product_id))
           order by x.position), '[]'::jsonb)
    from (select distinct on (i.product_id) i.product_id, i.product_title, i.position
            from public.orders o
            join public.order_items i on i.store_id = o.store_id and i.order_id = o.id
            join public.products p on p.store_id = i.store_id and p.id = i.product_id and p.deleted_at is null
           where o.store_id = p_store_id and o.id = p_order_id
             and p_token_hash is not null and o.guest_access_token_hash = p_token_hash
             and app.order_reviewable(p_store_id, p_order_id)
           order by i.product_id, i.position) x
$$;

create or replace function storefront.submit_review(p_store_id uuid, p_order_id uuid, p_token_hash bytea,
                                                    p_product_id uuid, p_review jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders;
  v_rating integer;
  v_title  text := nullif(btrim(p_review ->> 'title'), '');
  v_body   text := btrim(coalesce(p_review ->> 'body', ''));
  v_id     uuid;
begin
  select * into v_order from public.orders o
   where o.store_id = p_store_id and o.id = p_order_id
     and p_token_hash is not null and o.guest_access_token_hash = p_token_hash;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'order';
  end if;
  if not app.order_reviewable(p_store_id, p_order_id) then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'order_not_delivered';
  end if;
  if not exists (select 1 from public.order_items i
                  join public.products p on p.store_id = i.store_id and p.id = i.product_id and p.deleted_at is null
                 where i.store_id = p_store_id and i.order_id = p_order_id and i.product_id = p_product_id) then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'product';
  end if;
  if not app.rate_limit_take('review:' || p_order_id, 20, 3600) then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;
  begin
    v_rating := (p_review ->> 'rating')::integer;
  exception when others then
    v_rating := null;
  end;
  if v_rating is null or v_rating not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rating';
  end if;
  if v_title is not null and char_length(v_title) > 120 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'title';
  end if;
  if char_length(v_body) not between 10 and 2000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body';
  end if;
  insert into public.product_reviews (store_id, product_id, order_id, rating, title, body, author_name)
  values (p_store_id, p_product_id, p_order_id, v_rating, v_title, v_body,
          app.review_author_name(v_order.customer_name))
  on conflict (store_id, order_id, product_id) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'already_reviewed';
  end if;
  return jsonb_build_object('status', 'pending');
end
$$;

-- Opiniones publicadas de un producto activo de una tienda pública.
create or replace function storefront.product_reviews(p_store_id uuid, p_product_id uuid, p_limit integer default 10)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*)::integer,
    'average', round(avg(r.rating)::numeric, 1),
    'distribution', jsonb_build_object(
      '5', count(*) filter (where r.rating = 5), '4', count(*) filter (where r.rating = 4),
      '3', count(*) filter (where r.rating = 3), '2', count(*) filter (where r.rating = 2),
      '1', count(*) filter (where r.rating = 1)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('rating', x.rating, 'title', x.title, 'body', x.body,
                                                          'author_name', x.author_name,
                                                          'created_at', x.created_at) order by x.created_at desc)
                         from (select * from public.product_reviews y
                                where y.store_id = p_store_id and y.product_id = p_product_id
                                  and y.status = 'published'
                                order by y.created_at desc
                                limit least(greatest(coalesce(p_limit, 10), 1), 50)) x), '[]'::jsonb))
    from public.product_reviews r
    join public.products p on p.store_id = r.store_id and p.id = r.product_id
   where r.store_id = p_store_id and r.product_id = p_product_id and r.status = 'published'
     and p.status = 'active' and p.deleted_at is null
     and app.store_publicly_readable(p_store_id)
$$;

-- -----------------------------------------------------------------------------
-- Panel: moderación (leer con products.read, publicar o rechazar con products.update).
-- -----------------------------------------------------------------------------
create or replace function public.reviews_list(p_store_id uuid, p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  if p_status not in ('pending', 'published', 'rejected') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
                 'pending', count(*) filter (where r.status = 'pending'),
                 'published', count(*) filter (where r.status = 'published'),
                 'rejected', count(*) filter (where r.status = 'rejected'))
                 from public.product_reviews r where r.store_id = p_store_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'rating', r.rating, 'title', r.title, 'body', r.body, 'author_name', r.author_name,
                 'status', r.status, 'created_at', r.created_at, 'moderated_at', r.moderated_at,
                 'product', jsonb_build_object('id', p.id, 'title', p.title, 'slug', p.slug),
                 'order', jsonb_build_object('id', o.id, 'display_number', o.display_number))
                 order by r.created_at desc)
                 from (select * from public.product_reviews x
                        where x.store_id = p_store_id and x.status = p_status
                        order by x.created_at desc limit 200) r
                 join public.products p on p.store_id = r.store_id and p.id = r.product_id
                 join public.orders o on o.store_id = r.store_id and o.id = r.order_id), '[]'::jsonb));
end
$$;

create or replace function public.reviews_moderate(p_store_id uuid, p_review_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.product_reviews;
begin
  perform app.require_store_permission(p_store_id, 'products.update');
  if p_status not in ('published', 'rejected') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'status';
  end if;
  select * into v_review from public.product_reviews r
   where r.store_id = p_store_id and r.id = p_review_id for update;
  if v_review.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'review';
  end if;
  if v_review.status <> p_status then
    update public.product_reviews
       set status = p_status, moderated_at = now(), moderated_by = auth.uid()
     where id = v_review.id;
    perform audit.record('review.' || p_status, 'product_review', v_review.id,
                         (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                         jsonb_build_object('status', v_review.status), jsonb_build_object('status', p_status));
  end if;
  return p_status;
end
$$;

revoke all on function app.review_author_name(text) from public;
revoke all on function app.order_reviewable(uuid, uuid) from public;
revoke all on function storefront.order_reviewables(uuid, uuid, bytea) from public;
revoke all on function storefront.submit_review(uuid, uuid, bytea, uuid, jsonb) from public;
revoke all on function storefront.product_reviews(uuid, uuid, integer) from public;
revoke all on function public.reviews_list(uuid, text) from public;
revoke all on function public.reviews_moderate(uuid, uuid, text) from public;
grant execute on function storefront.order_reviewables(uuid, uuid, bytea) to storefront_gateway;
grant execute on function storefront.submit_review(uuid, uuid, bytea, uuid, jsonb) to storefront_gateway;
grant execute on function storefront.product_reviews(uuid, uuid, integer) to storefront_gateway;
grant execute on function public.reviews_list(uuid, text) to authenticated;
grant execute on function public.reviews_moderate(uuid, uuid, text) to authenticated;
