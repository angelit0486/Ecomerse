# Liberar promociones automáticas y mayoreo (ADR-070, PR #37)

> **Nada de esto está aplicado.** El PR #37 es un borrador. Cada paso marcado 🔒 necesita la autorización escrita
> del propietario en la bitácora antes de hacerse. Diseño: `docs/plan/PROPUESTA-PROMOCIONES-MAYOREO.md`;
> decisión: ADR-070 en `docs/DECISIONS.md`.

## 1. Qué se libera (todo junto)

| Fase | Qué ve la gente                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 1    | El cobro aplica las promociones activas (en la base); el pedido guarda una copia de qué promoción dio cuánto. |
| 2    | Panel → «Promociones»: crear, editar, activar, pausar, archivar. «Se combina con promociones» en los cupones. |
| 3    | Tienda: insignias, recuadro en la ficha, ahorro en carrito, checkout, página del pedido y correos.            |
| 4    | Panel → «Promociones» → «Reporte» (Tienda Plus); en Tienda, una invitación a subir de plan.                   |

**No liberar el motor sin la tienda:** una promoción activa sin la fase 3 descontaría sin avisarle al comprador.
Las cuatro fases van en el mismo despliegue.

## 2. Autorizaciones (🔒, antes de empezar)

1. Aprobar el PR #37 para fusionarlo (después de las fases y su revisión).
2. Aplicar las 4 migraciones en staging y luego en producción, en la ventana (§4).
3. Capturar los valores de los planes en la consola (§3).
4. Desplegar el código (después de las migraciones).
5. Decisiones abiertas de ADR-070: reutilizar los permisos `discounts.read` / `discounts.manage` (o pedir
   `promotions.*`) y el gancho regulatorio (hoy documentado, no construido).

## 3. Valores de los planes (Consola → Planes → editar cada plan)

| Campo de la consola    | Tienda | Tienda Plus | Nota                                                                                       |
| ---------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------ |
| Promociones activas    | 5      | 1000        | Cuenta por organización al **activar**. Sin el valor (o en 0) no se puede activar ninguna. |
| Reporte de promociones | no     | sí          | Sin la función, «Reporte» muestra la invitación a Tienda Plus.                             |

- Se capturan **después** de la migración `20261125000100` (antes la consola no conoce las claves) y **antes** de
  avisar a las tiendas.
- Excepción para una sola organización: Consola → organización → «Excepciones» (`max_active_promotions` o
  `promotion_reports`, con motivo). No tocar las tiendas demo.

## 4. Migraciones (orden obligatorio; primero la base, después el código)

| #   | Archivo                                    | Qué hace                                                                                | sha256                                                             |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `20261125000100_promotions.sql`            | Tablas `promotions`, `promotion_targets`, `order_promotions`; columnas en pedidos; RPC. | `73d3b27687cc0e77508510a66de1d98c356d48537a4fedd69686d675e02f5fa1` |
| 2   | `20261125000200_promotion_engine.sql`      | Motor; `calculate_cart` y `place_order` con promociones (mismas firmas).                | `ac458640605201cf97ee20a4203e4cef08c872c8e7ff836c52e78e6a1f48f675` |
| 3   | `20261125000300_storefront_promotions.sql` | Lecturas de la tienda; página del pedido y correos con el ahorro. Solo funciones.       | `98abdf159c670fb66d1ea74b6a277b59e77af1422f3c25ff5212a9b4d0cea735` |
| 4   | `20261125000400_promotions_report.sql`     | `promotions_report` (solo lectura).                                                     | `d61de62acf1d0d22567045a3f628a4e839459e93cc0bc6dc230e826a422307b8` |

- **Staging:** guion por pasos `scripts/ops/promociones/staging-aplicar.sql` (editor SQL; comprobación previa, descarga con `pg_net` desde el commit fijo, sumas, las 4 en una transacción, verificación posterior y planes). Ensayado en local sobre una base en `20261119000100`: esquema final idéntico al de una base desde cero.
- Cada una en su transacción, con el procedimiento de `docs/runbooks/despliegue-migraciones-2026-11.md` §5 (sumas
  comparadas antes de ejecutar). Versión final: `public.app_schema_version() = '20261125000400'`.
