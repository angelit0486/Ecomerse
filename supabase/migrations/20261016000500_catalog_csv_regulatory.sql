-- =============================================================================
-- Fase R · R-T05 — La ficha sanitaria y los atributos en el CSV de productos
-- (exportación e importación, F8-T04). La tabla nutrimental y los atributos van
-- en formato compacto (src/lib/catalog/compact.ts): `nombre|cantidad|unidad|%VNR`
-- separados por `;`, y `clave:valor|valor` separados por `;`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `|` y `;` separan celdas y renglones de la tabla en el CSV: ya no se aceptan
--    dentro de la tabla nutrimental (lo exportado se vuelve a importar igual).
--    Igual que en R-T01 salvo esa regla.
-- -----------------------------------------------------------------------------
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
