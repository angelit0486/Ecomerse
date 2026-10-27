# 11 · FODA y registro de riesgos — 2026-10-27

Síntesis de los documentos 01 a 10, después de la verificación adversarial. Un segundo revisor intentó refutar los 13 hallazgos más graves leyendo el código y consultando staging: ninguno quedó refutado; 5 cambiaron de severidad o de redacción (ver la tabla «Ajustes de la verificación» al final).

Cada línea cita el ID del hallazgo; la evidencia completa está en su documento.

## 1. FODA

FODA son Fortalezas, Oportunidades, Debilidades y Amenazas: lo bueno y lo malo de adentro, y lo bueno y lo malo de afuera.

### Fortalezas (internas)

| Fortaleza                                                                                                                                                                                         | Evidencia                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Aislamiento entre tiendas muy sólido. RLS forzado en 109 de 109 tablas, sin grants a `anon`, 384 funciones `SECURITY DEFINER` con `search_path=''` y ninguna RPC sin guarda en la revisión manual | `02` (controles verificados); `VERIFICACION` #13                                               |
| El dinero se calcula en la base: totales en `bigint`, sin sobreventa, webhooks idempotentes, cobros y correos sin duplicar                                                                        | `03` (controles verificados); integración `checkout-concurrency` y `mercadopago-webhook` 19/19 |
| Suites de pruebas amplias y estables: 945 unitarias, 2,348 pgTAP, 355 de integración y 98 E2E, y el E2E también corre en CI                                                                       | `01` §1                                                                                        |
| Cumplimiento sanitario nativo: perfil versionado y firmado, leyendas, y bloqueo de publicación. Ningún competidor revisado lo trae                                                                | `09` (controles); `08` MER-03                                                                  |
| Calidad de las tiendas: axe con 0 violaciones en 24 pantallas; Lighthouse en Accesibilidad, Buenas prácticas y SEO en 100                                                                         | `01` §4                                                                                        |
| Proveedores aislados detrás de interfaces (`PaymentProvider`, canal de correo, `DomainProvider`); salir de Postgres, Resend o Vercel es portátil                                                  | `04` ARQ-08; `10` DEP-05                                                                       |
| Ya existen las piezas de varias oportunidades: carritos «abandonados», permisos `abandoned_cart` y `advanced_analytics`, porciones por variante, 6 plantillas por giro y reseñas verificadas      | `10`                                                                                           |

### Debilidades (internas)

| Debilidad                                                                                                                                                                                        | Evidencia                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **El mantenimiento de la cola nunca se ha ejecutado en staging**: no vencen las reservas, no se concilian los pagos y nada se purga. El único disparador es un cron diario y nadie se dio cuenta | OPS-01 / DIN-04 / REN-02 / DAT-01; `VERIFICACION` #1 |
| No hay moderación de lo que publica cada tienda ni política de uso aceptable                                                                                                                     | REG-02 / EST-02                                      |
| Huecos de dinero con Mercado Pago real: pago tardío con webhook perdido; contracargos y reembolsos externos ignorados                                                                            | DIN-01, DIN-03                                       |
| Sin monitoreo, alertas ni respaldos; restauración nunca ensayada                                                                                                                                 | OPS-02, OPS-03, OPS-04                               |
| Un solo operador; sin acceso de emergencia                                                                                                                                                       | OPS-10                                               |
| CI en rojo desde `be5541d` y la rama no está protegida                                                                                                                                           | EST-09, OPS-07                                       |
| Imágenes sin variantes: se sirve el original, de hasta 4096 px                                                                                                                                   | REN-01                                               |
| El SaaS no se puede vender: no hay cobro de suscripción, registro público ni Mercado Pago por tienda                                                                                             | MER-02, DEP-02, OPO-14                               |
| La anonimización no alcanza pedidos ni carritos; la retención de datos no está programada                                                                                                        | DAT-03, DAT-04                                       |
| Documentación difícil de retomar: sin README raíz, PROGRESS desactualizado, faltan 8 runbooks                                                                                                    | ARQ-05, EST-05, OPS-14                               |

### Oportunidades (externas)

