-- =============================================================================
-- Auditoría global 2026-11-05, paso 20: correos del comprador con el texto de
-- la tienda. Por cada correo (pedido recibido, pagado, enviado, entregado,
-- cancelado y reembolso) la dueña cambia el asunto y agrega un mensaje suyo,
-- con variables fijas {nombre}, {pedido} y {tienda}. Lo esencial del correo
-- (montos, guía, enlaces) no se edita y todo se escapa: sin HTML libre (regla 13).
-- Detrás del interruptor por tienda `email_texts` (apagado; Ajustes → Funciones).
--
-- Reversa: `update public.feature_flags set kill_switch = true where key =
-- 'email_texts'` vuelve a los textos de siempre sin borrar lo guardado.
-- =============================================================================

insert into public.feature_flags (key, description, default_enabled, owner, store_toggle) values
  ('email_texts', 'Correos del comprador con el asunto y un mensaje de la tienda', false, 'plataforma', true)
on conflict (key) do nothing;

create table public.store_email_texts (
  id         uuid primary key default app.uuid_v7(),
  store_id   uuid not null references public.stores (id) on delete cascade,
  template   text not null check (template in ('order_received', 'order_confirmation', 'order_shipped',
                                                'order_delivered', 'order_cancelled', 'refund_issued')),
  subject    text check (subject is null or (char_length(subject) between 1 and 150 and subject !~ '[\r\n]')),
  note       text check (note is null or char_length(note) between 1 and 1000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, id),
  unique (store_id, template),
  check (subject is not null or note is not null)
);
create trigger store_email_texts_set_updated_at before update on public.store_email_texts
  for each row execute function app.set_updated_at();
create trigger store_email_texts_prevent_tenant_change before update on public.store_email_texts
  for each row execute function app.prevent_tenant_change();
alter table public.store_email_texts enable row level security;
alter table public.store_email_texts force row level security;
revoke all on table public.store_email_texts from public, anon, authenticated, service_role;
grant select on table public.store_email_texts to authenticated;
create policy store_email_texts_select on public.store_email_texts for select to authenticated
  using (app.has_store_permission(store_id, 'store.read'));

-- Guardar o, con los dos campos vacíos, volver al texto de siempre.
create function public.email_texts_save(p_store_id uuid, p_template text, p_subject text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Sin caracteres de control (salvo saltos de línea en el mensaje).
  v_subject text := nullif(btrim(regexp_replace(coalesce(p_subject, ''), '[[:cntrl:]]', ' ', 'g')), '');
  v_note    text := nullif(btrim(regexp_replace(replace(coalesce(p_note, ''), E'\r', ''),
                                                '[\x01-\x09\x0b-\x1f\x7f]', ' ', 'g')), '');
  v_old     public.store_email_texts;
begin
  perform app.require_store_permission(p_store_id, 'store.update');
  if p_template is null or p_template not in ('order_received', 'order_confirmation', 'order_shipped',
                                               'order_delivered', 'order_cancelled', 'refund_issued') then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'template';
  end if;
  if v_subject is not null and char_length(v_subject) > 150 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'subject';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'note';
  end if;
  select * into v_old from public.store_email_texts t
   where t.store_id = p_store_id and t.template = p_template for update;
  if v_subject is null and v_note is null then
    delete from public.store_email_texts t where t.store_id = p_store_id and t.template = p_template;
  else
    insert into public.store_email_texts (store_id, template, subject, note, updated_by)
    values (p_store_id, p_template, v_subject, v_note, auth.uid())
    on conflict (store_id, template) do update
       set subject = excluded.subject, note = excluded.note, updated_by = excluded.updated_by;
  end if;
  perform audit.record('store.email_text_changed', 'store', p_store_id,
                       (select s.organization_id from public.stores s where s.id = p_store_id), p_store_id,
                       case when v_old.id is null then null
                            else jsonb_build_object('template', p_template, 'subject', v_old.subject,
                                                    'note', v_old.note) end,
                       jsonb_build_object('template', p_template, 'subject', v_subject, 'note', v_note));
end
$$;

-- Para el worker: los textos de la tienda solo si el interruptor está encendido.
create function system.store_email_texts(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.flag_enabled('email_texts', p_store_id) then
           coalesce((select jsonb_object_agg(t.template, jsonb_build_object('subject', t.subject, 'note', t.note))
                       from public.store_email_texts t where t.store_id = p_store_id), '{}'::jsonb)
         else '{}'::jsonb end
$$;

revoke all on function public.email_texts_save(uuid, text, text, text) from public;
revoke all on function system.store_email_texts(uuid) from public;
grant execute on function public.email_texts_save(uuid, text, text, text) to authenticated;
grant execute on function system.store_email_texts(uuid) to system_worker;

create or replace function public.app_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '20261105000800'::text
$$;