- El código del PR exige `20261125000400`: con una base anterior el panel avisa «Faltan actualizaciones de la base de datos (migraciones)» y fallan las pantallas de promociones.
- La app anterior funciona con la base nueva (las firmas no cambian). Sin promociones activas, el cobro da
  lo mismo que antes (pgTAP 158 y las pruebas de checkout existentes).
- Ensayo local: `bash scripts/ops/migration-rehearsal.sh` aplica las 4 una por una con su suma, compara el esquema
  con una base desde cero y corre pgTAP. Reversas: `bash scripts/ops/reversa/comprobar-0400.sh`.

## 5. Verificación en staging (lista)

Con una tienda de prueba propia de staging (nunca una tienda demo), después de migrar y desplegar:

- [ ] `select public.app_schema_version()` = `20261125000400`; `scripts/ops/ventana/02-despues.sql` en verde.
- [ ] Consola: el plan Tienda tiene «Promociones activas» = 5 y «Reporte de promociones» = no; Plus, 1000 y sí.
- [ ] Panel → Promociones: el aviso dice «Promociones activas: 0 de 5 …».
- [ ] Crear «3×2» en un producto (queda en borrador) y activarlo; activar 5 más: la sexta se rechaza por el límite del plan.
- [ ] Mayoreo con 2 escalones y «la segunda al 50 %» en una categoría: la vista previa coincide con el ejemplo.
- [ ] Tienda: la tarjeta dice «Lleva 3, paga 2»; la ficha muestra el recuadro «Promoción» y los escalones.
- [ ] Carrito con 3 piezas: la línea dice «… : −$X» y el resumen «Promoción: …»; el total baja lo mismo.
- [ ] Cupón normal + promoción: el cupón no descuenta las piezas de la promoción; con «Se combina», sí.
- [ ] Checkout con transferencia: el pedido se crea; la página del pedido y el correo muestran el ahorro.
- [ ] Renombrar la promoción: el pedido y el correo siguen con la leyenda de su día.
- [ ] Pausar la promoción: en ≤ 60 s la tarjeta ya no la anuncia y el carrito ya no la aplica.
- [ ] Reporte: en Tienda, la invitación; con «Reporte de promociones» (excepción en la organización de prueba), el
      pedido pagado aparece con su ahorro.
- [ ] Nocturno: la tarjeta, la ficha y el carrito se leen bien (contraste) con el look Nocturno.
- [ ] Tienda B (otra organización) no ve las promociones ni el reporte de la tienda A.

## 6. Vuelta atrás

De lo más rápido a lo más profundo; parar en el primer paso que resuelva.

1. **Apagar sin desplegar nada:** pausar las promociones activas desde el panel (o la dueña). El cobro deja de
   aplicarlas al instante; la tienda deja de anunciarlas en ≤ 60 s (caché). Los pedidos ya hechos conservan su precio.
2. **Cortar para todos** 🔒: en la consola, «Promociones activas» = 0 en los planes impide activar nuevas; las que ya
   están activas se pausan con autorización (cambio de datos: `promotions.status = 'paused'`, con bitácora).
3. **Regresar el código** 🔒: desplegar el commit anterior. Funciona con la base nueva. Antes, pausar las promociones
   (paso 1): el código anterior no muestra el ahorro en la tienda aunque el cobro lo aplicaría.
4. **Reversa del esquema** 🔒 (solo si hace falta), de la más nueva a la más vieja, cada una sobre su versión:
   `20261125000400_promotions_report.reversa.sql` → `…000300_storefront_promotions` → `…000200_promotion_engine` →
   `…000100_promotions` (en `scripts/ops/reversa/`, `psql -X -1 -v ON_ERROR_STOP=1 -f …`). Las tres primeras son sin
   pérdida. La de `0100` **se rechaza** (sin cambiar nada) si ya hay promociones, pedidos con promoción o valores
   `max_active_promotions` / `promotion_reports` en planes o excepciones: primero se quitan los valores de la consola;
   si hay promociones o pedidos con promoción, se queda en `0200` con las promociones pausadas (borrarlas perdería
   historia de pedidos). Antes del paso 4, el código debe ser el del paso 3.
