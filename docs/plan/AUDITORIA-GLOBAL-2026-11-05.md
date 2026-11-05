# Auditoría global de la plataforma (2026-11-05)

**Objetivo:** que cada tienda quede satisfecha y pueda pasar más de un año sin problemas.

**Qué es este documento:** una auditoría de solo lectura, seguida de un plan paso a paso. No se cambió código ni base de datos para hacerla.

**La tienda `demo` (alien demon) se ignoró por completo:** no se consultó ni se midió. Los datos de staging que aparecen son totales de toda la base.

**Etiquetas:**

- **[VERIFICADO]**: comprobado hoy en el código, en la base o en una fuente oficial.
- **[INFERIDO]**: deducido del código; falta probarlo con el servicio real.
- **[NO VERIFICADO]**: requiere una cuenta o un servicio que no hay.

**Quién hace cada paso:** 🤖 yo, 🧑 tú, ⚖️ asesor o abogado, 🔌 un proveedor externo.

---

## 1. Veredicto

La base técnica es sólida. Pasa las pruebas completas (verify 1112, pgTAP 2690, integración 401 y E2E 133) y la medición de escala (una tienda confirma de 6 000 a 15 000 pedidos por minuto en la base).

Para **cobrar a un cliente real y no tener sorpresas durante un año** hay tres grupos de riesgo. Ninguno es de diseño: son cosas sin programar, sin conectar o sin decidir.

1. **Cobro:**
   - **OXXO y transferencia hoy no pueden funcionar de verdad.** El cobro vence en 8 a 118 minutos, y un pago en OXXO tarda horas o días (hallazgo A1).
   - Mercado Pago real nunca se ha probado.
2. **Continuidad:**
   - Las limpiezas de datos y las particiones de auditoría están escritas pero **nunca se programaron**.
   - No hay monitoreo de errores ni avisos al celular.
   - Staging no tiene respaldos.
   - **Nunca ha salido un correo** (0 en staging).
3. **Falta de oficio para la dueña:**
   - No hay devoluciones, correos editables, impresión de nota de empaque, ayuda dentro del panel ni resumen semanal.
   - Tampoco hay guías ni facturación (ADR-057 y ADR-058 ya aprobados, en curso).

---

## 2. Lo que ya está sólido (no tocar)

- **Aislamiento entre tiendas:**
  - RLS forzado en todas las tablas.
  - Metatests de seguridad genéricos.
  - Prueba de que una tienda no ve a otra, en cada migración.
- **Dinero:**
  - Precios y totales calculados en la base.
  - Webhook firmado, con nueva consulta, comparación de monto e idempotencia.
  - Sin doble cobro ni sobreventa [VERIFICADO con pruebas de integración y E2E contra Mercado Pago simulado].
- **Panel:**
  - 42 pantallas revisadas en celular y computadora: 0 errores de carga, 0 desbordes, 0 problemas serios de accesibilidad.
  - Pedidos con envío y guía, cancelar, reembolsar y filtros.
  - Importar y exportar CSV, acciones en lote en productos, equipo con permisos.
- **Personalización:**
  - 14 tipos de bloque de portada y 8 plantillas por giro.
  - Unas 10 familias tipográficas, historial de versiones del diseño y dominio propio.
  - Menús, páginas, redirecciones 301, SEO por producto y categoría.
  - JSON-LD, sitemap, robots y manifiesto de app.
- **Escala:** índices en pedidos, caché pública con etiquetas por tienda, conexiones por Supavisor.
- **Operación:** revisión de salud cada 15 minutos con correo, runbooks, simulacro de restauración local (8 s), Dependabot semanal, escaneo de secretos en CI.

---

## 3. Hallazgos

Cada hallazgo lleva: evidencia, qué pasa si no se atiende y a qué paso del plan corresponde.

### A. Cobro: lo que impide «pagable»

**A1. OXXO, SPEI y cajero vencen antes de que el cliente pueda pagar.** [VERIFICADO en el código]

