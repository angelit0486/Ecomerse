-- =============================================================================
-- Fase 2 · Onboarding: datos de la tienda y branding en borrador (F2-T11)
-- Contrato: GATE0 §20.2 (colores con contraste ≥ 4.5:1 texto/fondo y ≥ 3:1 en
-- botones; el contraste insuficiente bloquea), §20.3 (borrador → publicar),
-- §44.8 (el cliente nunca es autoridad: la base valida). Decisión A-02.
--
-- Las reglas de contraste existen también en TypeScript (src/lib/theme) para dar
-- feedback inmediato; tests/integration/theme-parity.test.ts verifica que ambas
-- implementaciones coinciden.
-- =============================================================================

-- Luminancia relativa WCAG de #rrggbb.
create or replace function app.hex_luminance(p_hex text)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_c double precision[];
  v_i integer;
  v_v double precision;
begin
  if p_hex !~ '^#[0-9a-f]{6}$' then
    raise exception using errcode = '22023', message = 'invalid_color';
  end if;
  v_c := array[
    ('x' || substr(p_hex, 2, 2))::bit(8)::integer / 255.0,
    ('x' || substr(p_hex, 4, 2))::bit(8)::integer / 255.0,
    ('x' || substr(p_hex, 6, 2))::bit(8)::integer / 255.0
  ];
  for v_i in 1..3 loop
    v_v := v_c[v_i];
    v_c[v_i] := case when v_v <= 0.03928 then v_v / 12.92 else power((v_v + 0.055) / 1.055, 2.4) end;
  end loop;
  return 0.2126 * v_c[1] + 0.7152 * v_c[2] + 0.0722 * v_c[3];
end
$$;

create or replace function app.contrast_ratio(p_a text, p_b text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select (greatest(app.hex_luminance(p_a), app.hex_luminance(p_b)) + 0.05)
       / (least(app.hex_luminance(p_a), app.hex_luminance(p_b)) + 0.05)
$$;

-- Paleta por defecto del tema base (fallback de §20.2). Espejo: src/lib/theme/palette.ts.
create or replace function app.theme_default_colors()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'primary', '#1d4ed8', 'accent', '#b45309', 'background', '#ffffff',
    'foreground', '#111827', 'muted', '#4b5563')
$$;

-- Comprobaciones que fallan para una configuración (colores parciales se
-- completan con los de por defecto). Vacío = válida.
--   foreground: texto/fondo ≥ 4.5 · muted: texto secundario/fondo ≥ 4.5
--   primary, accent: botón/enlace sobre el fondo ≥ 3
-- El texto de los botones se deriva (blanco o negro, el de mayor contraste con
-- primary): siempre supera 4.5:1, así que no necesita comprobación.
create or replace function app.theme_contrast_issues(p_settings jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb := app.theme_default_colors() || coalesce(p_settings -> 'colors', '{}'::jsonb);
  v_bg text := c ->> 'background';
  v_issues text[] := '{}';
begin
  if app.contrast_ratio(c ->> 'foreground', v_bg) < 4.5 then v_issues := v_issues || 'foreground'::text; end if;
  if app.contrast_ratio(c ->> 'muted', v_bg) < 4.5 then v_issues := v_issues || 'muted'::text; end if;
  if app.contrast_ratio(c ->> 'primary', v_bg) < 3 then v_issues := v_issues || 'primary'::text; end if;
  if app.contrast_ratio(c ->> 'accent', v_bg) < 3 then v_issues := v_issues || 'accent'::text; end if;
  return v_issues;
end
$$;

revoke all on function app.hex_luminance(text) from public;
revoke all on function app.contrast_ratio(text, text) from public;
revoke all on function app.theme_default_colors() from public;
revoke all on function app.theme_contrast_issues(jsonb) from public;

-- -----------------------------------------------------------------------------
-- Datos de la tienda (paso 2). Auditado.
-- -----------------------------------------------------------------------------
create or replace function public.store_update_profile(
  p_store_id      uuid,
  p_name          text,
  p_contact_email text,
  p_contact_phone text,
  p_timezone      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_name   text := btrim(p_name);
  v_email  text := lower(btrim(p_contact_email));
  v_phone  text := nullif(btrim(coalesce(p_contact_phone, '')), '');
begin
  perform app.require_aal2_user();
  if not app.has_store_permission(p_store_id, 'store.update') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 80 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'name';
  end if;
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'contact_email';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'contact_phone';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'timezone';
  end if;

  select jsonb_build_object('name', s.name, 'contact_email', s.contact_email,
                            'contact_phone', s.contact_phone, 'timezone', s.timezone)
    into v_before from public.stores s where s.id = p_store_id for update;

  update public.stores
     set name = v_name, contact_email = v_email, contact_phone = v_phone, timezone = p_timezone
   where id = p_store_id;

  perform audit.record('store.updated', 'store', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       v_before, jsonb_build_object('name', v_name, 'contact_email', v_email,
                                                    'contact_phone', v_phone, 'timezone', p_timezone));
end
$$;

-- -----------------------------------------------------------------------------
-- Branding en borrador (paso 2). Forma válida y contraste suficiente o nada.
-- -----------------------------------------------------------------------------
create or replace function public.appearance_save_theme_draft(p_store_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issues text[];
begin
  perform app.require_aal2_user();
  if not app.has_store_permission(p_store_id, 'appearance.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if not app.theme_settings_valid(p_settings) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'settings';
  end if;
  v_issues := app.theme_contrast_issues(p_settings);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'contrast',
      hint = array_to_string(v_issues, ',');
  end if;

  insert into public.store_themes (store_id, draft_settings) values (p_store_id, p_settings)
  on conflict (store_id) do update set draft_settings = excluded.draft_settings;

  perform audit.record('theme.draft_saved', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('settings', p_settings));
end
$$;

-- -----------------------------------------------------------------------------
-- Publicar el tema exige también contraste suficiente (§20.2). Redefinición
-- compatible de la función de la Fase 2 (A + B).
-- -----------------------------------------------------------------------------
create or replace function public.appearance_publish_theme(p_store_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_aal2_user();
  v_before jsonb;
  v_after  jsonb;
  v_now    timestamptz := now();
begin
  if not app.has_store_permission(p_store_id, 'appearance.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select t.settings, t.draft_settings into v_before, v_after
    from public.store_themes t where t.store_id = p_store_id for update;
  if v_after is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'no_draft';
  end if;
  if cardinality(app.theme_contrast_issues(v_after)) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'contrast';
  end if;

  update public.store_themes
     set settings = draft_settings,
         home_sections = coalesce(draft_home_sections, home_sections),
         draft_settings = null,
         draft_home_sections = null,
         published_at = v_now,
         published_by = v_uid
   where store_id = p_store_id;

  perform audit.record('theme.published', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id),
                       p_store_id, jsonb_build_object('settings', v_before),
                       jsonb_build_object('settings', v_after));
  return v_now;
end
$$;

-- El borrador del tema ya no se edita por tabla: solo con appearance_save_theme_draft,
-- que valida forma y contraste (la base es la autoridad, §44.8). D-F2-31.
drop policy store_themes_update_draft on public.store_themes;
revoke update on public.store_themes from authenticated;

revoke all on function public.store_update_profile(uuid, text, text, text, text) from public;
revoke all on function public.appearance_save_theme_draft(uuid, jsonb) from public;
grant execute on function public.store_update_profile(uuid, text, text, text, text) to authenticated;
grant execute on function public.appearance_save_theme_draft(uuid, jsonb) to authenticated;
