# Misión panel — Fase 3: operación diaria

Fecha de cierre: 2026-10-20. Commit principal `e7095f4` (más las correcciones de la revisión). Sin publicar en staging.

## Qué se hizo

| Pedido de la misión             | Resultado                                                                                                                                                            | Decisión |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Inicio con lo de hoy primero    | Línea de estado discreta; si la tienda no está publicada, aviso con los pasos que faltan; acciones rápidas según permisos; «Estado del sistema» arriba solo si falla | D-F3-01  |
| Pedidos: filtros y masivas      | Filtros existentes («Por surtir», etc.); en «Por surtir» se eligen varios y se surten de una vez, con confirmación y clave por pedido (hasta 50)                     | D-F3-02  |
| Inventario                      | Ya tenía filtros de existencias bajas y ajuste rápido; no se duplicó. Lotes y caducidad no existen en el esquema y no se crean                                       | —        |
| Búsqueda global                 | Productos, pedidos y clientes desde cualquier pantalla («/» la enfoca); por POST para que un email no quede en la URL                                                | D-F3-03  |
| Notificaciones dentro del panel | Botón «Avisos» con lo que requiere acción, cargado después de la página                                                                                              | D-F3-04  |
| Accesibilidad de la cabecera    | `<main>` en el panel (axe lo marcaba en 126 pantallas); «Contraseña» y «Salir» de 44 px                                                                              | D-F3-05  |

**Clics por tarea (antes → después):**

- Surtir 5 pedidos locales: 5 × (abrir pedido → Surtir → confirmar) = 15 → 3 (elegir todos → Surtir los elegidos → Sí, surtir 5).
- Encontrar un pedido por número desde otra pantalla: 2 → 1 (escribir en el buscador y elegir).

## Pruebas al cierre

- `pnpm verify` en verde (681 unitarias).
- `pnpm db:test` en verde: pgTAP 2047 en 82 archivos e integración 255.
- E2E completo sobre el build de la Fase 3: **70 de 70 en verde** (11.2 min).
- E2E nuevos o ampliados:
  - `order-ops`: surtir varios pedidos.
  - `dashboard`: «Avisos».
  - `onboarding`: el aviso del Inicio.
  - `panel-smoke`: búsqueda global y Dominio.
- Las correcciones de la revisión solo cambian textos y un localizador. `checkout.spec` pasó con el localizador anterior; el exacto se comprueba en la primera corrida de la Fase 4.

## Revisión adversarial

Hecha a mano sobre el diff de la fase:

- **Permisos.** `bulkFulfillOrders` exige `orders.fulfill` en el servidor y `orders_fulfill` lo vuelve a exigir en la base. La búsqueda de clientes solo corre con `customers.pii.read`. Los avisos usan lecturas con RLS.
- **Idempotencia.** Cada pedido usa la clave `${clave del clic}_${pedido}` (16–100 caracteres); repetir el clic no surte dos veces. Tras un éxito el cliente genera una clave nueva.
- **Hallazgo corregido: texto engañoso.** La confirmación y el mensaje final decían que se avisaba a cada cliente. El aviso solo sale si el correo de la tienda está configurado. Ahora la confirmación lo dice así y el resultado solo cuenta los pedidos surtidos.
- **Hallazgo corregido: prueba ambigua.** La acción rápida «Pedidos por surtir» del Inicio coincidía con el enlace «Pedidos» del menú en `checkout.spec`; el localizador ahora es exacto.
- **Sin cambios de esquema.** La fase no tocó migraciones, RLS ni RPC.