- Al confirmar, el cobro vence en `reservation_ttl_minutes − 2 min`. Ese valor va de 10 a 120 minutos, con 30 por defecto (`place_order`).
- Ese vencimiento se manda a Mercado Pago como `expiration_date_to`.
- `delayedMethods` está declarado en el proveedor pero no se usa para el vencimiento.
- El cliente que elige OXXO recibe la referencia y, al ir a pagar horas después, el pago ya venció.
- Corrección a lo que reporté el 2026-11-04: la prueba de OXXO con el simulador solo verifica «pendiente y luego pagado», no el vencimiento.
- **Si no se atiende:** clientes enojados, pedidos cancelados y soporte saturado.
- **Plan:** paso 1.

**A2. Mercado Pago real nunca se ha probado.** [NO VERIFICADO]

- Falta la cuenta de la plataforma, las credenciales de prueba y las de producción.
- Además, desde este entorno no se llega a `api.mercadopago.com`.
- **Plan:** pasos 6 y 7.

**A3. Sin meses sin intereses.**

- Es la principal palanca de conversión de tickets altos en México.
- Mercado Pago lo ofrece sin cambio de código: se configura en la cuenta, y la preferencia puede limitar las cuotas.
- **Plan:** paso 26.

### B. Continuidad: lo que decide si pasa un año sin problemas

**B1. Mantenimiento de datos escrito pero nunca programado.** [VERIFICADO: 0 llamadas en `src/` y en las migraciones]

- `system.purge_finished_jobs` y `system.maintain_audit_partitions` existen y nadie las llama.
- La auditoría de octubre ya lo había marcado (CF-04) y sigue abierto.
- **Consecuencias:**
  - Las particiones de auditoría se crearon por 24 meses y llegan hasta **octubre de 2028**. Después, los registros caen en la partición «default».
  - Con filas ahí, crear la partición del mes nuevo falla.
  - `system.jobs` crece sin límite: cada pedido deja de 4 a 6 trabajos.
- **Plan:** paso 2.

**B2. Tablas que crecen sin ninguna limpieza.** [VERIFICADO: ningún `delete from`]

- Son `notification_deliveries`, `payment_events`, `import_job_rows`, `security_events` y `carts`.
- La mayor de staging ya es `import_job_rows`: 7.2 MB por 2 682 filas (unos 2.7 KB por fila), con los datos crudos de cada archivo importado.
- Guardar archivos crudos para siempre también va contra la minimización de datos de la LFPDPPP.
- **Plan:** paso 2.

**B3. Sin monitoreo de errores ni avisos al celular.** [VERIFICADO: 0 referencias a Sentry, PagerDuty, SMS o WhatsApp]

- La revisión de salud solo manda correo, y los correos aún no salen (B4).
- No hay monitor externo que llame a `/api/health/ready`.
- Hoy un fallo de pagos a las 2 a. m. no se entera nadie hasta que un cliente escribe.
- **Plan:** paso 4.

**B4. Nunca ha salido un correo.** [VERIFICADO en staging: 0 registros en `notification_deliveries`]

- Sin Resend no salen confirmaciones, avisos de envío, «pendiente de pago», alertas de salud ni códigos de acceso de compradores.
- **Plan:** paso 3.

**B5. Sin respaldos.** [VERIFICADO en el runbook y en el plan]

- Supabase Free no hace respaldos ni PITR, y los respaldos de la base no incluyen los archivos de Storage.
- Hay simulacro de restauración local, pero [NO VERIFICADO] en Supabase real.
- **Plan:** paso 5.

**B6. Nadie con rol de plataforma activo, y sin acceso de emergencia.** [VERIFICADO tras el incidente del 2026-11-03]

- Nadie puede revisar el cumplimiento sanitario, suspender o reactivar tiendas, ni dar soporte auditado.
- Un solo operador y sin segundo administrador (CF-08 de la auditoría de octubre).
- **Plan:** paso 8.

**B7. Node 22 deja de recibir parches de seguridad el 2027-04-30.** [VERIFICADO en `nodejs/Release` y endoflife.date, consultados hoy]

