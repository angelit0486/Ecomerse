-- =============================================================================
-- Fase 8 · Ajustes → Actividad (F8-T05). Contrato: GATE0 §29 (auditoría
-- consultable por la tienda; sin PII completa, ya redactada al escribir).
--
-- * audit.read (sensible): solo los eventos de ESTA tienda. Sin IP ni agente.
-- * Filtro por área (lista blanca de prefijos de acción) y paginación por cursor.
-- =============================================================================

create or replace function public.audit_list(p_store_id uuid, p_area text, p_cursor text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefixes text[];
  v_limit    integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_at       timestamptz;
  v_id       uuid;
  v_rows     jsonb;
  v_next     text;
begin
  perform app.require_store_permission(p_store_id, 'audit.read');
  v_prefixes := case coalesce(p_area, '')
    when '' then null
    when 'pedidos' then array['order.', 'payments.']
    when 'clientes' then array['customer.']
    when 'catalogo' then array['product.', 'brand.', 'category.', 'media.', 'inventory.']
    when 'tienda' then array['store.', 'theme.', 'menu.', 'page.', 'shipping.', 'discount.']
    when 'equipo' then array['member.', 'support_session.']
    else array['invalid'] end;
  if v_prefixes = array['invalid'] then
    raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'area';
  end if;
  if p_cursor is not null then
    begin
      v_at := split_part(p_cursor, '|', 1)::timestamptz;
      v_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'validation_failed', detail = 'cursor';
    end;
  end if;

  with page as (
    select a.id, a.occurred_at, a.actor_type, a.actor_label, a.support_grant_id is not null as via_support,
           a.action, a.entity_type, a.entity_id, a.before, a.after, a.reason
      from audit.audit_logs a
     where a.store_id = p_store_id
       and (v_prefixes is null or exists (select 1 from unnest(v_prefixes) p where starts_with(a.action, p)))
       and (v_at is null or (a.occurred_at, a.id) < (v_at, v_id))
     order by a.occurred_at desc, a.id desc
     limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by occurred_at desc, id desc) as rn, count(*) over () as total from page
  )
  select coalesce(jsonb_agg(jsonb_build_object('occurred_at', occurred_at, 'actor_type', actor_type,
                                               'actor_label', actor_label, 'via_support', via_support,
                                               'action', action, 'entity_type', entity_type, 'entity_id', entity_id,
                                               'before', before, 'after', after, 'reason', reason)
                            order by occurred_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         max(case when rn = v_limit and total > v_limit then occurred_at::text || '|' || id end)
    into v_rows, v_next
    from numbered;
  return jsonb_build_object('items', v_rows, 'next_cursor', v_next);
end
$$;

revoke all on function public.audit_list(uuid, text, text, integer) from public;
grant execute on function public.audit_list(uuid, text, text, integer) to authenticated;
