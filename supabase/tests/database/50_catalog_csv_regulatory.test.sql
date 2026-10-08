-- =============================================================================
-- Fase R · R-T05 — La ficha y los atributos en el CSV de productos. `|` y `;`
-- separan celdas y renglones de la tabla nutrimental compacta: no se aceptan
-- dentro de ella (lo exportado se vuelve a importar igual).
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || coalesce('/' || nullif(v_detail, ''), '') || coalesce('/' || nullif(v_hint, ''), '');
end $$;

select is(pg_temp.err($$select app.regulatory_normalize('dietary_supplement',
            '{"nutrition":[{"name":"Omega 3|EPA","amount":"1000"}]}')$$),
          'validation_failed/regulatory/nutrition', '"|" no va dentro de la tabla nutrimental');
select is(pg_temp.err($$select app.regulatory_normalize('dietary_supplement',
            '{"nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg; EPA"}]}')$$),
          'validation_failed/regulatory/nutrition', 'ni ";"');
select is(app.regulatory_normalize('dietary_supplement',
            '{"ingredients":"Aceite de pescado; gelatina | glicerina","nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg"}]}'),
          '{"ingredients":"Aceite de pescado; gelatina | glicerina","nutrition":[{"name":"Omega 3","amount":"1000","unit":"mg"}]}'::jsonb,
          'los textos de la ficha sí pueden llevarlos (van en su propia columna)');

select * from finish();
rollback;
