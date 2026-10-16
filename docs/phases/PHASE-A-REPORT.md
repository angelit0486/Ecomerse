# Fase A (lanzamiento) — Cumplimiento real configurable · Informe del gate

Fecha: 2026-10-16 · Rama `claude/ecommerce-regulated-platform-41vu1e` · Decisiones D-A-01 a D-A-04 (`docs/DECISIONS.md` §14).

## 1. Auditoría previa (vista previa `pruva-staging`)

- 68 migraciones, 100 tablas, RLS + FORCE RLS en todas; 64 políticas, ninguna `USING (true)`.
- `anon` sin privilegios de tabla propios; `storefront_gateway` y `system_worker` sin grants de tabla; toda función `SECURITY DEFINER` con `search_path`.
- Advisors de seguridad: `pg_net` en `public` (WARN), protección de contraseñas filtradas apagada (WARN, interruptor del panel de Supabase), funciones `SECURITY DEFINER` ejecutables por `authenticated` (por diseño: RPC con permisos internos).
- Advisors de rendimiento: FKs sin índice e índices sin uso (INFO), sin PK en `system.auth_login_intents`, políticas permisivas múltiples en `customers` (WARN). Se atienden con tráfico real.
- **Crítico (corregido):** el perfil sanitario de México estaba `active` con revisor «Demostración (sin revisión real)» y reglas de ejemplo (`demo_*`). La siembra de la vista previa lo reactivaba.

## 2. Qué se construyó

| Pieza                                                                                                                                                           | Dónde                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Campo «Contenido neto» (`net_content`, 100 caracteres) en la ficha, el formulario, la tienda pública y el CSV (`regulatory_net_content`)                        | `20261018000100`, `regulatory.ts`, `regulatory-form.tsx`, `supplement-info.tsx`, `imports/products.ts` |
| Regla `store_legend`: la categoría exige una leyenda que redacta y aprueba la tienda, en ficha, carrito y checkout                                              | `20261018000100`                                                                                       |
| `store_compliance_legends`: borrador y texto aprobado aparte; aprobar exige el nombre de quien revisó y rechaza «PENDIENTE DE REVISIÓN»                         | `20261018000100`                                                                                       |
| Validador: `compliance_store_legend_pending`; `compliance_store_report` lista lo que no se puede publicar y por qué                                             | `20261018000100`, Ajustes → Cumplimiento                                                               |
| Reglas propuestas para México (PENDIENTE DE REVISIÓN): 4 campos, leyenda de la tienda, 13 términos prohibidos; `demo_*` retiradas; perfil `pending` sin revisor | `20261018000200`                                                                                       |
| Consola: tipo «Leyenda de la tienda» (borrador sugerido opcional)                                                                                               | `/platform/cumplimiento`                                                                               |
| Siembra de la vista previa sin cambios de cumplimiento (Edge Function v3)                                                                                       | `seed-core.mjs`, runbook §7                                                                            |

Borrador de leyenda propuesto (nunca se publica tal cual): «PENDIENTE DE REVISIÓN — Borrador para el asesor regulatorio: “Este producto no es un medicamento. El consumo de este producto es responsabilidad de quien lo recomienda y de quien lo usa.” Confirma con tu asesor el texto exacto…». No es texto legal definitivo.

## 3. Verificación

| Prueba                                                     | Resultado                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (lint, formato, tipos, unit, build)          | ✅ 542 unit                                                                                                                                                          |
| pgTAP (`pnpm db:test`)                                     | ✅ 1651 (nuevo `59_compliance_store_legend`: 38)                                                                                                                     |
| Integración                                                | ✅ 233                                                                                                                                                               |
| E2E (Playwright)                                           | ✅ 49/49 + `compliance` 6/6 (nuevo: borrador sugerido no se aprueba; aprobada se publica y desbloquea)                                                               |
| Vista previa: migraciones 0100 y 0200                      | ✅ aplicadas con sha256 verificado                                                                                                                                   |
| Vista previa: RLS con roles distintos                      | ✅ usuario ajeno: `forbidden` al leer el validador y al guardar la leyenda, 0 filas en `store_compliance_legends`; dueña de `demo`: lee su validador y no ve `demo2` |
| Vista previa: `anon` / `service_role` sobre la tabla nueva | ✅ sin privilegios; RPC no ejecutable por `anon`; `search_path=''`                                                                                                   |
| Vista previa: advisors                                     | ✅ sin categorías nuevas                                                                                                                                             |
| Vista previa: invariante «publicado ⇒ cumple»              | ✅ revisión ejecutada: 20 suplementos de demo y demo2 a borrador, 20 eventos de auditoría `product.unpublished` (motivo `compliance`)                                |

Las pruebas que borraban las reglas del perfil de México (integración y E2E) ahora las retiran y las restauran.

## 4. Riesgos abiertos

- Los términos prohibidos se buscan en todo el texto del producto, ficha incluida: una advertencia legítima con «tratar» o «prevenir» bloquea la publicación. Por eso se dejaron fuera «enfermedad» y «tratamiento»; el asesor debe revisar la lista.
- Lote y caducidad aún no se capturan (Fase C).
- El aviso o registro sanitario sigue opcional; se vuelve obligatorio con una regla desde la consola si el asesor lo indica.
- Las tiendas demo de la vista previa quedan sin productos publicados hasta que se aprueben las reglas y se completen sus fichas de ejemplo.
