# Lo que solo el propietario puede hacer (2026-11-04)

En orden. Cada paso se hace desde el celular. Nunca pegues claves en el chat: van en el menú de secretos de Vercel o en el entorno de la sesión.

## A. Seguridad (10 min)

1. **Gmail de `almanzaangel164`:** cambia la contraseña. En «Seguridad → Tus dispositivos», cierra los equipos que no conozcas.
2. **Dime si quieres de vuelta el rol de plataforma** para esa cuenta. Sin él, nadie revisa el cumplimiento sanitario ni administra tiendas.

## B. Que el sistema corra solo (20 min)

> **Comprobado el 2026-11-05 en staging [VERIFICADO]:** la cola de trabajos no avanza. Hay una foto (`media.process`) esperando desde el 2026-11-04 a las 16:42 UTC, y la salud marca `queue_stalled`. No lo causó ninguna migración: falta que el cron o la versión desplegada procesen la cola. Los puntos 3 y 4 lo resuelven.

3. **Vercel → proyecto → Settings → Environment Variables:** confirma que existe `CRON_SECRET` (32 o más caracteres) en Production.
4. **Vercel → Settings → Cron Jobs:** confirma que `/api/jobs/run` aparece activo. Dime tu plan, Hobby o Pro:
   - **Hobby:** el cron corre una vez al día. Desde D-MEJ-06 el mantenimiento también avanza con la actividad de la tienda.
   - **Pro:** lo pongo cada minuto.

## C. Cobrar (1–2 h) — detalle en `DIAGNOSTICO-MERCADOPAGO.md`

5. **Mercado Pago Developers:** crea la aplicación y copia sus credenciales de prueba y de producción.
6. **En la aplicación:** registra el webhook `https://<tu dominio>/api/webhooks/payments/mercadopago` (evento «Pagos») y la redirección `https://<tu dominio>/api/payments/mercadopago/callback`.
7. **Vercel:** pon `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET` y `PAYMENT_CREDENTIALS_KEY`: las de prueba en Preview y las reales en Production.
8. **Panel de `demo2` → Ajustes → Pagos → «Conectar Mercado Pago».**

## D. Correos (30 min + DNS)

9. **Resend:** agrega tu dominio, copia los registros SPF, DKIM y DMARC a tu DNS y crea la API key.
10. **Vercel:** `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` («Tu tienda <pedidos@tudominio.mx>») y, opcional, `RESEND_WEBHOOK_SECRET`.

## E. Aprobar (responde con los números)

- **ADR-063, Apariencia avanzada:** aprobado el 2026-11-05; la fase B-1 (Personalidad) está hecha. Para que una tienda la use, enciende «Personalidad del diseño» en Ajustes → Funciones de esa tienda. Antes de desplegar, aplicar en staging la migración `20261105001000` (con tu aprobación).
- **ADR-062, enlace de pedido de invitado:** ¿A (180 días desde la última actividad, con «Mandarme un enlace nuevo») o B (90 días fijos)? Recomiendo A.
- **`pg_net` fuera de `public` (paso 23):** el aviso de Supabase pide moverla al esquema `extensions`. Hacerlo en staging toca una extensión de la base y no encontré en la documentación oficial cómo moverla sin reinstalarla [NO VERIFICADO]; la uso para comprobar cada migración de staging. Respóndeme «sí pg_net» y lo preparo con su plan de reversa antes de tocar nada.

11. **Aplicar en staging** las migraciones `20261104000100` y `20261104000200`, y encender en `demo2` `checkout_shipping_messages` y `mobile_input_size`.
12. **ADR-056:** correo «pendiente de pago» para OXXO y transferencia.
13. **ADR-053:** lista de categorías bloqueadas (vapes, THC y las demás). Así no se pueden volver a publicar.
14. **ADR-057:** guías automáticas. ¿Skydropx o Envia.com?
15. **ADR-058:** facturación CFDI. ¿Facturapi o Facturama?
16. **ADR-051, ADR-052, ADR-054, ADR-055:** respaldo de Mercado Pago, fraude, datos enmascarados y borrado de compradores.

## F. Antes del primer cliente real (días, con terceros)

17. **Asesor regulatorio:** leyendas sanitarias reales de los suplementos (R0).
18. **Abogado:** revisión de los textos legales: devoluciones, privacidad y términos (hoy dicen PENDIENTE DE REVISIÓN).
19. **Supabase:** pasar a Pro y activar PITR para tener respaldos (B6).
20. **Productos, precios, stock y tarifas de envío reales** en `demo2`.
21. **Una compra real pequeña** con tu tarjeta en `demo2`, y reembolsarla desde el panel (`docs/runbooks/pedidos.md`).

## G. Opcional, para que yo pruebe más desde aquí

22. **En el entorno de esta sesión** (menú del título → Edit → Network access), permite `api.mercadopago.com`, `www.mercadopago.com.mx` y `*.vercel.app`. Guarda el token de prueba de Mercado Pago como secreto del entorno. Toma efecto en una sesión nueva.