- El proyecto exige `node >=22.12 <23`.
- Hay que pasar a **Node 24** (parches hasta 2028-04-30) o a Node 26 (Active LTS, hasta 2029-04-30).
- Es una actualización mayor de entorno: requiere tu aprobación.
- **Plan:** paso 14.

**B8. Un solo entorno.** [VERIFICADO]

- Solo existe el proyecto `pruva-staging`: no hay Supabase ni Vercel de producción separados.
- Las migraciones se aplican a mano con sha256, porque falta `MIGRATION_DATABASE_URL` (bloqueo B1).
- **Plan:** paso 9.

**B9. El cron de Vercel es diario.** [VERIFICADO en `vercel.json`]

- El 2026-11-04 se mitigó (D-MEJ-06): el mantenimiento también avanza con la actividad de la tienda.
- Con poco tráfico (de noche), los pedidos sin pagar tardan en vencer.
- **Plan:** paso 9 (cron por minuto en el plan Pro).

**B10. Avisos de Supabase.** [VERIFICADO]

- `auth_leaked_password_protection` desactivada: es de nivel «advertencia», y requiere plan de pago.
- `pg_net` está en el esquema `public`.
- Hay 180 funciones `SECURITY DEFINER` ejecutables por `authenticated`: es el diseño de la regla 5, con guarda dentro de cada una, y los metatests lo cubren.
- Hay 54 llaves foráneas sin índice y 68 índices sin uso: nivel informativo.
- **No borrar los índices sin uso:** la base de staging casi no tiene tráfico, y eso los hace parecer sin uso.

### C. Seguridad y cumplimiento

**C1. Sin enlace al aviso de privacidad en el checkout.** [VERIFICADO: la captura del checkout solo muestra «© 2026 Tienda…» y el código de esa pantalla no menciona «privacidad»]

- El pie de la tienda sí enlaza las políticas, pero el checkout es donde se recogen los datos.
- **Plan:** paso 10.

**C2. Textos legales y sanitarios sin firma.**

- Términos, privacidad, devoluciones y leyendas sanitarias dicen PENDIENTE DE REVISIÓN.
- R0 (reglas de suplementos) sigue sin firma del asesor.
- **Plan:** paso 11.

**C3. Rotación de claves pendiente tras el incidente.**

- Claude, GitHub, contraseñas de la base y llave de servicio (Supabase) y secretos de Vercel.
- Quedó en espera de tu orden.
- **Plan:** paso 12.

**C4. Seguridad menor.** [INFERIDO]

- El enlace de pedido de invitado no tiene vigencia (SG-05).
- La CSP no tiene `report-to`, y HSTS con preload espera dominio propio (SG-09).
- **Plan:** paso 23.

**C5. Sin filtro de categorías prohibidas en toda la plataforma.**

- Rechazaste el ADR-053.
- El riesgo residual lo cubre la revisión humana al activar cada tienda (módulo de cumplimiento).
- Mientras no haya personal de plataforma activo (B6), esa revisión no ocurre.

### D. Administración: lo que hoy falta para que la dueña trabaje sin ayuda

**D1. Devoluciones y cambios: no existen.** [VERIFICADO]

- Solo hay estados de «devuelto» en el pedido y el texto de la política.
- Falta el flujo: el cliente la solicita, la tienda aprueba, recibe, reembolsa o cambia, y se repone el stock.

**D2. Correos al comprador no editables.**

- Las plantillas son fijas.
- La dueña no puede cambiar el texto, la firma, ni añadir un mensaje de marca.

**D3. Sin impresión.** [VERIFICADO: 0 referencias]

- Nota de empaque y de remisión, listas de surtido y etiquetas.
- Hoy la dueña copia a mano.

**D4. Sin ayuda dentro del panel.** [VERIFICADO: 0 referencias]

- No hay centro de ayuda, tutoriales ni tooltips.
- Quien se atora, escribe a soporte.

**D5. La dueña se entera solo por correo.**

- No hay aviso inmediato en el celular (push o WhatsApp).
- Tampoco resumen semanal con ventas, pendientes y alertas.

**D6. Reportes básicos.** [VERIFICADO]

