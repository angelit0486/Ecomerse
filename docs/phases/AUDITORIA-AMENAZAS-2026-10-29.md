# Auditoría de amenazas y riesgos antes de clientes (2026-10-29)

**Método:**

1. Primero, auditoría en solo lectura: código, base local, staging y dependencias.
2. Después, corrección de lo medio o mayor, cada corrección con su prueba.

**Documentos de esta auditoría:**

- Modelo STRIDE por componente: `docs/audit/AMENAZAS.md`.
- Registro de riesgos con dueño y fecha: `docs/audit/RIESGOS.md`.
- Inventario de dependencias y licencias: `docs/audit/SBOM.md`.
- Radar regulatorio: `docs/legal/RADAR-REGULATORIO.md`.
- Traspaso y plan de salida: `docs/architecture/TRASPASO-Y-SALIDA.md`.

**Etiquetas:**

- **[VERIFICADO]:** comprobado aquí con evidencia.
- **[NO VERIFICADO]:** no se pudo comprobar, con el motivo.

## Resultado

| Severidad | Encontrados                                 | Corregidos                 | Abiertos                                                                |
| --------- | ------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| Crítica   | 0                                           | —                          | **0**                                                                   |
| Alta      | 2 (R-01, R-02: sin respaldos ni producción) | —                          | **0** abiertos: aceptados como condición para lanzar, con dueño y fecha |
| Media     | 9                                           | 3 (AUD-03, AUD-05, AUD-06) | 6, todos de decisión o configuración del propietario (ver tabla)        |
| Baja      | 5                                           | —                          | 5, aceptados o del propietario                                          |

## 1. Hallazgos con evidencia

| ID     | Sev.  | Hallazgo                                                                      | Evidencia                                                                                                                                                                      | Estado                                                                   |
| ------ | ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| AUD-01 | Info  | Cabeceras de seguridad completas                                              | `curl -I /ingresar`: CSP con nonce y `strict-dynamic`, `frame-ancestors 'none'`, HSTS 2 años, nosniff, Referrer-Policy, Permissions-Policy, COOP, X-Frame-Options [VERIFICADO] | Sin acción                                                               |
| AUD-02 | Info  | Dependencias sin vulnerabilidades conocidas                                   | `pnpm audit`: «No known vulnerabilities found» [VERIFICADO]. Next 16.4.1 y React 19.3.0, posteriores a 16.2.6 y 19.2.6 (parches de mayo de 2026, fuentes secundarias)          | Sin acción                                                               |
| AUD-03 | Media | Importaciones sin límite por tienda (vecino ruidoso)                          | `supabase/migrations/20261023000200_brand_csv.sql:14` (`imports_create`) no limita la frecuencia; cada importación valida hasta 5,000 filas                                    | **Corregido:** 30 por hora, migración `20261029001100`, pgTAP 116        |
| AUD-04 | Media | Roles de solo lectura ven PII completa                                        | `role_permissions`: `viewer` tiene `customers.read` y `orders.read`; `inventory_manager` tiene `orders.read`                                                                   | Abierto: ADR-054 propuesto                                               |
| AUD-05 | Media | Recordatorio de carrito sin baja en un clic (RFC 8058)                        | `src/server/notifications/cart-recovery.ts`: sin `List-Unsubscribe`                                                                                                            | **Corregido:** cabeceras y endpoint firmado; unitarias, integración, E2E |
| AUD-06 | Media | Sin vigilancia automática de dependencias                                     | No existía `.github/dependabot.yml`                                                                                                                                            | **Corregido:** Dependabot semanal                                        |
| AUD-07 | Media | Repositorio público                                                           | `raw.githubusercontent.com/angelit0486/Ecomerse/...` responde 200 sin credenciales [VERIFICADO]                                                                                | Abierto: decisión del propietario (R-08)                                 |
| AUD-08 | Media | Sin firewall de volumen para carrito y búsqueda                               | Límites propios solo en checkout, códigos y accesos; SEC-05                                                                                                                    | Abierto: requiere acceso a Vercel (R-09)                                 |
| AUD-09 | Media | Sin límites de gasto configurados                                             | No hay acceso a la facturación de Vercel ni de Supabase                                                                                                                        | Abierto: propietario (R-11)                                              |
| AUD-10 | Media | Correo sin dominio verificado (SPF/DKIM/DMARC)                                | `EMAIL_PROVIDER=fake` en staging                                                                                                                                               | Abierto: propietario (R-10)                                              |
| AUD-11 | Media | Tiendas con productos prohibidos                                              | Solo hay términos prohibidos por tienda; ADR-042 aplazado                                                                                                                      | Abierto: ADR-053 propuesto                                               |
| AUD-12 | Baja  | `pg_net` en `public`                                                          | Advisor de Supabase `extension_in_public`                                                                                                                                      | Abierto: la confirmación de Supabase quedó sin respuesta (R-20)          |
| AUD-13 | Baja  | Protección de contraseñas filtradas apagada                                   | Advisor `auth_leaked_password_protection`                                                                                                                                      | Abierto: propietario, 1 minuto (R-12)                                    |
| AUD-14 | Baja  | Enlace de pedido de invitado sin vigencia                                     | SEC-02                                                                                                                                                                         | Aceptado (R-07)                                                          |
| AUD-15 | Baja  | Sesión del personal sin límite de vida total                                  | JWT 1 h + refresh rotativo                                                                                                                                                     | Aceptado (R-13)                                                          |
| AUD-16 | Baja  | Al cerrar una tienda, su dominio propio queda en Vercel hasta quitarlo a mano | ADR-037                                                                                                                                                                        | Mitigado con tarea manual (R-14)                                         |