| Oportunidad                                                                                                                 | Evidencia                       |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Posicionarse como «la plataforma para vender productos regulados en México», con cumplimiento nativo                        | MER-03                          |
| Hueco que dejó el cierre de Mercado Shops (31-dic-2025, según fuentes secundarias)                                          | MER-13                          |
| Sin comisión extra de plataforma frente a Shopify o Tiendanube, que cobran entre 0.6 % y 2 % si no se usa su pasarela       | `08` §3                         |
| Recompra calculada por porciones (suplementos que se acaban en fechas predecibles)                                          | OPO-05a                         |
| Envíos con cotización y guías, recuperación de carritos y analítica de embudo                                               | OPO-01, OPO-04, OPO-12          |
| Comercio electrónico en México en crecimiento: AMVO 2026, +19.2 %; solo 5.7 % de los suplementos se vende en línea (ANAISA) | `08` §4 (fuentes y fechas allí) |

### Amenazas (externas)

| Amenaza                                                                                                                                                                                           | Evidencia                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Contenido asociado con THC y vapeadores en una tienda pública de la cuenta del propietario**: riesgo legal y de suspensión de Vercel, Supabase y las pasarelas, que tumbaría toda la plataforma | EST-01 / REG-01 / DEP-01 |
| Precio de marketplace muy bajo: Amazon y Mercado Libre venden entre 20 % y 40 % por debajo del precio regular de GNC, con entrega al día siguiente                                                | MER-01                   |
| Riesgo de pasarela: categorías restringidas, retención de fondos 7 días en cuentas nuevas y revisión manual                                                                                       | REG-12, DEP-02           |
| Regulación de suplementos: términos prohibidos, permiso de publicidad, aviso de funcionamiento, CFDI                                                                                              | REG-03 a REG-10, REG-13  |
| Planes gratuitos: Vercel Hobby es solo para uso no comercial; Supabase Free se pausa y no tiene respaldos                                                                                         | DEP-03, DEP-04, OPS-19   |

## 2. Registro de riesgos

- **Probabilidad** (P) e **impacto** (I) van de 1 a 5. **Puntaje = P × I**.
- **Dueño:** 🧑 propietario, 🤖 desarrollo (Claude) y ⚖️ asesor externo.
- Los puntajes son juicio del auditor con la evidencia citada; no son mediciones.

| ID   | Riesgo                                                                                                                          | P   | I   | Puntaje | Dueño   | Mitigación                                                                                                                                     | Señal temprana                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| R-01 | Suspensión de cuentas (Vercel, Supabase, pasarela) o acción legal por la tienda demo con productos asociados a THC y vapeadores | 3   | 5   | **15**  | 🧑 + ⚖️ | Despublicar o archivar esos productos o la tienda; consultar a un abogado; aceptar una política de uso aceptable                               | Correo de un proveedor, una denuncia o la tienda indexada |
| R-02 | Reservas que nunca vencen y pagos sin conciliar en producción: productos «agotados» falsos y dinero cobrado sin pedido          | 5   | 4   | **20**  | 🤖      | Disparador por minuto (Vercel Pro, pg_cron o un cron externo firmado); `processQueueSoon` tras checkout y webhook; alerta si la cola no avanza | `system.jobs` sin `orders.expire` en 24 h                 |
| R-03 | Pérdida de datos sin respaldo ni restauración probada                                                                           | 2   | 5   | 10      | 🧑 + 🤖 | Supabase Pro con PITR; simulacro de restauración y runbook; respaldo de Storage                                                                | Plan Free en producción                                   |
| R-04 | Incidente sin detección (webhook falla, cola muerta)                                                                            | 4   | 4   | **16**  | 🤖      | Sentry o equivalente; monitor externo de `/api/health/ready` con aviso al celular                                                              | No hay alertas (estado actual)                            |
| R-05 | Contracargo o disputa ignorados: se envía mercancía ya disputada                                                                | 3   | 3   | 9       | 🤖      | Manejar los estados `charged_back` y `refunded` de MP; bloquear el surtido y avisar                                                            | El primer contracargo real                                |
| R-06 | Pago tardío de MP con webhook perdido: dinero sin pedido                                                                        | 2   | 4   | 8       | 🤖      | Conciliar también los intentos vencidos de los últimos días                                                                                    | Pago aprobado en MP sin pedido pagado                     |
| R-07 | Venta de suplementos sin revisión regulatoria (perfil activo sin firma)                                                         | 3   | 5   | **15**  | 🧑 + ⚖️ | Regresar el perfil a `pending` en producción; firma del asesor; lista de términos completa                                                     | Perfil `active` con `reviewed_by` «Demostración»          |
| R-08 | Operador único no disponible o celular perdido (2FA)                                                                            | 2   | 5   | 10      | 🧑      | Segundo administrador de confianza; códigos de recuperación guardados; runbook de emergencia                                                   | —                                                         |
| R-09 | Cambios que rompen producción porque el CI no bloquea y las migraciones corren en cada build                                    | 3   | 4   | 12      | 🤖      | Proteger la rama; migrar después de que el CI pase; advisory lock en `migrate.mjs`                                                             | CI en rojo (hoy)                                          |
| R-10 | Retención o suspensión de fondos de Mercado Pago (categoría salud y cuenta nueva)                                               | 3   | 4   | 12      | 🧑      | Validar la categoría con MP antes de lanzar; tener una pasarela alterna lista                                                                  | Correo de revisión de MP                                  |
| R-11 | Una tienda del SaaS publica bienes prohibidos (sin moderación)                                                                  | 3   | 5   | **15**  | 🤖 + 🧑 | Política de uso aceptable aceptada al crear la tienda; lista de bloqueo de términos; revisión de tiendas nuevas                                | Tienda nueva con categorías no declaradas                 |
| R-12 | LCP alto y egress caro con fotos reales sin variantes                                                                           | 4   | 3   | 12      | 🤖      | Variantes con sharp y `srcset` antes de cargar el catálogo                                                                                     | LCP mayor a 2.5 s en la ficha                             |
| R-13 | Margen negativo en el escenario conservador por el envío gratis absorbido                                                       | 3   | 3   | 9       | 🧑      | Umbral de envío gratis basado en datos; cotización real                                                                                        | Margen por pedido menor a 0                               |
| R-14 | Fuga de PII por un enlace de pedido de invitado reenviado                                                                       | 2   | 2   | 4       | 🤖      | Vigencia del enlace o verificación por código                                                                                                  | —                                                         |
| R-15 | Denegación de servicio del login por código (cuota de Auth compartida)                                                          | 2   | 3   | 6       | 🤖      | Límite propio por email e IP; firewall                                                                                                         | Picos de `requestLoginCode`                               |