- Ventas, pedidos, ticket promedio, productos más vendidos y stock bajo.
- Falta el embudo (visitas, carrito, checkout y pago) y la conversión.
- El margen es posible: la tabla de costos por variante ya existe.

**D7. Sin segmentación de clientes.**

- No hay etiquetas, segmentos ni notas por cliente.
- El consentimiento de marketing se guarda y se exporta, pero no hay envío de campañas.

**D8. Sin avisos de uso del plan.** [NO VERIFICADO si ya avisa al 80%]

- Revisar el aviso al acercarse a los límites de productos, personas y fotos, antes de que la dueña choque con el límite.

### E. Construcción y personalización de tienda

**E1. Pixeles y analítica de la tienda.** [VERIFICADO: 0 referencias a GA4, Meta Pixel o TikTok]

- Muy pedido por quien hace anuncios.
- La regla 13 prohíbe el JavaScript del comerciante.
- La salida correcta: que la tienda escriba solo el **ID** y la plataforma cargue sus scripts fijos, con consentimiento de cookies.
- Requiere ADR (CSP y privacidad).

**E2. Sin banner de cookies.** [VERIFICADO]

- Hoy solo hay cookies funcionales (carrito y sesión), así que no es obligatorio todavía.
- Pasa a serlo en cuanto haya pixeles.

**E3. Sin blog ni guías.**

- Es la mayor palanca de SEO de contenido para suplementos y moda.

**E4. Sin funciones de recompra.**

- Lista de deseos, «avísame cuando haya inventario» y recordatorio de recompra.
- Las porciones por variante ya existen, así que el recordatorio es viable.

**E5. Descuentos limitados.** [VERIFICADO]

- Solo hay porcentaje, monto fijo y envío gratis, por código.
- Faltan descuentos automáticos, escalonados, 2×1 y por producto o categoría.
- Toca el cálculo del carrito: requiere ADR.

**E6. Solo español y pesos.**

- Mercado Pago cobra en MXN, así que es coherente.
- Prioridad baja.

### F. Calidad y mantenimiento del código

**F1. Archivos enormes.** [VERIFICADO]

- `home-editor.tsx` tiene 2 759 líneas y `productos/actions.ts` tiene 1 327.
- Cualquier cambio ahí tiene alto riesgo de regresión.
- Dividirlos es refactor grande: requiere tu aprobación.

**F2. El CI no mide rendimiento ni capturas.** [VERIFICADO]

- No corre Lighthouse, comparación visual, cobertura ni carga.
- Un cambio podría volver lenta la tienda sin que nadie lo note.

**F3. Un aviso moderado de dependencias de desarrollo.** [VERIFICADO]

- `minimatch`, dentro de la cadena de lint; no llega al sitio.

**F4. Producción sin vulnerabilidades conocidas.** [VERIFICADO: `pnpm audit --prod`]

### G. Negocio (vender la plataforma)

- **Alta autoservicio:** no aprobada (E15). La tienda la crea la plataforma.
- **Cobro de suscripciones:** planes y ciclo completo con cobro manual.
- **Propiedad del código:** pendiente aclararla antes de vender (B5 del plan, data room).
- **Sin página de estado ni soporte:** no hay página pública de estado ni canal de soporte definido.

---

## 4. Plan paso a paso

**Reglas del plan:**

- Cada paso lleva «Hecho cuando…», un criterio que se puede comprobar.
- Todo cambio visible va detrás de un interruptor por tienda, apagado hasta probarlo.
- Cada migración lleva pgTAP, prueba de aislamiento entre tiendas y plan de reversa.
- Lo que toca cálculo de precios, pagos o contratos críticos va a ADR y espera tu aprobación.

### Fase 0: antes del primer cobro real (1 a 2 semanas)

**Paso 1. Medios diferidos (OXXO, transferencia, cajero).** 🤖 con decisión 🧑

