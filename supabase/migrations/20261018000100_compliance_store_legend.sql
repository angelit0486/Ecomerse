-- =============================================================================
-- Fase A (lanzamiento) · A-T01 — Cumplimiento real configurable (ADR-021,
-- D-A-01). Solo esquema y funciones: no cambia datos de ninguna tienda. Las
-- reglas propuestas para México van en la migración siguiente (0200).
--
-- 1. Ficha: campo nuevo «contenido neto» (net_content), también en el CSV.
-- 2. Regla nueva `store_legend`: la categoría exige una leyenda sanitaria que
--    redacta y aprueba la TIENDA con su asesor regulatorio (no la plataforma),
--    mostrada donde digan sus `placements`. El `body` de la regla, si lo hay, es
--    solo un borrador sugerido: nunca se muestra al comprador.
-- 3. Tabla store_compliance_legends: borrador editable y texto aprobado aparte.
--    Editar el borrador no toca lo publicado; aprobar exige el nombre de quien
--    revisó y que el texto ya no diga «PENDIENTE DE REVISIÓN». Sin leyenda
--    aprobada, ningún producto de la categoría se publica.
-- 4. compliance_store_report: qué productos no se pueden publicar y por qué.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contenido neto en la ficha (espejo en src/server/catalog/regulatory.ts)
-- -----------------------------------------------------------------------------
create or replace function app.regulatory_fields(p_category text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_category
    when 'dietary_supplement' then array['form', 'net_content', 'serving_size', 'servings_per_container',
                                         'ingredients', 'nutrition', 'usage', 'warnings', 'storage',
                                         'allergens', 'sanitary_notice']
  end
$$;
revoke all on function app.regulatory_fields(text) from public;

-- Igual que en R-T05 con net_content (hasta 100 caracteres: «60 cápsulas», «907 g»).
create or replace function app.regulatory_normalize(p_category text, p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_limits constant jsonb := '{"form": 100, "net_content": 100, "serving_size": 100, "ingredients": 5000, "usage": 2000,
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
               or v_txt ~ '[\x01-\x1F\x7F|;]' then
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

-- -----------------------------------------------------------------------------
-- 2. Regla `store_legend`
-- -----------------------------------------------------------------------------
alter table public.compliance_rules drop constraint compliance_rules_kind_check;
alter table public.compliance_rules add constraint compliance_rules_kind_check
  check (kind in ('required_field', 'required_legend', 'forbidden_term', 'store_legend'));
alter table public.compliance_rules drop constraint compliance_rules_shape;
alter table public.compliance_rules add constraint compliance_rules_shape check (
  case kind
    when 'required_field' then field_key is not null and body is null and cardinality(placements) = 0
    when 'required_legend' then field_key is null and body is not null and cardinality(placements) >= 1
    when 'store_legend' then field_key is null and cardinality(placements) >= 1
    else field_key is null and body is not null and char_length(btrim(body)) between 2 and 60
         and cardinality(placements) = 0
  end);

-- -----------------------------------------------------------------------------
-- 3. Leyenda sanitaria de la tienda, por categoría
-- -----------------------------------------------------------------------------
create table public.store_compliance_legends (
  id            uuid primary key default app.uuid_v7(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  category_key  text not null references public.regulated_categories (key) on delete restrict,
  draft_body    text not null check (char_length(btrim(draft_body)) between 1 and 2000
                                     and draft_body !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  approved_body text check (approved_body is null or (char_length(btrim(approved_body)) between 1 and 2000
                                                      and approved_body !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]')),
  reviewed_by   text check (reviewed_by is null or char_length(btrim(reviewed_by)) between 2 and 120),
  reviewed_at   timestamptz,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, category_key),
  constraint store_compliance_legends_review check (
    (approved_body is null) = (reviewed_by is null) and (reviewed_by is null) = (reviewed_at is null))
);
create trigger store_compliance_legends_set_updated_at before update on public.store_compliance_legends
  for each row execute function app.set_updated_at();
create trigger store_compliance_legends_prevent_tenant_change before update on public.store_compliance_legends
  for each row execute function app.prevent_tenant_change();

alter table public.store_compliance_legends enable row level security;
alter table public.store_compliance_legends force row level security;
revoke all on table public.store_compliance_legends from public, anon, authenticated, service_role;
grant select on table public.store_compliance_legends to authenticated;
create policy store_compliance_legends_select on public.store_compliance_legends for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));

-- Marca del borrador sugerido: un texto que aún la lleve no se puede aprobar.
create or replace function app.compliance_pending_marker(p_text text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.compliance_text(p_text) like '%pendiente de revision%'
$$;
revoke all on function app.compliance_pending_marker(text) from public;

-- Guarda el borrador y, si p_approve, lo aprueba en la misma operación (se
-- aprueba exactamente el texto enviado). Exige store.update.
create or replace function public.compliance_save_store_legend(p_store_id uuid, p_category_key text, p_body text,
                                                               p_approve boolean, p_reviewed_by text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := app.require_store_permission(p_store_id, 'store.update');
  v_body     text := btrim(coalesce(p_body, ''));
  v_reviewer text := nullif(btrim(coalesce(p_reviewed_by, '')), '');
  v_before   public.store_compliance_legends;
begin
  perform 1 from public.stores s where s.id = p_store_id for update;
  if not exists (select 1 from public.store_regulated_categories d
                  where d.store_id = p_store_id and d.category_key = p_category_key) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'category';
  end if;
  if char_length(v_body) not between 1 and 2000 or v_body ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body';
  end if;
  if p_approve is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'approve';
  end if;
  if p_approve then
    if v_reviewer is null or char_length(v_reviewer) not between 2 and 120 then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'reviewed_by';
    end if;
    if app.compliance_pending_marker(v_body) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'pending_marker';
    end if;
  end if;

  select * into v_before from public.store_compliance_legends l
   where l.store_id = p_store_id and l.category_key = p_category_key;
  insert into public.store_compliance_legends (store_id, category_key, draft_body, approved_body, reviewed_by,
                                               reviewed_at, updated_by)
  values (p_store_id, p_category_key, v_body,
          case when p_approve then v_body end, case when p_approve then v_reviewer end,
          case when p_approve then now() end, v_uid)
  on conflict (store_id, category_key) do update
    set draft_body = excluded.draft_body,
        approved_body = case when p_approve then excluded.approved_body
                             else public.store_compliance_legends.approved_body end,
        reviewed_by = case when p_approve then excluded.reviewed_by
                           else public.store_compliance_legends.reviewed_by end,
        reviewed_at = case when p_approve then excluded.reviewed_at
                           else public.store_compliance_legends.reviewed_at end,
        updated_by = excluded.updated_by;

  perform audit.record(case when p_approve then 'store.compliance_legend_approved'
                            else 'store.compliance_legend_saved' end,
                       'store', p_store_id, (select s.organization_id from public.stores s where s.id = p_store_id),
                       p_store_id,
                       case when v_before.id is not null then
                         jsonb_build_object('category', p_category_key, 'approved', v_before.approved_body is not null,
                                            'reviewed_by', v_before.reviewed_by) end,
                       jsonb_build_object('category', p_category_key,
                                          'approved', p_approve or v_before.approved_body is not null,
                                          'reviewed_by', case when p_approve then v_reviewer
                                                              else v_before.reviewed_by end));
end
$$;
revoke all on function public.compliance_save_store_legend(uuid, text, text, boolean, text) from public;
grant execute on function public.compliance_save_store_legend(uuid, text, text, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Leyendas en la tienda pública: las de la plataforma y la aprobada de la
--    tienda (si una regla `store_legend` vigente la pide en ese lugar).
-- -----------------------------------------------------------------------------
create or replace function app.compliance_legends(p_store_id uuid, p_category text, p_placement text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'text', x.text) order by x.position, x.key),
                  '[]'::jsonb)
    from (
      select r.key, r.body as text, r.position
        from public.stores s
        join public.compliance_profiles cp
          on cp.country = s.country::text and cp.category_key = p_category and cp.status = 'active'
        join public.compliance_rules r
          on r.profile_id = cp.id and r.status = 'active' and r.kind = 'required_legend'
       where s.id = p_store_id and p_placement = any (r.placements)
      union all
      select * from (
        select r.key, l.approved_body, r.position
          from public.stores s
          join public.compliance_profiles cp
            on cp.country = s.country::text and cp.category_key = p_category and cp.status = 'active'
          join public.compliance_rules r
            on r.profile_id = cp.id and r.status = 'active' and r.kind = 'store_legend'
          join public.store_compliance_legends l
            on l.store_id = s.id and l.category_key = p_category and l.approved_body is not null
         where s.id = p_store_id and p_placement = any (r.placements)
         order by r.position, r.key
         limit 1) t  -- un solo texto aunque varias reglas lo pidan
    ) x
$$;
revoke all on function app.compliance_legends(uuid, text, text) from public;

-- -----------------------------------------------------------------------------
-- 5. Validador: igual que en el Gate R más la leyenda de la tienda.
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

  if exists (select 1 from public.compliance_rules r
              where r.profile_id = v_profile.id and r.status = 'active' and r.kind = 'store_legend')
     and not exists (select 1 from public.store_compliance_legends l
                      where l.store_id = v_product.store_id and l.category_key = v_info.category_key
                        and l.approved_body is not null) then
    return query select 'compliance_store_legend_pending'::text, 'error'::text;
  end if;

  v_corpus := app.compliance_text(concat_ws(' ',
    v_product.title,
    app.compliance_html_text(v_product.description_html),
    v_product.seo_title,
    v_product.seo_description,
    array_to_string(v_product.tags, ' '),
    (select b.name from public.brands b where b.store_id = v_product.store_id and b.id = v_product.brand_id),
    (select string_agg(o.name || ' ' || coalesce((select string_agg(ov.value, ' ') from public.product_option_values ov
                                                    where ov.store_id = o.store_id and ov.option_id = o.id), ''), ' ')
       from public.product_options o where o.store_id = v_product.store_id and o.product_id = p_product_id),
    (select string_agg(m.alt_text, ' ') from public.media m
      where m.store_id = v_product.store_id and m.product_id = p_product_id and m.deleted_at is null),
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
-- 6. Estado para Ajustes → Cumplimiento: igual que en R-T01 más la leyenda de
--    la tienda (si las reglas la piden, el borrador sugerido y lo aprobado).
-- -----------------------------------------------------------------------------
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
                                             'reviewed_by', cp.reviewed_by, 'reviewed_at', cp.reviewed_at,
                                             'review_notes', cp.review_notes),
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
               'store_legend', (
                 select jsonb_build_object(
                          'label', r.label,
                          'placements', (select coalesce(jsonb_agg(distinct p), '[]'::jsonb)
                                           from public.compliance_rules r2, unnest(r2.placements) p
                                          where r2.profile_id = cp.id and r2.status = 'active'
                                            and r2.kind = 'store_legend'),
                          'suggested', r.body,
                          'draft', l.draft_body,
                          'approved', l.approved_body,
                          'reviewed_by', l.reviewed_by,
                          'reviewed_at', l.reviewed_at,
                          'updated_at', l.updated_at)
                   from public.compliance_rules r
                   left join public.store_compliance_legends l
                     on l.store_id = p_store_id and l.category_key = rc.key
                  where r.profile_id = cp.id and r.status = 'active' and r.kind = 'store_legend'
                  order by r.position, r.key
                  limit 1),
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

-- -----------------------------------------------------------------------------
-- 7. Validador de la tienda: productos (no eliminados) con algún error de
--    publicación, con sus códigos. Los primeros 500 por título; `total` cuenta
--    todos. Exige products.read.
-- -----------------------------------------------------------------------------
create or replace function public.compliance_store_report(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform app.require_store_permission(p_store_id, 'products.read');
  with checked as (
    select p.id, p.title, p.status, p.updated_at,
           (select coalesce(array_agg(v.code order by v.code), '{}')
              from app.validate_product_for_publish(p.id) v where v.level = 'error') as codes
      from public.products p
     where p.store_id = p_store_id and p.deleted_at is null and p.status <> 'archived'
  ), blocked as (
    select * from checked where cardinality(codes) > 0
  )
  select jsonb_build_object(
           'total', (select count(*) from blocked),
           'checked', (select count(*) from checked),
           'products', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'status', b.status,
                                                                    'codes', to_jsonb(b.codes))
                                                  order by b.title, b.id)
                                   from (select * from blocked order by title, id limit 500) b), '[]'::jsonb))
    into v_rows;
  return v_rows;
end
$$;
revoke all on function public.compliance_store_report(uuid) from public;
grant execute on function public.compliance_store_report(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Consola de la plataforma: guardar reglas `store_legend` (borrador sugerido
--    opcional y al menos un lugar). Igual que en R-T01 salvo eso.
-- -----------------------------------------------------------------------------
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
  if v_kind is null or v_kind not in ('required_field', 'required_legend', 'forbidden_term', 'store_legend') then
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
    if (v_body is null and v_kind <> 'store_legend')
       or char_length(v_body) > (case v_kind when 'forbidden_term' then 60 else 2000 end)
       or (v_kind = 'forbidden_term' and char_length(v_body) < 2) then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'body';
    end if;
  end if;
  if v_kind in ('required_legend', 'store_legend') then
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

-- -----------------------------------------------------------------------------
-- 9. Importación CSV: columna regulatory_net_content. Igual que en R-T05 salvo
--    la lista de columnas conocidas.
-- -----------------------------------------------------------------------------
create or replace function public.imports_create(p_store_id uuid, p_mode text, p_file_name text,
                                                 p_columns text[], p_ignored text[], p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid;
  v_job       uuid;
  v_r         record;
  v_res       jsonb;
  v_n         jsonb;
  v_e         jsonb;
  v_msg       text;
  v_brands    boolean := app.has_store_permission(p_store_id, 'brands.manage');
  v_can_new   boolean := app.has_store_permission(p_store_id, 'products.create');
  v_can_edit  boolean := app.has_store_permission(p_store_id, 'products.update');
  v_can_pub   boolean := app.has_store_permission(p_store_id, 'products.publish');
  v_can_stock boolean := app.has_store_permission(p_store_id, 'inventory.adjust');
  v_cat       text;
  v_needs     text[] := array['imports.run'];
  v_known     constant text[] := array['handle', 'title', 'status', 'description', 'brand', 'categories', 'tags',
    'option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value',
    'sku', 'barcode', 'price', 'compare_at_price', 'inventory_quantity', 'inventory_policy',
    'requires_shipping', 'weight_g', 'length_mm', 'width_mm', 'height_mm', 'variant_status',
    'seo_title', 'seo_description',
    -- R-T05
    'regulatory_category', 'regulatory_form', 'regulatory_serving_size', 'regulatory_servings_per_container',
    'regulatory_ingredients', 'regulatory_nutrition', 'regulatory_usage', 'regulatory_warnings',
    'regulatory_storage', 'regulatory_allergens', 'regulatory_sanitary_notice', 'attributes',
    -- Fase A
    'regulatory_net_content'];
begin
  v_uid := app.require_store_permission(p_store_id, 'imports.run');
  if p_mode is null or p_mode not in ('create_only', 'update_existing', 'upsert') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'mode';
  end if;
  if p_columns is null or not ('handle' = any (p_columns)) or not (p_columns <@ v_known)
     or cardinality(p_columns) <> (select count(distinct c) from unnest(p_columns) c) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'columns';
  end if;
  if coalesce(cardinality(p_ignored), 0) > 50
     or exists (select 1 from unnest(coalesce(p_ignored, '{}')) c where char_length(c) > 100) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'columns';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'too_many_rows';
  end if;
  -- Forma del plan: lo arma el servidor, pero la base no confía en ella.
  if exists (
    select 1 from jsonb_array_elements(p_rows) x
     where jsonb_typeof(x -> 'row_number') is distinct from 'number'
        or jsonb_typeof(coalesce(x -> 'raw', '{}'::jsonb)) <> 'object'
        or jsonb_typeof(coalesce(x -> 'errors', '[]'::jsonb)) <> 'array'
        or (jsonb_typeof(x -> 'normalized') = 'object'
            and (nullif(x -> 'normalized' ->> 'handle', '') is null
                 or jsonb_typeof(x -> 'normalized' -> 'variants') is distinct from 'array'
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'product', '{}'::jsonb)) <> 'object'
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'categories', '[]'::jsonb)) <> 'array'
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'regulatory', '{}'::jsonb)) <> 'object'
                 or jsonb_typeof(coalesce(x -> 'normalized' -> 'attributes', '{}'::jsonb)) <> 'object'))
        or coalesce(jsonb_typeof(x -> 'normalized'), 'null') not in ('object', 'null')
        or octet_length(coalesce(x -> 'normalized', 'null'::jsonb)::text) > 262144
  ) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end if;

  insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, columns, ignored_columns)
  values (p_store_id, 'products', p_mode, 'validating', left(btrim(coalesce(nullif(p_file_name, ''), 'archivo.csv')), 200),
          v_uid, p_columns, coalesce(p_ignored, '{}'))
  returning id into v_job;

  begin
    insert into public.import_job_rows (store_id, import_job_id, row_number, raw, normalized, errors)
    select p_store_id, v_job, (x ->> 'row_number')::integer,
           -- Solo las columnas de la plantilla (lo ignorado no se guarda).
           (select coalesce(jsonb_object_agg(e.key, left(e.value, 10000)), '{}'::jsonb)
              from jsonb_each_text(coalesce(x -> 'raw', '{}'::jsonb)) e where e.key = any (p_columns)),
           nullif(x -> 'normalized', 'null'::jsonb),
           (select coalesce(jsonb_agg(left(e, 300)), '[]'::jsonb)
              from jsonb_array_elements_text(coalesce(x -> 'errors', '[]'::jsonb)) e)
      from jsonb_array_elements(p_rows) x;
  exception when unique_violation or check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'rows';
  end;

  for v_r in
    select r.id, r.row_number, r.normalized from public.import_job_rows r
     where r.import_job_id = v_job and r.normalized is not null order by r.row_number
  loop
    v_n := v_r.normalized;
    v_res := app.import_resolve(p_store_id, p_mode, v_n);
    -- Los permisos que exigirá la confirmación, avisados por fila desde ya (el worker los revalida).
    if v_res ->> 'action' = 'create' and not v_can_new
       or v_res ->> 'action' = 'update' and (v_res ->> 'touches_catalog')::boolean and not v_can_edit then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'handle: tu rol no puede crear o editar productos (solo existencias)'));
    end if;
    v_needs := v_needs
      || case when v_res ->> 'action' = 'create' then array['products.create'] else '{}' end
      || case when v_res ->> 'action' = 'update' and (v_res ->> 'touches_catalog')::boolean
              then array['products.update'] else '{}' end
      || case when v_n ? 'status' then array['products.publish'] else '{}' end
      -- La ficha y los atributos se guardan con las RPC del panel (products.update).
      || case when v_n ? 'regulatory' or v_n ? 'attributes' then array['products.update'] else '{}' end
      || case when jsonb_array_length(v_res -> 'targets') > 0 then array['inventory.adjust'] else '{}' end
      || case when nullif(btrim(v_n ->> 'brand'), '') is not null
                   and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.deleted_at is null
                                                                  and lower(b.name) = lower(btrim(v_n ->> 'brand')))
              then array['brands.manage'] else '{}' end;
    if (v_n ? 'regulatory' or v_n ? 'attributes') and not v_can_edit then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'regulatory_category: tu rol no puede editar la ficha ni los atributos'));
    end if;
    if v_n ? 'status' and not v_can_pub then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'status: tu rol no puede publicar ni despublicar productos'));
    end if;
    if jsonb_array_length(v_res -> 'targets') > 0 and not v_can_stock then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'inventory_quantity: tu rol no puede ajustar existencias'));
    end if;
    if nullif(btrim(v_n ->> 'brand'), '') is not null and not v_brands
       and not exists (select 1 from public.brands b where b.store_id = p_store_id and b.deleted_at is null
                                                     and lower(b.name) = lower(btrim(v_n ->> 'brand'))) then
      v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                 'message', 'brand: no existe y tu rol no puede crear marcas'));
    end if;
    for v_cat in select c #>> '{}' from jsonb_array_elements(coalesce(v_n -> 'categories', '[]'::jsonb)) c
                  where jsonb_typeof(c) = 'string' and nullif(btrim(c #>> '{}'), '') is not null loop
      if app.category_by_path(p_store_id, v_cat) is null then
        v_res := jsonb_set(v_res, '{errors}', (v_res -> 'errors') || jsonb_build_object('row', v_r.row_number,
                   'message', format('categories: no existe la categoría %s', left(v_cat, 200))));
      end if;
    end loop;

    update public.import_job_rows set action = v_res ->> 'action' where id = v_r.id;
    for v_e in select * from jsonb_array_elements(v_res -> 'errors') loop
      -- Un número de fila ajeno al archivo se anota en la fila del producto.
      update public.import_job_rows r
         set errors = r.errors || to_jsonb(left(v_e ->> 'message', 300))
       where r.import_job_id = v_job
         and r.row_number = coalesce((select r2.row_number from public.import_job_rows r2
                                       where r2.import_job_id = v_job and r2.row_number = (v_e ->> 'row')::integer),
                                     v_r.row_number);
    end loop;
  end loop;

  update public.import_job_rows set action = 'error' where import_job_id = v_job and jsonb_array_length(errors) > 0;
  update public.import_jobs j
     set status = 'validated',
         needs = (select array_agg(distinct n order by n) from unnest(v_needs) n),
         totals = (select jsonb_build_object(
                     'rows', count(*),
                     'products', count(*) filter (where r.normalized is not null),
                     'create', count(*) filter (where r.action = 'create'),
                     'update', count(*) filter (where r.action = 'update'),
                     'errors', count(*) filter (where r.action = 'error'))
                     from public.import_job_rows r where r.import_job_id = v_job)
   where j.id = v_job;
  perform audit.record('import.requested', 'import_job', v_job,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, (select jsonb_build_object('type', 'products', 'mode', p_mode, 'file', j.file_name)
                                     || j.totals || jsonb_build_object('ignored_columns', to_jsonb(j.ignored_columns))
                                from public.import_jobs j where j.id = v_job));
  return v_job;
end
$$;
revoke all on function public.imports_create(uuid, text, text, text[], text[], jsonb) from public;
grant execute on function public.imports_create(uuid, text, text, text[], text[], jsonb) to authenticated;