## 2. Revisión adversarial propia

| Ataque                           | Qué se intentó                                                    | Resultado                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR entre tiendas               | Leer o cambiar filas de otra tienda con ids ajenos, como cada rol | Bloqueado por RLS forzado y guardas; cubierto para toda tabla por `05_tenant_isolation` y los metatests 15–17 (pgTAP 2,592/2,592 [VERIFICADO]) |
| IDOR en la baja de recordatorios | Dar de baja el correo de otro con la URL de un clic               | 400 sin firma HMAC válida (E2E `cart-recovery.spec`)                                                                                           |
| XSS                              | Buscar HTML sin escapar                                           | Único `dangerouslySetInnerHTML` en `src/ui/safe-html.tsx:20` (sanitizado); correos con `escapeHtml` (pruebas de plantillas con `<script>`)     |
| SSRF                             | «Foto desde enlace» hacia IP internas                             | Bloquea `127.0.0.1`, `10.x`, `169.254.169.254`, `::1` y `fc00::` (`src/server/media/remote-fetch.test.ts`)                                     |
| Fuga de PII                      | Logs, enlaces y correos                                           | Logger que enmascara; el enlace de baja lleva el hash, nunca el correo. **Hallazgo AUD-04** (PII por rol)                                      |
| Sobreventa                       | Compras simultáneas del último artículo                           | Inventario solo por `app.apply_inventory_movement` con bloqueo de fila; pgTAP de inventario                                                    |
| Doble envío de pedido            | Doble clic y dos pestañas                                         | Un solo pedido por clave de idempotencia (integración `checkout-concurrency`)                                                                  |
| Precio manipulado                | Total distinto enviado por el navegador                           | `price_changed` (E2E `checkout.spec`)                                                                                                          |

## 3. Amenazas futuras (punto 4 del encargo)

Cada una está en `RIESGOS.md` con dueño y fecha. Resumen:

