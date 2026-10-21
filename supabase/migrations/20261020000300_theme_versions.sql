-- =============================================================================
-- ADR-034 §4 · Historial de versiones del diseño. Cada publicación guarda una
-- versión (tema, portada y logo) en la misma transacción; se conservan las
-- últimas 30. «Restaurar» copia una versión al BORRADOR (nunca publica
-- directo): la dueña la revisa en la vista previa y publica como siempre.
--
-- El logo va con FK compuesta y `on delete set null (logo_media_id)`, como las
-- marcas: purgar la imagen no rompe la versión. Al restaurar se revalidan todas
-- las referencias contra la tienda (las mismas reglas que al guardar).
-- =============================================================================

create table public.store_theme_versions (
  id            uuid primary key default app.uuid_v7(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  number        integer not null check (number > 0),
  settings      jsonb not null check (app.theme_settings_valid(settings)),
  home_sections jsonb not null check (app.home_sections_valid(home_sections)),
  logo_media_id uuid,
  published_by  uuid references auth.users (id) on delete set null,
  published_at  timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, number),
  foreign key (store_id, logo_media_id) references public.media (store_id, id)
    on delete set null (logo_media_id)
);
create index store_theme_versions_store_idx on public.store_theme_versions (store_id, number desc);

-- Solo se agregan (y la publicación poda las más viejas); su contenido nunca se
-- edita. Lo único que cambia es un null puesto por una FK (logo purgado, usuario
-- borrado).
create trigger store_theme_versions_prevent_tenant_change before update on public.store_theme_versions
  for each row execute function app.prevent_tenant_change();
create trigger store_theme_versions_immutable before update on public.store_theme_versions
  for each row execute function app.prevent_column_change('number', 'settings', 'home_sections', 'published_at');

alter table public.store_theme_versions enable row level security;
alter table public.store_theme_versions force row level security;
revoke all on table public.store_theme_versions from public, anon, authenticated, service_role;
grant select on public.store_theme_versions to authenticated;
create policy store_theme_versions_select on public.store_theme_versions for select to authenticated
  using (app.has_store_permission(store_id, 'appearance.manage'));

-- -----------------------------------------------------------------------------
-- Publicar: igual que 20261017000600 + guarda la versión publicada.
-- -----------------------------------------------------------------------------
create or replace function public.appearance_publish_theme(p_store_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.theme_require_editor(p_store_id);
  v        public.store_themes;
  v_issues text[];
  v_now    timestamptz := now();
  v_number integer;
begin
  select * into v from public.store_themes t where t.store_id = p_store_id for update;
  if v.store_id is null or p_expected_revision is null or v.draft_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'conflict', detail = 'draft_revision',
      hint = coalesce(v.draft_revision, 0)::text;
  end if;
  if v.draft_settings is null then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'no_draft';
  end if;
  v_issues := app.theme_contrast_issues(v.draft_settings);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'contrast',
      hint = array_to_string(v_issues, ',');
  end if;
  v_issues := app.theme_reference_issues(p_store_id, v.draft_settings, v.draft_home_sections);
  if v.draft_logo_media_id is not null
     and not app.theme_media_ok(p_store_id, v.draft_logo_media_id, array['store_branding']) then
    v_issues := v_issues || 'logo'::text;
  end if;
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'references',
      hint = array_to_string(v_issues, ',');
  end if;
  v_issues := app.home_compliance_issues(p_store_id, v.draft_home_sections);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'compliance',
      hint = array_to_string(v_issues, ',');
  end if;

  update public.store_themes
     set settings = draft_settings, home_sections = draft_home_sections, logo_media_id = draft_logo_media_id,
         draft_settings = null, draft_home_sections = null, draft_logo_media_id = null,
         draft_revision = draft_revision + 1, published_at = v_now, published_by = v_uid
   where store_id = p_store_id;

  -- Versión publicada (ADR-034 §4). El número sigue creciendo aunque se poden las viejas.
  select coalesce(max(x.number), 0) + 1 into v_number
    from public.store_theme_versions x where x.store_id = p_store_id;
  insert into public.store_theme_versions (store_id, number, settings, home_sections, logo_media_id,
                                           published_by, published_at)
  values (p_store_id, v_number, v.draft_settings, v.draft_home_sections, v.draft_logo_media_id, v_uid, v_now);
  delete from public.store_theme_versions x
   where x.store_id = p_store_id and x.number <= v_number - 30;

  perform audit.record('theme.published', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('settings', v.settings, 'home_sections', v.home_sections,
                                          'logo_media_id', v.logo_media_id),
                       jsonb_build_object('settings', v.draft_settings, 'home_sections', v.draft_home_sections,
                                          'logo_media_id', v.draft_logo_media_id, 'version', v_number));
  return jsonb_build_object('published_at', v_now, 'revision', v.draft_revision + 1, 'version', v_number);
end
$$;

-- -----------------------------------------------------------------------------
-- Restaurar una versión al borrador. Revalida las referencias: lo que ya no
-- existe se informa (no se restaura algo roto). Un logo que ya no está se omite
-- y la respuesta lo dice, para que la dueña elija otro.
-- -----------------------------------------------------------------------------
create or replace function public.appearance_restore_theme_version(p_store_id uuid, p_version_id uuid,
                                                                   p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_theme   public.store_themes;
  v_version public.store_theme_versions;
  v_issues  text[];
  v_logo    uuid;
begin
  perform app.theme_require_editor(p_store_id);
  select * into v_version from public.store_theme_versions x
   where x.store_id = p_store_id and x.id = p_version_id;
  if v_version.id is null then
    raise exception using errcode = 'P0001', message = 'not_found', detail = 'version';
  end if;
  v_issues := app.theme_reference_issues(p_store_id, v_version.settings, v_version.home_sections);
  if cardinality(v_issues) > 0 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'references',
      hint = array_to_string(v_issues, ',');
  end if;
  v_theme := app.theme_lock_draft(p_store_id, p_expected_revision);
  v_logo := case when v_version.logo_media_id is not null
                      and app.theme_media_ok(p_store_id, v_version.logo_media_id, array['store_branding'])
                 then v_version.logo_media_id end;
  update public.store_themes
     set draft_settings = v_version.settings, draft_home_sections = v_version.home_sections,
         draft_logo_media_id = v_logo, draft_revision = draft_revision + 1
   where store_id = p_store_id;
  perform audit.record('theme.version_restored', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       jsonb_build_object('settings', v_theme.draft_settings,
                                          'home_sections', v_theme.draft_home_sections),
                       jsonb_build_object('version', v_version.number));
  return jsonb_build_object('revision', v_theme.draft_revision + 1, 'version', v_version.number,
                            'logo_missing', v_version.logo_media_id is not null and v_logo is null);
end
$$;

revoke all on function public.appearance_publish_theme(uuid, integer) from public;
grant execute on function public.appearance_publish_theme(uuid, integer) to authenticated;
revoke all on function public.appearance_restore_theme_version(uuid, uuid, integer) from public;
grant execute on function public.appearance_restore_theme_version(uuid, uuid, integer) to authenticated;
