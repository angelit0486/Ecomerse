# Gate F4 — Informe de cierre: Fase 4 (Inventory)

> Contrato: GATE0 §38 (PHASE 4), §15, §44.9-10. Decisiones: `docs/DECISIONS.md` D-F4-01 … D-F4-04.
> Rama `claude/ecommerce-regulated-platform-41vu1e`, commits `8f79682` … (ver `git log 2ce4fb7..HEAD`).
> **Push bloqueado (P0):** GitHub devuelve 403. El CI no ha corrido; todos los resultados son locales. Respaldo: `pruva-f4.bundle`.

## 1. Cambios realizados

| Área                    | Resultado                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tablas (F4-T01)         | Ubicación por defecto por tienda (backfill + trigger), un nivel por variante que nace en 0 (backfill + trigger), ledger append-only con la dirección de los deltas validada por tipo, reservas e items. |
| Mutación única (F4-T02) | `app.apply_inventory_movement`: UPDATE condicional atómico + fila del ledger, idempotente; ningún otro camino cambia `on_hand`/`reserved` (trigger, no solo grants).                                    |
| Ajustes (F4-T02)        | `inventory_adjust` (sumar/restar o fijar la cantidad contada; daño y pérdida restan), motivo obligatorio, auditado; `inventory_set_threshold`.                                                          |
| Reservas (F4-T02)       | Funciones internas para las Fases 6-7: reservar (atómico, en orden de `level_id`), confirmar, liberar/expirar y enviar (idempotente por envío); variantes sin seguimiento excluidas.                    |
| UI (F4-T03)             | Inventario con búsqueda y filtro de stock bajo, ajuste con motivo, aviso de stock bajo, historial inmutable por variante.                                                                               |
| Gate                    | Correcciones de la revisión (§6).                                                                                                                                                                       |

## 2. Migraciones

`20261011000100` tablas · `…000200` movimientos, ajustes y reservas · `…000300` búsqueda del panel · `…000400` correcciones del gate. Forward-only, probadas desde cero.

## 3. Pruebas y resultados (locales, 2026-10-06)

| Suite                                             | Resultado |
| ------------------------------------------------- | --------- |
| `pnpm verify` (lint, formato, tipos, unit, build) | ✅ 257    |
| `pnpm db:test` — pgTAP (23 archivos)              | ✅ 730    |
| `pnpm db:test` — integración                      | ✅ 36     |
| `pnpm test:stack`                                 | ✅ 27     |
| `pnpm test:e2e` (con axe)                         | ✅ 13     |

**Concurrencia** (PostgreSQL real, una conexión y una transacción por comprador): 20 compradores por 1 unidad → exactamente 1 reserva (las 19 restantes `insufficient_stock` y revertidas por completo); 5 unidades → exactamente 5; 40 pedidos `[A, B]` y `[B, A]` simultáneos → sin deadlocks; 10 llamadas con la misma clave → un movimiento; ledger cuadrado tras la carga. **Mutación:** sin la condición de disponibilidad del UPDATE, las pruebas del último SKU fallan.

## 4. Criterios de aceptación (GATE0 §38, PHASE 4)

| Criterio                             | Estado                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| Nunca hay stock negativo bajo carga  | ✅ concurrencia + CHECK + guarda; `deny` nunca deja disponible negativo     |
| Cada cambio tiene su movimiento      | ✅ `system.inventory_ledger_mismatches()` vacío en pgTAP, integración y E2E |
| Concurrencia del último SKU (N = 20) | ✅                                                                          |
| Deadlock multilínea                  | ✅                                                                          |
| Idempotencia                         | ✅ secuencial y concurrente                                                 |
| `continue` frente a `deny`           | ✅ pgTAP                                                                    |
| Ledger inmutable; `inventory.adjust` | ✅ pgTAP (UPDATE/DELETE rechazados; permisos, 2FA, tenants)                 |

## 5. Revisión del gate

Revisión adversarial (seguridad y corrección): **sin fugas entre tiendas ni vías para mover existencias fuera de la función única** (se probó el intento de activar la marca de la guarda desde una sesión de usuario: sin grant de UPDATE no sirve). Corregido:

1. Medio: borrar un usuario de Auth que había movido inventario fallaba (la FK `on delete set null` chocaba con el ledger append-only) → sin FK, como `audit.audit_logs`.
2. Medio: una tienda o variante con movimientos ya no se podía purgar (CF-06) → el ledger sigue sin UPDATE y solo admite DELETE dentro de una purga controlada (marca local de la transacción).
3. Bajo/medio: con `deny`, un ajuste podía dejar lo disponible negativo (fijar por debajo de lo reservado) → ningún movimiento que reduzca lo disponible lo deja negativo.
4. Bajo: repetir un ajuste «fijar» con la misma clave daba error en vez de devolver lo aplicado.
5. Bajo: en la carrera con la misma clave no se comparaban los datos y se auditaba dos veces.
6. Bajo: items sin cantidad en reservas y envíos daban un error crudo o engañoso.
7. Bajo: historial sin aviso de truncado, umbral sin auditoría, `\` sin escapar en la búsqueda.

## 6. Riesgos

- `order_id` de las reservas sin FK hasta la Fase 6 (D-F4-01): las funciones de reserva no son invocables por ningún rol de aplicación mientras tanto.
- Purga de tiendas y variantes: el mecanismo existe; el job de purga (CF-06) llega con el cierre de tiendas.

## 7. Pendientes

- Alerta de stock bajo por email (Fase 7); hoy se marca en la tabla y se filtra.
- Multi-almacén en la UI, órdenes de compra y transferencias: fuera del MVP (§15.6).
- Owner: acceso de escritura a GitHub (P0), proyectos Supabase y Vercel.

## 8. Definition of Done

- [x] Suite completa en verde (local), concurrencia incluida.
- [x] Migraciones forward-only probadas desde cero.
- [x] Decisiones registradas (D-F4-01 … D-F4-04).
- [ ] CI de GitHub (bloqueado por P0).
