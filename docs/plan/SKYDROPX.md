# Guías con Skydropx (ADR-057, aprobado 2026-11-04)

## Lo que dice la documentación oficial (`pro.skydropx.com/es-MX/api-docs`, leída el 2026-11-04)

- **Credenciales:** cada cuenta tiene Client ID y Client Secret en Conexiones → API, en sandbox y en producción.
- **Token:** `POST /api/v1/oauth/token` con `grant_type=client_credentials` (form-urlencoded). Dura 2 horas.
- **Límite:** 2 solicitudes por segundo.
- **Host:** la página dice «usa el host correcto: `api-pro.skydropx.com`», pero los ejemplos usan `pro.skydropx.com`. El host de sandbox no aparece en la página oficial; una copia de terceros dice `sb-pro.skydropx.com` [NO VERIFICADO].
- **Cotizar:** `POST /api/v1/quotations`.
  - Lleva `address_from` y `address_to` con `country_code`, `postal_code`, `area_level1` (estado), `area_level2` (municipio) y `area_level3` (colonia), más los paquetes (medidas y peso) y, opcional, `requested_carriers`.
  - La respuesta trae solo el `id`.
- **Tarifas:** `GET /api/v1/quotations/{id}`, repetida hasta `is_completed: true`.
  - Cada tarifa trae `id`, `success`, `provider_name`, `provider_display_name`, `provider_service_name`, `currency_code`, `total` y `days`.
  - Las tarifas valen 24 horas.
- **Comprar la guía:** `POST /api/v1/shipments` con `rate_id` y los códigos de Carta Porte (`consignment_note`, `package_type`) cuando aplican. Se descuenta del saldo de la cuenta.
- **Rastreo:** `POST /api/v1/shipments/tracking`. No encontré webhooks en la documentación leída [NO VERIFICADO].

## Lo que no puedo verificar desde aquí

- La red de este entorno bloquea los dominios de Skydropx.
- Sin una cuenta de sandbox no puedo probar contra el servicio real.
- La página se corta antes del detalle de `POST /api/v1/shipments`: el cuerpo exacto del envío queda [NO VERIFICADO] hasta probar en sandbox.

## Etapas (cada una con pruebas, interruptor `shipping_labels` apagado y commit propio)

1. **Conectar la cuenta.** En Ajustes → Envíos, la tienda guarda su Client ID y Client Secret. Se cifran con `PAYMENT_CREDENTIALS_KEY`, como las llaves de Mercado Pago, y se comprueban pidiendo un token.
2. **Cotizar desde el pedido.** El botón «Cotizar guía» muestra las tarifas con paquetería, servicio, días y precio.
   - Origen: la dirección de la tienda.
   - Destino: la del pedido.
   - Paquete: peso de las variantes y medidas por defecto de la tienda.
3. **Comprar la guía.** Fuera de transacción, con clave de idempotencia por envío. Se guardan el número de guía, la paquetería y la etiqueta PDF, se registra el envío y sale el correo «va en camino» actual.
4. **Rastreo.** Un trabajo periódico consulta `shipments/tracking` y marca «entregado».

## Lo que necesito del propietario

- Cuenta de Skydropx con **sandbox**, y su Client ID y Client Secret de sandbox como secretos del entorno de esta sesión. Nunca en el chat.
- En el entorno de la sesión: permitir los dominios de Skydropx (`pro.skydropx.com`, `api-pro.skydropx.com` y el de sandbox).
- Dirección de origen de `demo2` (bodega): calle, colonia, municipio, estado y CP.
- Medidas típicas del paquete (largo × ancho × alto en cm).