| Tema                           | Situación                                                                                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a) Vecino ruidoso              | Mitigado. Cuotas por plan de productos y almacenamiento; 50 subidas pendientes; 30 importaciones/hora (nuevo). Las transformaciones de imagen no existen en tiempo real (variantes pregeneradas). Peticiones: firewall de Vercel (R-09). |
| b) Costos                      | Consumo medido (base local de 176 MB con 3,947 tiendas de prueba); precios oficiales [NO VERIFICADO]; límites duros por configurar (R-11)                                                                                                |
| c) Dominios secuestrados       | Verificación TXT antes de activar (ADR-037); tarea al cerrar tienda (R-14)                                                                                                                                                               |
| d) Abuso de la plataforma      | Suspensión inmediata con auditoría en la consola (ya existe); lista de prohibidos ADR-053; aceptación de política ADR-042                                                                                                                |
| e) Entregabilidad              | Baja en un clic y supresión (nuevo). Reglas de Gmail/Yahoo, según fuentes secundarias porque la página oficial no fue accesible: SPF, DKIM y DMARC; quejas < 0.3 %; baja en un clic. Falta el dominio (R-10)                             |
| f) Regulación                  | `RADAR-REGULATORIO.md`                                                                                                                                                                                                                   |
| g) Bus factor y lock-in        | `TRASPASO-Y-SALIDA.md`; el CI ya corre todo fuera de Vercel y Supabase                                                                                                                                                                   |
| h) Código con IA y titularidad | `SBOM.md`: 176 paquetes de producción, sin GPL/AGPL; unificar `angelit0486` y `angelii33` (R-18)                                                                                                                                         |
| i) Pérdida de datos            | Ver sección 4                                                                                                                                                                                                                            |
| j) Datos personales            | Exportación, borrado por cliente, anonimización a 30 días (ADR-046); PII por rol (ADR-054); revisión legal (R-19)                                                                                                                        |
| k) Disponibilidad              | Límites de tasa propios, página de mantenimiento, aviso de versión de esquema; firewall pendiente (R-09)                                                                                                                                 |

## 4. Respaldo y restauración

| Prueba                                              | Resultado                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Restauración local (`scripts/ops/restore-drill.sh`) | **[VERIFICADO]** 2026-10-29: `pg_dump` → base nueva; 114 tablas con conteos idénticos (280,109 filas); totales de pedidos y pagos iguales; metatests de seguridad en verde sobre la copia; **26 s** de recuperación de la base |
| Restauración en un proyecto de Supabase aparte      | **[NO VERIFICADO].** Motivos: staging está en plan Free, sin respaldos automáticos ni PITR, y crear un proyecto aparte tiene costo y lo decide el propietario. Es condición para lanzar (R-01)                                 |
| RTO y RPO propuestos para producción                | RTO de 1 hora (restaurar con PITR y volver a desplegar). RPO de 5 minutos (PITR de Supabase Pro; [NO VERIFICADO] contra la documentación oficial)                                                                              |

## 5. Pruebas al cierre

| Suite                  | Resultado                                             |
| ---------------------- | ----------------------------------------------------- |
| `pnpm verify`          | 1,056/1,056 [VERIFICADO]                              |
| pgTAP                  | 2,592/2,592 en 118 archivos [VERIFICADO]              |
| Integración            | 378/378 [VERIFICADO]                                  |
| E2E (Playwright + axe) | 120/120 en una ronda completa (19.3 min) [VERIFICADO] |
| Staging                | `20261029001100`, 139 migraciones = repo [VERIFICADO] |

## 6. Fuentes consultadas

- [Vercel: Next.js May 2026 security release](https://vercel.com/changelog/next-js-may-2026-security-release) (no se pudo abrir desde el entorno; resumen por buscador).
- [Netlify: React y Next.js, vulnerabilidades de mayo de 2026](https://www.netlify.com/changelog/2026-05-08-react-nextjs-security-vulnerabilities.md).
- [Bird: requisitos de remitentes de Gmail y Yahoo](https://bird.com/docs/knowledge-base/deliverability/gmail-yahoo-requirements) (secundaria).
- [Help Net Security: reglas de Gmail para remitentes masivos](https://www.helpnetsecurity.com/2023/10/04/gmail-bulk-senders-requirements/) (secundaria).
- Base de avisos de npm vía `pnpm audit` (2026-10-29).