- **Decisión que necesito (ADR-059):**
  - **A (recomendada para arrancar):** ofrecer solo tarjeta y saldo de Mercado Pago, excluyendo los medios diferidos en la preferencia.
  - **B:** ofrecerlos con vencimiento propio de 72 horas y reserva de stock extendida solo para esos intentos. Es más conversión, pero stock apartado por días.
- **Hecho cuando:**
  - existe una prueba E2E con el simulador que cubre el vencimiento: el cliente que paga en OXXO a las 24 horas no pierde su pedido (B), o no ve OXXO (A);
  - queda documentado en `docs/runbooks/pagos.md`.
- **Tiempo:** 0.5 día (A) o 2 días (B).

**Paso 2. Programar el mantenimiento de datos.** 🤖

- Hacer en una migración y un trabajo periódico:
  1. Llamar `maintain_audit_partitions` cada semana.
  2. Llamar `purge_finished_jobs`: borrar trabajos terminados de más de 30 días y fallidos de más de 90.
  3. Purgar las filas crudas de importación a los 30 días.
  4. Definir y aplicar la retención del resto (`notification_deliveries`, `payment_events`, `security_events`, carritos abandonados), con ADR-060.
- Nunca se borran pedidos, pagos, movimientos ni auditoría (regla 9).
- **Hecho cuando:**
  - pgTAP prueba cada purga;
  - una prueba de integración simula 36 meses de fechas y comprueba que nunca falla la creación de particiones;
  - la consola → Salud avisa si una purga no corrió en 8 días.
- **Tiempo:** 2 días.
- **Orden:** solo el mantenimiento de las particiones (que no borra nada) lo hago de inmediato. Todo lo que borra filas, incluso los trabajos terminados, espera tu aprobación del ADR-060.

**Paso 3. Correo (Resend).** 🧑 y yo verifico

- **Tú:**
  1. Crea la cuenta de Resend y agrega tu dominio.
  2. Copia a tu DNS los registros SPF, DKIM y DMARC.
  3. Crea la API key.
  4. Pon `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` y `EMAIL_FROM` en Vercel.
- **Yo:** pruebo un pedido de punta a punta y reviso entrega a Gmail y Outlook, y que no caiga en spam.
- **Hecho cuando:** staging registra correos enviados y llegan a la bandeja de entrada (no a spam) en Gmail y en Outlook.
- **Tiempo:** 30 min más hasta 24 h de DNS.

**Paso 4. Monitoreo y alertas.** 🧑 y 🤖

- **Tú:**
  1. Crea una cuenta de Sentry y pásame el DSN como secreto de entorno.
  2. Crea un monitor externo gratuito (UptimeRobot o equivalente) sobre `/api/health/ready`, con aviso al celular.
- **Yo:**
  1. Integro Sentry (`instrumentation.ts` y `onRequestError`), con redacción de datos personales.
  2. Configuro las alertas urgentes (cola atascada, pagos con error) para que lleguen a Sentry. Su app y la del monitor externo avisan al celular. El aviso propio por WhatsApp o SMS queda para el paso 33.
- **Hecho cuando:** provocas un error de prueba y llega el aviso al celular en menos de 5 minutos.
- **Nota:** Sentry es una dependencia nueva. Va con su justificación (regla 16).
- **Tiempo:** 1 día.

**Paso 5. Respaldos.** 🧑 y 🤖

- **Tú:** pasa Supabase a Pro y activa PITR.
- **Yo:**
  1. Documento y ensayo el simulacro de restauración en un proyecto aparte.
  2. Programo una copia semanal de los archivos de Storage fuera de Supabase. Para eso necesito una cuenta de almacenamiento tuya (por ejemplo Cloudflare R2), con su llave como secreto del entorno.
- **Hecho cuando:** se restaura un respaldo en un proyecto de prueba y la comprobación de integridad pasa (`restore-drill.sh`).
- **Tiempo:** 15 min tuyos y medio día míos.

**Paso 6. Mercado Pago de prueba.** 🧑 y 🤖