## 3. Ajustes de la verificación adversarial

| Hallazgo                          | Antes                        | Después                             | Motivo                                                                                                                                                       |
| --------------------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OPS-01 / DIN-04 / REN-02 / DAT-01 | Crítica / Alta / Alta / Alta | **Crítica, unificada** (bloqueador) | No es «hasta 24 h de retraso»: en staging **nunca** se ha encolado `orders.expire` ni `payments.reconcile` (SELECT en `system.jobs` del 16 al 26 de octubre) |
| SEC-02                            | Media                        | Baja-Media                          | Es el diseño de GATE0 §16.5: token de 256 bits, `Referrer-Policy` y `noindex`                                                                                |
| REG-07                            | Alta                         | Media                               | Abrir la tienda sí exige publicar el aviso de privacidad; lo que falta es el enlace en el checkout                                                           |
| DEP-02                            | Alto                         | Media hoy; Alta con varias tiendas  | Limitación aceptada en ADR-028, pero choca con GATE0:2349                                                                                                    |
| REN-04 / OPS-17 / DAT-02          | Media / Baja / Alta          | **Media, unificada**                | ~134 mil filas al mes no rompen nada pronto; sí exige un job de purga                                                                                        |
| REG-02 / EST-02                   | Crítica / Alta               | Alta (Crítica mientras exista R-01) | Riesgo de plataforma; se vuelve crítico con contenido prohibido publicado                                                                                    |

## 4. Contradicciones encontradas entre documentos del proyecto

Estas contradicciones están dentro de la documentación del proyecto, no en la auditoría:

- **Frecuencia de los jobs:** `route.ts:15` y `orders/handlers.ts:12` dicen «cada minuto», y el runbook promete conciliar «cada 10 min». El cron real es diario y en staging no ha corrido el mantenimiento.
- **Contracargos:** GATE0:1301 pide registrarlos con alerta, pero GATE0:2227 los difiere.
- **Cuentas de pago:** GATE0:2349 dice que «cada tienda conecta su cuenta», mientras ADR-028 usa una sola credencial de Mercado Pago.
- **Estado del proyecto:** PROGRESS.md dice que no hay push ni CI; hoy funcionan los dos, aunque el CI está en rojo.
