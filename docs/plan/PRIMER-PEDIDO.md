# `demo2`: lista para el primer pedido real (2026-11-04)

La tienda `demo` no se tocó.

## 1. Compra completa de prueba

- **El preview de Vercel no se pudo abrir desde aquí [NO VERIFICADO]:** la red de este entorno bloquea `vercel.app`.
- **Se hizo en local [VERIFICADO]:**
  - con el código de `mejoras/2026-11` y la misma configuración de `demo2` que staging (`pnpm demo:seed:neutral`);
  - con el pago de prueba `fake`, porque no hay credenciales de Mercado Pago (bloqueo B4).
- **Cómo repetirlo:** `pnpm exec playwright test -c playwright.visual.config.ts tests/visual/primer-pedido.spec.ts`.
- **Evidencia:** capturas y `registro.txt` en `docs/audit/primer-pedido/`.

| Paso                      | Resultado                                                                     | Captura                      |
| ------------------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| Elegir producto           | Ficha con «Agregar al carrito»                                                | `01-producto.png`            |
| Carrito                   | Producto y total                                                              | `02-carrito.png`             |
| Datos del cliente y envío | Teléfono `222.123.4567` aceptado; «Envío estándar» elegido; total $348.00     | `03-checkout.png`            |
| Pago de prueba            | Pantalla del proveedor simulado                                               | `04-pago-de-prueba.png`      |
| Regreso a la tienda       | «Gracias por tu compra», pedido pagado                                        | `05-regreso-a-la-tienda.png` |
| Correo de confirmación    | «Confirmamos tu pedido #…», 1 envío, con número, productos, total y dirección | `06-correo-confirmacion.png` |

## 2. Panel [VERIFICADO]

| Pregunta                                                     | Respuesta                                                                            | Captura                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| ¿Aparece el pedido con estado, dirección, productos y total? | Sí                                                                                   | `11-panel-pedidos.png`, `12-panel-detalle.png`      |
| ¿Puedo marcar «enviado» con número de guía?                  | Sí: «Registrar envío» con paquetería, número de guía y enlace de rastreo             | `13-panel-enviado.png`                              |
| ¿El cliente recibe un correo de envío?                       | Sí: «Tu pedido #… va en camino», con la guía                                         | `14-correo-envio.png`                               |
| ¿Puedo ver los pendientes de pago y cancelarlos?             | Sí: Pedidos → «Pendientes de pago» → pedido → «Cancelar el pedido» (libera el stock) | `15-panel-pendientes.png`, `16-panel-cancelado.png` |

No faltaba nada. Detalle menor sin cambio: el panel muestra «Envío Envío estándar» cuando la tarifa ya empieza con «Envío».

## 3. Celular (375 px)

- **Revisadas 10 pantallas:**
  - tienda: catálogo, ficha, carrito, checkout, pago y gracias;
  - panel: inicio, pedidos, detalle y pendientes.
- **Ninguna tiene desplazamiento horizontal ni elementos cortados [VERIFICADO]** (`registro.txt`).
- **Faltaba [VERIFICADO]:** varios campos medían 14 px, y el iPhone acerca la página al tocar un campo de menos de 16 px. Pasaba en:
  - el checkout: correo, nombre, teléfono, dirección y nota;
  - el carrito: cantidad y código de descuento;
  - los filtros del catálogo;
  - los formularios del detalle del pedido en el panel.
- **Arreglo:** interruptor por tienda `mobile_input_size`, apagado por defecto (migración `20261104000200`). Con él, todos los campos miden 16 px en el celular, en la tienda y en el panel. En la computadora no cambia nada. La prueba E2E es `tests/e2e/mobile-inputs.spec.ts`.
- **Capturas:** `17` a `20` (celular), tomadas con el interruptor encendido en local.

## 4. Antes de cobrar al primer cliente real (por riesgo)

| #   | Riesgo                                                                                                                                                                                                                                                                                                                                             | Quién                        | Tiempo estimado            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------- |
| 1   | **La dueña de `org-demo2` es la cuenta bloqueada del incidente.** Nadie legítimo puede conectar Mercado Pago ni operar la tienda                                                                                                                                                                                                                   | Tú decides; yo lo ejecuto    | 10 min tuyos + 20 min míos |
| 2   | **El mantenimiento automático nunca ha corrido en staging** [VERIFICADO: 0 trabajos `orders.expire` o `payments.reconcile`]. Los pendientes no vencen, no se libera stock y no hay conciliación si se pierde un webhook. `vercel.json` lo programa una vez al día. Hay que revisar `CRON_SECRET` en Vercel y que el plan permita el horario (N-4). | Tú (Vercel) y yo (verificar) | 20 min                     |
| 3   | **Mercado Pago:** credenciales, webhook y conectar la cuenta de `demo2`. Después, una compra real de prueba (`DIAGNOSTICO-MERCADOPAGO.md`)                                                                                                                                                                                                         | Tú y yo                      | 1–2 h                      |
| 4   | **Correo (Resend):** sin dominio verificado no sale la confirmación ni el aviso de envío (B3)                                                                                                                                                                                                                                                      | Tú                           | 30 min + hasta 24 h de DNS |
| 5   | **Suplementos:** las leyendas sanitarias de `demo2` son de ejemplo, y el perfil regulatorio de México bloquea la publicación hasta revisarlo (R0)                                                                                                                                                                                                  | Asesor regulatorio           | Días                       |
| 6   | **Políticas** (devoluciones, privacidad, términos): texto legal PENDIENTE DE REVISIÓN por abogado                                                                                                                                                                                                                                                  | Abogado                      | Días                       |
| 7   | **Respaldos:** staging en plan gratuito, sin respaldos automáticos (B6)                                                                                                                                                                                                                                                                            | Tú                           | 15 min (Supabase Pro)      |
| 8   | **Datos reales:** productos, precios, stock, tarifas de envío reales (hoy una sola, $99 o gratis desde $999) y recoger en tienda si aplica                                                                                                                                                                                                         | Tú                           | 1–3 h                      |
| 9   | **Aplicar en staging** las migraciones `20261104000100` y `20261104000200` y encender `checkout_shipping_messages` y `mobile_input_size` en `demo2`                                                                                                                                                                                                | Yo, con tu OK                | 15 min                     |
| 10  | **Correo «pendiente de pago»** para OXXO y transferencia (ADR-056)                                                                                                                                                                                                                                                                                 | Yo, con tu OK                | 2 h                        |
| 11  | **Repetir este recorrido en el preview real** (red de este entorno sin `vercel.app`)                                                                                                                                                                                                                                                               | Tú (o yo con la red abierta) | 20 min                     |

## 5. Operación diaria

Ver `docs/runbooks/pedidos.md`.

## Cómo revertir

- **Celular:** apagar `mobile_input_size` (o `kill_switch`), o `git revert` del commit del interruptor. La migración solo agrega el interruptor.
- **El recorrido de prueba** no cambia nada fuera de la base local.
