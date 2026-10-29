# Registro de riesgos (2026-10-29)

Cada riesgo tiene dueño, mitigación, estado y fecha de revisión.

- **Dueños:**
  - **Propietario:** decisión o configuración que solo él puede hacer.
  - **Ingeniería:** el agente o el equipo técnico.
- **Severidad:** Crítica / Alta / Media / Baja.
- **Estado:**
  - **Abierto:** falta mitigarlo.
  - **Mitigado:** el control existe y tiene prueba.
  - **Aceptado:** se conoce, no se mitiga hoy, se revisa en la fecha indicada.

**Resumen al cierre de la auditoría:** 0 críticos y 0 altos abiertos. Los riesgos de severidad alta quedan como aceptados, con dueño y fecha, porque hoy no hay datos reales de clientes y su mitigación es una condición para lanzar (ver R-01 y R-02).

| ID   | Riesgo                                                                          | Sev.  | Dueño       | Mitigación                                                                                                                                                                                        | Estado                                  | Revisión   |
| ---- | ------------------------------------------------------------------------------- | ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------- |
| R-01 | **Pérdida de datos:** staging en plan Free sin respaldos automáticos            | Alta  | Propietario | Simulacro local [VERIFICADO] (280,109 filas, 26 s). **Condición para lanzar:** producción en Supabase Pro con PITR y simulacro en un proyecto aparte. Staging solo tiene datos de demostración    | Aceptado (no hay datos reales)          | 2026-11-30 |
| R-02 | **Producción no existe:** sin proyecto, claves ni dominio propios               | Alta  | Propietario | `despliegue-y-rollback.md` define el entorno de producción separado. No se aceptan clientes en staging                                                                                            | Aceptado (condición para lanzar)        | 2026-11-30 |
| R-03 | Vecino ruidoso: una tienda satura importaciones, subidas o la cola              | Media | Ingeniería  | **AUD-03:** 30 importaciones por hora por tienda (migración `20261029001100`, pgTAP 116). Ya había: 50 subidas pendientes, cuotas de productos y almacenamiento por plan, lotes en la cola        | Mitigado                                | 2027-01-29 |
| R-04 | PII completa visible para roles de solo lectura (`viewer`, `inventory_manager`) | Media | Propietario | ADR-054 propuesto: permiso `customers.pii`; sin él, correo y teléfono enmascarados. Cambia el contrato de permisos: espera aprobación                                                             | Abierto (ADR)                           | 2026-11-15 |
| R-05 | Cadena de suministro: dependencia con vulnerabilidad                            | Media | Ingeniería  | `pnpm audit` sin vulnerabilidades [VERIFICADO 2026-10-29]; versiones exactas y lockfile; **AUD-06:** Dependabot semanal; Next 16.4.1 y React 19.3.0, posteriores a los parches de mayo de 2026    | Mitigado                                | Semanal    |
| R-06 | Entregabilidad: recordatorios sin baja en un clic                               | Media | Ingeniería  | **AUD-05:** `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058) con endpoint firmado; supresión de rebotes y quejas                                                                           | Mitigado                                | 2026-12-31 |
| R-07 | Enlace de pedido de invitado sin vigencia ni revocación (SEC-02)                | Baja  | Propietario | Token de 256 bits, no está en logs. Vigencia o revocación tocan el contrato del checkout: ADR pendiente                                                                                           | Aceptado                                | 2027-01-29 |
| R-08 | Repositorio de código **público** (`angelit0486/Ecomerse`)                      | Media | Propietario | Sin secretos en el historial (búsqueda de patrones y gitleaks en CI). Hacerlo privado; las migraciones a staging pasarían a `MIGRATION_DATABASE_URL`                                              | Abierto (decisión del propietario)      | 2026-11-15 |
| R-09 | Disponibilidad: ataques de volumen a carrito y búsqueda                         | Media | Propietario | Límites propios en checkout, códigos, login y cuentas; página de mantenimiento; falta el firewall de Vercel con reglas por IP (SEC-05)                                                            | Abierto (requiere acceso a Vercel)      | 2026-11-15 |
| R-10 | Suplantación del remitente; correo sin SPF/DKIM/DMARC                           | Media | Propietario | Runbook `correo-resend.md` listo; falta el dominio y la cuenta de Resend                                                                                                                          | Abierto                                 | 2026-11-15 |
| R-11 | Explosión de costos de Supabase o Vercel                                        | Media | Propietario | Estimación por tienda y por pedido (abajo); activar el límite de gasto de Supabase y Spend Management de Vercel con alertas al 50/80/100 %                                                        | Abierto (configuración del propietario) | 2026-11-30 |
| R-12 | Contraseñas filtradas en Supabase Auth                                          | Baja  | Propietario | TOTP obligatorio para personal; activar «leaked password protection» (1 minuto)                                                                                                                   | Abierto                                 | 2026-11-15 |
| R-13 | Sesiones largas del personal                                                    | Baja  | Propietario | JWT de 1 h con refresh rotativo. En Pro: vida máxima de sesión (time-box) de 7 días                                                                                                               | Aceptado                                | 2027-01-29 |
| R-14 | Subdominio o dominio secuestrado (subdomain takeover)                           | Baja  | Ingeniería  | Dominio propio solo se activa con verificación TXT de propiedad (ADR-037) y revisión periódica. Al cerrar una tienda, quitar su dominio de Vercel y avisar al comerciante para que borre el CNAME | Mitigado (con tarea manual al cerrar)   | 2027-01-29 |
| R-15 | Abuso: tiendas con productos prohibidos o fraudulentas                          | Media | Propietario | Ya existe: suspensión inmediata desde la consola con auditoría, términos prohibidos del cumplimiento. Propuestos: ADR-053 (lista de la plataforma), ADR-042 (aceptación de política)              | Abierto (ADR-053)                       | 2026-11-15 |
| R-16 | Cambios regulatorios (COFEPRIS, Profeco, LFPDPPP, SAT)                          | Media | Propietario | `docs/legal/RADAR-REGULATORIO.md` con qué vigilar y cada cuándo; textos legales PENDIENTE DE REVISIÓN                                                                                             | Aceptado (vigilancia periódica)         | Mensual    |
| R-17 | Dependencia de una sola persona (bus factor) y de Vercel/Supabase (lock-in)     | Media | Propietario | `docs/architecture/TRASPASO-Y-SALIDA.md`: cómo retomar el proyecto y plan de salida                                                                                                               | Mitigado (documentado)                  | 2027-01-29 |
| R-18 | Titularidad del código en dos cuentas (angelit0486 y angelii33); código con IA  | Media | Propietario | `docs/audit/SBOM.md`: licencias sin copyleft fuerte; unificar el repositorio en una sola cuenta u organización; revisión legal de la cesión                                                       | Abierto                                 | 2026-11-30 |
| R-19 | Datos personales: consentimiento, exportación, borrado, retención               | Media | Propietario | Ya existe: aviso de privacidad (borrador), exportación por tienda, «Borrar datos» por cliente, anonimización a 30 días del cierre (ADR-046). Falta: revisión del abogado y plazo de retención     | Aceptado (revisión legal)               | 2026-11-30 |
| R-20 | `pg_net` en el esquema `public` (aviso de Supabase)                             | Baja  | Propietario | Aprobado mover a `extensions`. La confirmación de Supabase quedó sin respuesta dos veces; reintentar con el propietario presente                                                                  | Abierto                                 | 2026-11-05 |

## Estimación de costo por tienda y por pedido (R-11)

Las páginas oficiales de precios de Supabase y Vercel no fueron accesibles desde el entorno de desarrollo, así que **todas las cifras de precio están [NO VERIFICADO]**. Lo que sí está medido aquí es **qué consume cada cosa**:

| Recurso                 | Qué lo consume                                                            | Medido en este proyecto                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base de datos (tamaño)  | Productos, pedidos, auditoría                                             | Base local de pruebas con 3,947 tiendas, 7,516 productos y 865 pedidos (casi todas creadas por las pruebas automáticas): 176 MB [VERIFICADO, `pg_database_size`, 2026-10-29] |
| Almacenamiento de fotos | 3–4 variantes por foto (WebP)                                             | Limitado por la cuota `storage_mb` del plan de cada tienda                                                                                                                   |
| Funciones de Vercel     | Cada página de la tienda y del panel; trabajos de la cola                 | Páginas dinámicas; trabajos por lotes cada 15 min                                                                                                                            |
| Ancho de banda          | Fotos y páginas                                                           | Fotos servidas desde Supabase Storage                                                                                                                                        |
| Correos                 | Confirmación, envío, entrega, reembolso, avisos a la tienda, recordatorio | Unos 3–5 correos por pedido                                                                                                                                                  |

**Para ponerle precio** (tarea del propietario con los precios oficiales vigentes):

- costo por tienda al mes = (plan base de Supabase + plan base de Vercel) ÷ número de tiendas, más almacenamiento de la tienda × precio por GB;
- costo por pedido = invocaciones de funciones por pedido × precio + 4 correos × precio por correo de Resend.

**Límites duros recomendados:**

- Supabase con **spend cap** activado;
- Vercel **Spend Management** con tope mensual y pausa automática al llegar;
- Resend con límite diario del plan;
- alertas por correo al 50, 80 y 100 %.
