-- =============================================================================
-- Fase R · Gate R — Correcciones de la revisión adversarial de la fase.
--
-- 1. Términos prohibidos: el texto se normaliza también contra guiones suaves,
--    caracteres de ancho cero, entidades HTML y etiquetas en línea
--    (`c<b>u</b>ra`, `c&#250;ra`), y un término con signos en la orilla
--    (`100%`, `anti-`) se reconoce como palabra completa.
-- 2. El texto revisado incluye todo lo que el comprador ve junto al producto:
--    etiquetas, marca, opciones y valores, y el texto alternativo de las imágenes.
--    Cambiar la marca o el texto alternativo vuelve a revisar la tienda.
-- 3. La continuación de una revisión por lotes no se deduplica: con la clave
--    `after:<último id>` una segunda revisión que terminara en el mismo producto
--    no encolaba su siguiente lote.
-- 4. Guardar un atributo: el id de un valor siempre se comprueba (aunque traiga
--    clave), los valores que el formulario no conocía son un conflicto (otra
--    persona los agregó) y renombrar vuelve a revisar los productos publicados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Normalización del texto revisado
-- -----------------------------------------------------------------------------

-- Minúsculas, sin acentos, sin caracteres invisibles y con los espacios colapsados.
create or replace function app.compliance_text(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(regexp_replace(
           lower(extensions.unaccent(translate(coalesce(p_text, ''),
                                               chr(173) || chr(8203) || chr(8204) || chr(8205) || chr(8288)
                                               || chr(65279), ''))),
           '\s+', ' ', 'g'))
$$;
revoke all on function app.compliance_text(text) from public;

-- Texto visible de la descripción: las etiquetas en línea no separan palabras,
-- las de bloque sí, y las entidades se decodifican como lo haría el navegador
-- (con o sin punto y coma).
create or replace function app.compliance_html_text(p_html text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text  text := coalesce(p_html, '');
  v_re    constant text := '&#([xX][0-9a-fA-F]{1,6}|[0-9]{1,7});?';
  v_at    integer;
  v_ref   text;
  v_num   text;
  v_code  bigint;
  v_char  text;
  v_n     integer := 0;
  v_named record;
begin
  v_text := regexp_replace(v_text,
              '</?(a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var|wbr)([[:space:]/][^>]*)?>',
              '', 'gi');
  v_text := regexp_replace(v_text, '<[^>]*>', ' ', 'g');
  loop
    v_at := regexp_instr(v_text, v_re);
    exit when v_at = 0 or v_n >= 500;
    v_n := v_n + 1;
    v_ref := regexp_substr(v_text, v_re);
    v_num := (regexp_match(v_ref, v_re))[1];
    v_code := case when v_num ~ '^[xX]' then ('x' || lpad(substr(v_num, 2), 8, '0'))::bit(32)::integer
                   else v_num::bigint end;
    v_char := case when v_code between 1 and 1114111 and v_code not between 55296 and 57343 then chr(v_code::integer)
                   else ' ' end;
    v_text := overlay(v_text placing v_char from v_at for char_length(v_ref));
  end loop;
  for v_named in
    select * from (values
      ('aacute', 'á'), ('eacute', 'é'), ('iacute', 'í'), ('oacute', 'ó'), ('uacute', 'ú'), ('ntilde', 'ñ'),
      ('uuml', 'ü'), ('Aacute', 'Á'), ('Eacute', 'É'), ('Iacute', 'Í'), ('Oacute', 'Ó'), ('Uacute', 'Ú'),
      ('Ntilde', 'Ñ'), ('Uuml', 'Ü'), ('agrave', 'à'), ('egrave', 'è'), ('ograve', 'ò'), ('auml', 'ä'),
      ('euml', 'ë'), ('iuml', 'ï'), ('ouml', 'ö'), ('ccedil', 'ç'), ('nbsp', ' '), ('shy', ''),
      ('quot', '"'), ('apos', ''''), ('lt', '<'), ('gt', '>'), ('amp', '&')) e (name, ch)
  loop
    -- &amp; al final: «&amp;uacute;» se ve como «&uacute;», no como «ú».
    v_text := regexp_replace(v_text, '&' || v_named.name || ';?', v_named.ch, 'g');
  end loop;
  return v_text;
end
$$;
revoke all on function app.compliance_html_text(text) from public;

-- Palabra completa: el término no puede ir pegado a una letra o número, aunque
-- empiece o termine con un signo (`\m…\M` exige que la orilla sea una letra).
create or replace function app.compliance_term_regex(p_term text)
returns text
language sql
stable
set search_path = ''
as $$
  select '(^|[^[:alnum:]_])'
         || regexp_replace(app.compliance_text(btrim(p_term)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
         || '($|[^[:alnum:]_])'
$$;
revoke all on function app.compliance_term_regex(text) from public;

-- Revisión de una tienda tras un cambio que se ve junto a sus productos. Si ya
-- hay una en cola sin empezar, esa verá el cambio.
create or replace function app.request_store_compliance_recheck(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.store_regulated_categories d where d.store_id = p_store_id)
     and not exists (select 1 from system.jobs j
                      where j.type = 'compliance.recheck' and j.status = 'queued' and j.store_id = p_store_id
                        and j.payload = jsonb_build_object('store_id', p_store_id)) then
    perform app.enqueue_compliance_recheck(null, p_store_id, null);
  end if;
end
$$;
revoke all on function app.request_store_compliance_recheck(uuid) from public;

create or replace function app.compliance_recheck_on_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.request_store_compliance_recheck(new.store_id);
  return null;
end
$$;
revoke all on function app.compliance_recheck_on_change() from public;

create trigger brands_compliance_recheck after update of name on public.brands
  for each row when (new.name is distinct from old.name)
  execute function app.compliance_recheck_on_change();
create trigger media_compliance_recheck after update of alt_text on public.media
  for each row when (new.owner_type = 'product' and new.alt_text is distinct from old.alt_text)
  execute function app.compliance_recheck_on_change();

-- -----------------------------------------------------------------------------
-- 2. Validador de cumplimiento: igual que en R-T04 con el texto completo.
-- 3. Revisión por lotes: igual que en R-T01 con la continuación sin deduplicar.
-- 4. Guardar un atributo: igual que en R-T04 con las comprobaciones nuevas.
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
                            p_store_id, null, now(), 5);
  end if;
  return jsonb_build_object('checked', v_checked, 'unpublished', v_down, 'stores', to_jsonb(v_stores),
                            'done', v_checked < v_limit);
end
$$;
revoke all on function system.compliance_recheck(uuid, uuid, uuid, integer) from public;
grant execute on function system.compliance_recheck(uuid, uuid, uuid, integer) to system_worker;

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
      select coalesce(v_vkey, av.key) into v_vkey from public.attribute_values av
       where av.store_id = p_store_id and av.attribute_id = v_id and av.id = v_vid;
      if not found then
        raise exception using errcode = 'P0001', message = 'not_found', detail = 'value';
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
  -- El formulario dice qué valores conocía: uno que no conocía lo agregó otra
  -- persona mientras tanto y se borraría sin que nadie lo viera.
  if v_before is not null and p_attribute ? 'known_value_ids' then
    if jsonb_typeof(p_attribute -> 'known_value_ids') <> 'array' then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'values';
    end if;
    if exists (select 1 from public.attribute_values av
                where av.store_id = p_store_id and av.attribute_id = v_id
                  and not (av.id::text in (select jsonb_array_elements_text(p_attribute -> 'known_value_ids')))) then
      raise exception using errcode = 'P0001', message = 'conflict', detail = 'values';
    end if;
  end if;
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

  -- Los productos que lo usan se vuelven a revisar con el nombre nuevo.
  if v_before is not null then
    perform app.request_store_compliance_recheck(p_store_id);
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