- **Tú:** crea la aplicación, copia las credenciales de prueba, registra el webhook y la redirección de OAuth, y pon las variables de Preview.
- **Yo:** pruebo la compra de punta a punta con tarjeta de prueba, y reembolso.
- **Prerrequisito:** que el entorno de esta sesión permita `api.mercadopago.com`.
- **Hecho cuando:** hay captura del pedido pagado por webhook real de prueba y de un reembolso.
- **Tiempo:** 1 a 2 h.

**Paso 7. Mercado Pago de producción.** 🧑

- Las credenciales reales en Production, conectar la cuenta de la tienda en Ajustes → Pagos y una compra real pequeña con reembolso.
- **Hecho cuando:** el primer pedido real queda pagado solo por webhook firmado.
- **Tiempo:** 1 h.

**Paso 8. Personal de plataforma y acceso de emergencia.** 🧑 decide, 🤖 ejecuta

- Decidir quién tiene rol de plataforma (tú) y un segundo administrador de confianza.
- Documentar el procedimiento si pierdes el celular o la app de dos pasos.
- **Hecho cuando:** hay 2 personas con rol activo, cada una con códigos de recuperación guardados fuera de línea.
- **Tiempo:** 1 h.

**Paso 9. Separar producción.** 🧑 y 🤖

- Crear el proyecto de Supabase de producción (Pro) y el entorno Production de Vercel.
- Poner `MIGRATION_DATABASE_URL` y subir el cron a cada minuto (plan Pro de Vercel).
- Así las migraciones se aplican solas, solo después del CI en verde.
- **Hecho cuando:** un cambio de prueba pasa de rama a producción sin pasos manuales y `/api/health/ready` responde en verde.
- **Tiempo:** medio día.

**Paso 10. Aviso de privacidad en el checkout.** 🤖

- Texto «Al confirmar aceptas… [Aviso de privacidad] [Términos]» con enlaces a las políticas ya publicadas, marcado PENDIENTE DE REVISIÓN.
- Detrás de un interruptor por tienda (apagado hasta aprobar el texto).
- **Hecho cuando:** E2E con axe en celular y computadora.
- **Tiempo:** 0.5 día.

**Paso 11. Revisión legal y sanitaria.** ⚖️

- Abogado: términos, privacidad, devoluciones y política de contenido.
- Asesor regulatorio: leyendas y reglas de suplementos (R0).
- **Hecho cuando:** los textos dejan de decir PENDIENTE DE REVISIÓN.
- **Tiempo:** días, con terceros.

**Paso 12. Rotación de claves.** 🧑 y 🤖

- Orden: tu cuenta de Claude, GitHub, contraseña de la base y llave de servicio, contraseñas de los roles de base, secretos de Vercel.
- Procedimiento en `docs/runbooks/rotacion-de-claves.md`.
- Espero tu orden explícita.
- **Hecho cuando:** cada clave vieja queda revocada y la app sigue sana (`/api/health/ready`).
- **Tiempo:** 1 a 2 h.

**Paso 13. Datos reales y compra real de punta a punta.** 🧑

- Productos con fotos reales, precios, stock, tarifas de envío, políticas publicadas.
- Compra real pequeña con tarjeta, y reembolso.
- **Hecho cuando:** la lista de verificación de lanzamiento (Etapa 7 del plan de lanzamiento) queda 100% marcada.

### Fase 1: primer mes (satisfacción y operación diaria)

**Paso 14. Node 24.** 🤖 con tu aprobación

- Subir `.nvmrc`, `engines` y el CI a Node 24; correr todas las suites.
- **Fecha límite:** 2027-03-31, un mes antes del fin de parches de Node 22.
- **Hecho cuando:** verify, db:test y E2E pasan en Node 24 y Vercel usa esa versión.
- **Tiempo:** 1 día.

**Paso 15. Guías con Skydropx (ADR-057, aprobado).** 🤖 y 🧑

- Falta tu cuenta de sandbox, los dominios permitidos en el entorno y la dirección de bodega.
- Etapas: conectar la cuenta, cotizar, comprar la guía con etiqueta PDF, y rastreo.
- **Tiempo:** 3 a 5 días con la cuenta.

**Paso 16. Facturación CFDI (ADR-058, aprobado).** 🤖 y 🧑

