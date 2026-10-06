-- =============================================================================
-- Fase 3 · Logo de la tienda (F3-T06, D-F2-05)
-- El logo es un medio `store_branding` (máx. 2 MB) que pasó por el pipeline
-- seguro de F3-T03. Sigue el flujo del branding: se elige en el borrador del
-- tema y se publica con él. El storefront solo ve el logo publicado.
-- =============================================================================

alter table public.store_themes
  add column logo_media_id uuid,
  add column draft_logo_media_id uuid,
  add constraint store_themes_logo_fk foreign key (store_id, logo_media_id)
    references public.media (store_id, id) on delete set null (logo_media_id),
  add constraint store_themes_draft_logo_fk foreign key (store_id, draft_logo_media_id)
    references public.media (store_id, id) on delete set null (draft_logo_media_id);

-- -----------------------------------------------------------------------------
-- Elegir (o quitar, con null) el logo del borrador. Solo un medio de branding
-- listo de ESA tienda. Si no había borrador, parte del tema publicado.
-- -----------------------------------------------------------------------------
create or replace function public.appearance_set_logo_draft(p_store_id uuid, p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_store_permission(p_store_id, 'appearance.manage');
  if p_media_id is not null and not exists (
    select 1 from public.media m
     where m.id = p_media_id and m.store_id = p_store_id and m.owner_type = 'store_branding'
       and m.status = 'ready' and m.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'logo';
  end if;

  insert into public.store_themes (store_id, draft_settings, draft_logo_media_id)
  values (p_store_id, '{}'::jsonb, p_media_id)
  on conflict (store_id) do update
    set draft_settings = coalesce(store_themes.draft_settings, store_themes.settings),
        draft_logo_media_id = excluded.draft_logo_media_id;

  perform audit.record('theme.logo_draft_set', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('logo_media_id', p_media_id));
end
$$;

-- -----------------------------------------------------------------------------
-- Guardar colores en un borrador nuevo conserva el logo publicado. Misma
-- validación que la versión de la Fase 2 (onboarding).
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
  on conflict (store_id) do update
    set draft_settings = excluded.draft_settings,
        draft_logo_media_id = case when store_themes.draft_settings is null then store_themes.logo_media_id
                                   else store_themes.draft_logo_media_id end;

  perform audit.record('theme.draft_saved', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       null, jsonb_build_object('settings', p_settings));
end
$$;

-- -----------------------------------------------------------------------------
-- Publicar el tema publica también el logo del borrador.
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
  v_logo   uuid;
  v_now    timestamptz := now();
begin
  if not app.has_store_permission(p_store_id, 'appearance.manage') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select t.settings, t.draft_settings, t.draft_logo_media_id into v_before, v_after, v_logo
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
         logo_media_id = draft_logo_media_id,
         draft_settings = null,
         draft_home_sections = null,
         draft_logo_media_id = null,
         published_at = v_now,
         published_by = v_uid
   where store_id = p_store_id;

  perform audit.record('theme.published', 'store_theme', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id),
                       p_store_id, jsonb_build_object('settings', v_before),
                       jsonb_build_object('settings', v_after, 'logo_media_id', v_logo));
  return v_now;
end
$$;

-- -----------------------------------------------------------------------------
-- Borrar un medio lo quita también del tema (redefine la versión de F3-T03).
-- -----------------------------------------------------------------------------
create or replace function public.media_delete(p_store_id uuid, p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.media;
begin
  v := app.lock_media(p_store_id, p_media_id);
  update public.product_variants set image_id = null where store_id = p_store_id and image_id = v.id;
  update public.brands set logo_media_id = null where store_id = p_store_id and logo_media_id = v.id;
  update public.categories set image_media_id = null where store_id = p_store_id and image_media_id = v.id;
  update public.store_themes
     set logo_media_id = case when logo_media_id = v.id then null else logo_media_id end,
         draft_logo_media_id = case when draft_logo_media_id = v.id then null else draft_logo_media_id end
   where store_id = p_store_id and (logo_media_id = v.id or draft_logo_media_id = v.id);
  update public.media set deleted_at = now() where id = v.id;
  perform audit.record('media.deleted', 'media', v.id, null, p_store_id,
                       jsonb_build_object('owner_type', v.owner_type, 'product_id', v.product_id), null);
end
$$;

-- -----------------------------------------------------------------------------
-- Datos públicos: el logo publicado (ruta y dimensiones), solo si está listo.
-- -----------------------------------------------------------------------------
create or replace function storefront.get_store_public(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'handle', s.handle, 'status', s.status,
    'locale', s.locale, 'currency', s.currency, 'country', s.country,
    'theme', jsonb_build_object('key', t.theme_key, 'version', t.theme_version,
                                'settings', coalesce(t.settings, '{}'::jsonb)),
    'logo', (select jsonb_build_object('path', m.storage_path, 'width', m.width, 'height', m.height)
               from public.media m
              where m.store_id = s.id and m.id = t.logo_media_id
                and m.status = 'ready' and m.deleted_at is null)
  )
  from public.stores s
  left join public.store_themes t on t.store_id = s.id
  where s.id = p_store_id and s.status <> 'closed'
$$;

revoke all on function public.appearance_set_logo_draft(uuid, uuid) from public;
grant execute on function public.appearance_set_logo_draft(uuid, uuid) to authenticated;
