-- =============================================================================
-- Fase A (lanzamiento) · A-T02 — Reglas PROPUESTAS para suplementos en México
-- (D-A-01). PENDIENTE DE REVISIÓN del asesor regulatorio: la plataforma no
-- redacta texto legal ni lo da por revisado (D-S-01).
--
-- * Se retiran (no se borran) las reglas de demostración `demo_*`.
-- * Se proponen campos obligatorios, la leyenda de la tienda en ficha, carrito
--   y checkout, y una lista inicial de términos prohibidos. Todo editable desde
--   la consola de la plataforma (/platform/cumplimiento).
-- * El perfil queda `pending` y sin revisor. Si estaba activo (la vista previa
--   lo activaba con un revisor de demostración), la revisión que se encola
--   despublica sus productos: producto activo ⇒ cumple (invariante de R-T01).
--   Lote y caducidad van con el inventario (Fase C).
-- * Sin «enfermedad» ni «tratamiento»: las advertencias suelen decir «si padeces
--   alguna enfermedad» o «si estás en tratamiento médico» y el texto revisado
--   incluye la ficha completa.
-- =============================================================================
do $$
declare
  v_profile public.compliance_profiles;
begin
  select * into v_profile from public.compliance_profiles cp
   where cp.country = 'MX' and cp.category_key = 'dietary_supplement'
   for update;
  if v_profile.id is null then
    return;
  end if;

  update public.compliance_rules set status = 'retired'
   where profile_id = v_profile.id and key like 'demo\_%' and status = 'active';

  insert into public.compliance_rules (profile_id, kind, key, label, body, field_key, placements, position)
  values
    (v_profile.id, 'required_field', 'campo_ingredientes', 'Ingredientes', null, 'ingredients', '{}', 10),
    (v_profile.id, 'required_field', 'campo_modo_de_uso', 'Modo de uso', null, 'usage', '{}', 11),
    (v_profile.id, 'required_field', 'campo_advertencias', 'Advertencias', null, 'warnings', '{}', 12),
    (v_profile.id, 'required_field', 'campo_contenido_neto', 'Contenido neto', null, 'net_content', '{}', 13),
    (v_profile.id, 'store_legend', 'leyenda_tienda', 'Leyenda sanitaria de la tienda',
     'PENDIENTE DE REVISIÓN — Borrador para el asesor regulatorio: «Este producto no es un medicamento. '
       || 'El consumo de este producto es responsabilidad de quien lo recomienda y de quien lo usa.» '
       || 'Confirma con tu asesor el texto exacto que corresponde a tus productos, ajústalo y quita esta nota '
       || 'antes de aprobarlo.',
     null, '{product_page,cart,checkout}', 20),
    (v_profile.id, 'forbidden_term', 'termino_curar', 'Promesa de curar', 'curar', null, '{}', 30),
    (v_profile.id, 'forbidden_term', 'termino_cura', 'Promesa de curar', 'cura', null, '{}', 31),
    (v_profile.id, 'forbidden_term', 'termino_curativo', 'Promesa de curar', 'curativo', null, '{}', 32),
    (v_profile.id, 'forbidden_term', 'termino_curativa', 'Promesa de curar', 'curativa', null, '{}', 33),
    (v_profile.id, 'forbidden_term', 'termino_tratar', 'Promesa de tratar', 'tratar', null, '{}', 34),
    (v_profile.id, 'forbidden_term', 'termino_prevenir', 'Promesa de prevenir', 'prevenir', null, '{}', 36),
    (v_profile.id, 'forbidden_term', 'termino_previene', 'Promesa de prevenir', 'previene', null, '{}', 37),
    (v_profile.id, 'forbidden_term', 'termino_prevencion', 'Promesa de prevenir', 'prevención', null, '{}', 38),
    (v_profile.id, 'forbidden_term', 'termino_milagro', 'Efecto milagroso', 'milagro', null, '{}', 41),
    (v_profile.id, 'forbidden_term', 'termino_milagroso', 'Efecto milagroso', 'milagroso', null, '{}', 42),
    (v_profile.id, 'forbidden_term', 'termino_milagrosa', 'Efecto milagroso', 'milagrosa', null, '{}', 43),
    (v_profile.id, 'forbidden_term', 'termino_garantizados', 'Resultados garantizados',
     'resultados garantizados', null, '{}', 44),
    (v_profile.id, 'forbidden_term', 'termino_sin_efectos', 'Sin efectos secundarios',
     'sin efectos secundarios', null, '{}', 45)
  on conflict (profile_id, key) do nothing;

  update public.compliance_profiles
     set status = 'pending', reviewed_by = null, reviewed_at = null, version = version + 1,
         review_notes = 'Reglas propuestas — PENDIENTE DE REVISIÓN del asesor regulatorio. '
                        || 'Ninguna regla de esta versión ha sido validada por un profesional.'
   where id = v_profile.id;

  if v_profile.status = 'active' then
    perform app.enqueue_compliance_recheck(v_profile.id, null,
      'compliance.recheck:' || v_profile.id::text || ':v' || (v_profile.version + 1));
  end if;
end
$$;