- Falta el proveedor (recomendado Facturapi), la cuenta de pruebas y el visto bueno de tu contador.
- **Tiempo:** 3 a 5 días.

**Paso 17. Correo «pendiente de pago».** 🤖

- Ya está en el código (ADR-056).
- Falta aplicarlo en staging y encender el interruptor (te lo pido con «aprobado staging»).

**Paso 18. Devoluciones y cambios.** 🤖 con ADR-061

- Flujo completo: el cliente solicita desde su pedido, la tienda aprueba, se registra la recepción y se reembolsa o se repone el stock.
- Con correos, plazo configurable por tienda y auditoría.
- **Hecho cuando:** E2E del flujo completo y pgTAP de aislamiento.
- **Tiempo:** 3 días.

**Paso 19. Resumen semanal y «Salud de tu tienda».** 🤖

- Correo cada lunes a la dueña: ventas, pedidos por surtir, stock bajo, carritos abandonados, pagos con problema.
- Pantalla continua: correo configurado, pagos activos, productos sin foto, políticas publicadas y aviso de uso del plan al 80%.
- **Hecho cuando:** E2E, y la dueña lo apaga desde Ajustes → Funciones.
- **Tiempo:** 2 días.

**Paso 20. Correos del comprador editables.** 🤖

- La dueña edita el texto de cada correo con variables fijas (número de pedido, nombre) y una vista previa.
- **Hecho cuando:** E2E, y el texto del comprador se escapa siempre (sin HTML libre).
- **Tiempo:** 2 días.

**Paso 21. Impresión.** 🤖

- Nota de empaque, lista de surtido e impresión en lote desde «Por surtir».
- **Tiempo:** 1 día.

**Paso 22. Ayuda dentro del panel.** 🤖

- Botón «Ayuda» en cada pantalla con 5 a 8 guías cortas y capturas, escritas en español de México.
- **Tiempo:** 2 días.

**Paso 23. Seguridad pendiente.** 🤖 y 🧑

- Vigencia del enlace de invitado.
- CSP con `report-to`.
- Protección contra contraseñas filtradas (con Pro, 🧑).
- Mover `pg_net` fuera de `public`.
- **Tiempo:** 1 día.

### Fase 2: meses 2 y 3 (crecer)

| #   | Qué                                                         | Quién   | Requiere                             | Esfuerzo |
| --- | ----------------------------------------------------------- | ------- | ------------------------------------ | -------- |
| 24  | Embudo propio (vista, carrito, checkout, pago) y conversión | 🤖      | Interruptor, sin cookies de terceros | 3 días   |
| 25  | Pixeles por ID (GA4, Meta, TikTok) y banner de cookies      | 🤖      | ADR (CSP y privacidad)               | 3 días   |
| 26  | Meses sin intereses por tienda                              | 🤖 y 🧑 | Cuenta de Mercado Pago               | 1 día    |
| 27  | Descuentos automáticos, escalonados y 2×1                   | 🤖      | ADR (cálculo del carrito)            | 5 días   |
| 28  | «Avísame cuando haya inventario» y lista de deseos          | 🤖      | Interruptor                          | 3 días   |
| 29  | Recordatorio de recompra con las porciones                  | 🤖      | Consentimiento de marketing          | 2 días   |
| 30  | Blog y guías para SEO                                       | 🤖      | Interruptor                          | 4 días   |
| 31  | Reportes con margen y exportación                           | 🤖      | Costos por variante                  | 3 días   |
| 32  | Etiquetas, notas y segmentos de clientes                    | 🤖      | Interruptor                          | 3 días   |

### Fase 3: meses 4 a 12 (consolidar)

| #   | Qué                                                           | Quién   | Requiere                        |
| --- | ------------------------------------------------------------- | ------- | ------------------------------- |
| 33  | Estado de pedido por WhatsApp                                 | 🤖 y 🔌 | Cuenta de WhatsApp Business     |
| 34  | Campañas por correo con consentimiento y baja                 | 🤖      | ADR (marketing)                 |
| 35  | Lighthouse, cobertura y carga en el CI como presupuesto       | 🤖      | Ninguno                         |
| 36  | Dividir `home-editor.tsx` y `productos/actions.ts` en módulos | 🤖      | Tu aprobación (refactor grande) |
| 37  | API pública y webhooks salientes                              | 🤖      | ADR, plan que lo permita        |
| 38  | Multi-bodega y productos digitales                            | 🤖      | ADR                             |
| 39  | Alta autoservicio (E15), página de estado y soporte           | 🤖 y 🧑 | Tu decisión                     |
| 40  | Más plantillas por giro                                       | 🤖      | Ninguno                         |

---

## 5. Rutina para pasar un año sin problemas

**Cada semana (automática):**

- Revisión de dependencias (Dependabot, ya activa) y de salud (cada 15 minutos).
- Mantenimiento de datos (paso 2).
- Resumen semanal a cada dueña (paso 19).

**Cada mes (🧑 con mi apoyo, 30 min):**

- Mirar Consola → Salud, Trabajos y Métricas.
- Revisar y unir las actualizaciones de Dependabot con el CI en verde.
- Comprobar que el respaldo se hizo.

**Cada trimestre:**

- Simulacro de restauración en un proyecto aparte.
- Repetir la medición de escala (`scripts/bench`) con el tamaño real de datos.
- Repetir la auditoría del panel (`tests/visual/panel-audit.spec.ts`).
- Revisar certificados y dominios que vencen.

**Cada 6 meses:**

- Rotar claves.
- Revisar permisos del equipo y de la plataforma.

**Fechas fijas:**

- **2027-03-31:** Node 24 en producción.
- **2028-09-30:** comprobar que siguen creándose las particiones de auditoría (si el paso 2 está hecho, no hace falta).
- **Cuando Supabase o Vercel anuncien fin de soporte:** actualizar antes de la fecha.

---

## 6. Decisiones que necesito de ti

Responde con el número y la letra.

1. **ADR-059, medios diferidos:** ¿A (excluirlos al arrancar) o B (vencimiento de 72 horas)? Recomiendo A.
2. **ADR-060, retención de datos:** ¿apruebas los plazos propuestos? Jobs terminados 30 días, importaciones crudas 30 días, notificaciones 12 meses, eventos de pago 24 meses, carritos abandonados 90 días, eventos de seguridad 24 meses.
3. **Node 24:** ¿apruebas la actualización antes del 2027-03-31?
4. **ADR-061, devoluciones:** ¿apruebas el flujo propuesto (paso 18)?
5. **Segundo administrador:** ¿quién?
6. **Proveedor de CFDI:** ¿Facturapi, como asumí, u otro?
7. **Refactor de archivos grandes (paso 36):** ¿cuándo?
8. **Aplicar en staging** las migraciones `0300`, `0400` y `0500` (respuesta: «aprobado staging»).

---

## 7. Qué no cubrió esta auditoría

- **Preview de Vercel:** no se pudo abrir desde este entorno.
- **Mercado Pago, Skydropx, Resend y Facturapi reales:** sin credenciales y sin red hacia sus dominios [NO VERIFICADO].
- **Rendimiento real con CDN:** no se midió Lighthouse en producción.
- **Servicios de terceros:** no se revisaron los contratos, precios ni límites de Supabase y Vercel más allá de lo que dicen sus runbooks.
- **Aspectos legales:** esta auditoría no sustituye al abogado ni al asesor regulatorio.
- **La tienda `demo`** se ignoró por completo, como pediste.

**Evidencia:**

- `docs/audit/escalabilidad-2026-11.md`, `docs/audit/panel/`, `docs/audit/seguridad-2026-11.md`.
- `docs/plan/PRIMER-PEDIDO.md`, `docs/plan/DIAGNOSTICO-MERCADOPAGO.md`, `docs/plan/PENDIENTES-DEL-PROPIETARIO.md`.
- `docs/audit/AUDITORIA-2026-10-27/` (la súper auditoría anterior; sus hallazgos B1, B3, B5, B6 y C4 siguen abiertos).
