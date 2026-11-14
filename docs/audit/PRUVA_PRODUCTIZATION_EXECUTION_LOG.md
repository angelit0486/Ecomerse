# PRUVA — Bitácora de productización (Orden 09)

Registro cronológico. Tablero: `PRUVA_PRODUCTIZATION_BOARD.md`.

## 2026-11-12 — Bloque 1

**Punto de partida.** Rama `producto/orden-09` creada desde `audit/hardening-capacity-2026-11` en `dd85fbc`. Línea base documental: Orden 08.

**1. Revisión antes de construir.**

- El «revisor de archivo» (RM-12) ya existía: la vista previa agrupa errores por columna, lista las filas con error, permite descargar el CSV de errores, importar solo lo válido y resubir el archivo corregido. No se reconstruyó. Se corrige la Orden 08: F-39 pasa de parcial a implementado.
- Huecos reales encontrados en el código:
  1. la hoja simple en español no aceptaba tallas ni colores (una fila por producto);
  2. no había dónde ver el avance de las fotos ni las rechazadas de todo el catálogo;
  3. el tiempo de procesar fotos nunca se había medido;
  4. no había hoja de inicio por giro.

**2. Fotos medidas (PB-05).** `bash scripts/capacity/media.sh`, base local desechable, cola real con el rol del worker, almacenamiento en memoria. 1,280 fotos, 4 de 4 casos.

| Foto                    | Peso   | Pasadas a la vez | ms por foto | Fotos por pasada de 45 s | 10,000 fotos |
| ----------------------- | ------ | ---------------- | ----------- | ------------------------ | ------------ |
| Catálogo 1200×1200 JPEG | 73 KB  | 1                | 252         | 178                      | 42 min       |
| Catálogo 1200×1200 JPEG | 73 KB  | 2                | 126         | 357                      | 21 min       |
| Catálogo 1200×1200 JPEG | 73 KB  | 4                | 68          | 658                      | 11 min       |
| Celular 4000×3000 JPEG  | 438 KB | 1                | 1,020       | 44                       | 170 min      |
| Celular 4000×3000 JPEG  | 438 KB | 4                | 274         | 164                      | 46 min       |
| PNG 1600×1600           | 205 KB | 1                | 402         | 111                      | 67 min       |

Límite de la medición: no incluye la red hacia el almacenamiento (una lectura, hasta 5 escrituras y un borrado por foto) ni la descarga del enlace. Máquina de 4 núcleos.

Decisión: no se rediseña la cola. El cuello es la frecuencia: con cron cada minuto, 10,000 fotos de catálogo son alrededor de una hora; con el cron diario de hoy, días. Sustituye la estimación «podrían tardar días» de RSK-05 por un dato.

**3. Vista «Fotos en proceso» (PB-06).** `Productos → Importar → Fotos en proceso`. Enlazada desde Inicio y desde la importación terminada.

**4. Hoja con tallas y colores (PB-01)** y **hoja por giro (PB-02).**

**5. Costos y planes (PB-18, PB-19).** Precios oficiales de Supabase, Vercel, Resend, Mercado Pago y Tiendanube leídos el 2026-11-12. Documento: `docs/venta/05-modelo-comercial-y-costos.md`. Hallazgo: la infraestructura cuesta entre 30 y 660 MXN por tienda al mes según cuántas tiendas haya; lo que decide el precio son las horas de implementación y soporte.

**6. Guion de 5 días (PB-03)** escrito; falta ensayarlo completo.

**7. ADR-064 y ADR-065** redactados para decisión del propietario.

**Problemas.**

- El contenedor de la sesión se reinició dos veces; no se perdió trabajo.
- Una prueba nueva de plantillas falló por un dato de prueba (precio anterior igual al precio); corregida.

**Pruebas y commits.** Ver el cierre del bloque al final de este archivo.

### Cierre del bloque 1

Pruebas, en local, sobre el código de este bloque:

| Suite                                                  | Resultado                                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (lint, formato, tipos, unitarias, build) | Correcto; 1,296 unitarias (16 nuevas)                                                                                 |
| pgTAP                                                  | 2,983 de 2,983 en 144 archivos (sin migraciones nuevas)                                                               |
| Integración                                            | 438 de 438                                                                                                            |
| E2E, corrida completa                                  | 150 pasaron; fallaron 2 pruebas **nuevas** por errores de la propia prueba y 1 no corrió por depender de una de ellas |
| E2E, repetición tras corregir esas pruebas             | 7 de 7 en `photo-progress`, `sheet-variants`, `paste-products` e `imports`                                            |
| Capacidad de fotos                                     | 4 de 4 (1,280 fotos)                                                                                                  |

Las dos pruebas corregidas: una volvía a dar de alta el segundo factor de una cuenta que ya lo tenía; la otra esperaba la firma de la presentación en orden alfabético y el producto usa el orden de sus opciones (Talla, luego Color). El código del producto no cambió entre la corrida completa y la repetición.

Estado al cierre:

- **Implementado y probado en local:** PB-01, PB-02, PB-05, PB-06 y PB-18.
- **Escrito, sin validar con un comercio:** PB-03 (guion) y PB-19 (planes).
- **Desplegado:** nada. **Validado con clientes:** nada.
- **Esperan decisión:** ADR-064 y ADR-065.

Siguiente bloque sin autorizaciones nuevas:

1. Ensayo completo del guion con una tienda sintética por giro (cierra PB-03).
2. PB-14, alertas accionables en Inicio con los datos que ya existen.
3. PB-15, catálogo compartible y código QR.
4. PB-08 en cuanto haya decisión sobre el ADR-064.

## Orden 10, bloque 1 (2026-11-12/13)

Rama `producto/orden-10`, creada desde `producto/orden-09` @ `b6cd725`. Nada desplegado, nada aplicado en staging, ADR-064 y ADR-065 sin resolver.

| Tarea  | Resultado                                                                                                 | Commits                                     | Hora de cierre (commit)  |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------ |
| O10-05 | Paquete de despliegue y ensayo local; luego ampliado a 6 migraciones                                      | `c8e5977`, `8185770`                        | 11-12 21:35; 11-13 00:09 |
| O10-02 | Alertas «Qué atender hoy» detrás de «Salud de tu tienda»; migración local `20261112000100`                | `ddb7ef2`                                   | 11-12 21:48              |
| O10-04 | Revisar los enlaces de fotos con el descargador seguro                                                    | `966e79a`                                   | 11-12 21:55              |
| O10-03 | Compartir por WhatsApp y QR, sin dependencia nueva                                                        | `18caef6`                                   | 11-12 22:08              |
| O10-01 | Ensayo con 4 tiendas sintéticas; encontró el error de tarifas (corregido en `65ee7a0`); guion actualizado | `87a0524` … `18e3ef1`, `65ee7a0`, `159f18c` | 11-13 00:06              |
| O10-06 | Documentos, suites completas, evidencia                                                                   | este commit                                 | —                        |

Las horas son las de los commits; el inicio de O10-05 no quedó registrado. Los 14 commits `test(ensayo)` corrigen el arnés del ensayo, no la plataforma: cada uno dice qué suposición del arnés estaba mal (por ejemplo, que el aviso de «publicados» seguía visible tras refrescar la lista).

Suites completas al cierre (local, 2026-11-13), contra la línea base `b6cd725`:

| Suite                                                  | `b6cd725` | `producto/orden-10`             |
| ------------------------------------------------------ | --------- | ------------------------------- |
| Unit (verify: lint, formato, tipos, unit, build)       | 1,296     | 1,334                           |
| pgTAP                                                  | 2,983     | 2,999 (145 archivos)            |
| Integración                                            | 438       | 438                             |
| E2E                                                    | 152/152   | 157/157                         |
| `pnpm audit --prod`                                    | —         | sin vulnerabilidades            |
| Ensayo de las 6 migraciones (`migration-rehearsal.sh`) | —         | 109/109 pgTAP; esquema idéntico |
| Ensayo de implementación (4 tiendas sintéticas)        | —         | 4/4                             |

Aislamiento entre tiendas: `00_schema_security` (metatests de RLS forzado, grants y funciones) y `143_store_alerts` (otra tienda: `forbidden`) dentro de pgTAP; `photo-progress`, `share-qr` y los E2E de importación con dos tiendas.

## Orden 10, mensaje 4 (2026-11-13)

Autorizado por el propietario:

- ADR-064 A y ADR-065 A, con aceptación expresa de lotes aplicados a medias;
- las correcciones D2 y D3;
- las categorías de las plantillas;
- la publicación masiva por candidatos.

Solo desarrollo, pruebas, documentación y commits en `producto/orden-10`. Nada desplegado; staging y producción sin tocar.

| Tarea              | Resultado                                                                                                                   | Commits     | Hora (commit, UTC) |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------ |
| Plantillas         | Categorías completas por giro; la de suplementos recuerda Cumplimiento sin prometer cumplimiento sanitario                  | `ed19e7e`   | 05:05              |
| D2                 | E2E de la tarifa del panel hasta el pedido, más regresión de tarifas existentes                                             | `07e5984`   | 05:05              |
| D3 a D6 y D8       | Límites persistentes en «Revisar enlaces»; rebinding, dominio inexistente, interruptor de alertas en la base, `maxDuration` | `1a5dc04`   | 05:22              |
| ADR-065 A          | Crear las categorías que falten: casilla, vista previa, confirmación y permiso                                              | `cd2a42d`   | 05:34              |
| Publicación masiva | «Publicado: sí» como candidato; publica en segundo plano con las reglas vigentes y resume los pendientes                    | `a730989`   | 05:50              |
| ADR-064 A          | Importación por partes: lote, partes, corrección de una sola parte, recuperación tras caídas                                | `07ba916`   | 13:49              |
| D7 y cierre        | Runbook y ensayo de las 10 migraciones, ensayo de las 4 tiendas, documentos                                                 | este commit | —                  |

Entre `a730989` y `07ba916` el worker de la sesión se reinició dos veces (base y stack caídos); se levantaron otra vez y se repitieron las pruebas afectadas.

Errores de la plataforma que se encontraron al construir el bloque, ya corregidos y con su prueba:

1. `system.fail_stuck_imports` marcaba fallida una parte atascada, pero su lote seguía «aplicando» para siempre (pgTAP `147`; falla con la definición anterior).
2. Una corrida de publicación cuyo trabajo muere se quedaba «publicando» para siempre. Ahora se retoma sola hasta 3 veces y después falla con el motivo (pgTAP `147`).

Ensayos del cierre:

- **Migraciones** (`migration-rehearsal.sh`, 38 s): las 10 en orden con su sha256; 27/27 verificaciones; esquema idéntico al de una base desde cero (24,084 líneas); 307/307 pgTAP.
- **Implementación** (4 tiendas sintéticas):
  - 4/4 sin hallazgos;
  - sin categorías creadas a mano;
  - 30, 70, 160 y 40 productos publicados al importar;
  - la primera corrida, justo tras reiniciar el stack, falló en 2 tiendas por arranque en frío (Auth y almacenamiento) y destapó D-O10-15.
- **Importación de 18,000 filas** (integración, local):
  - validar cada parte: 1.2 a 1.9 s;
  - aplicar las partes 1 y 2, fallar la 3.ª y publicar: 76 s;
  - recuperar la caída del worker y aplicar las partes 3 y 4 con publicación: 47 s;
  - por la interfaz (E2E), 2.8 min de punta a punta.

Suites al cierre (local, 2026-11-13), contra el cierre del bloque 1 (`dad8be5`):

| Suite                             | Bloque 1               | Mensaje 4                                     |
| --------------------------------- | ---------------------- | --------------------------------------------- |
| Unit (lint, formato, tipos, unit) | 1,334                  | 1,366                                         |
| Compilación                       | verde                  | verde                                         |
| pgTAP                             | 2,999 (145 archivos)   | 3,157 (149 archivos)                          |
| Integración                       | 438                    | 447 (38 archivos)                             |
| E2E                               | 157/157                | 162/162 (24.7 min)                            |
| `pnpm audit --prod`               | sin vulnerabilidades   | sin vulnerabilidades; sin dependencias nuevas |
| Ensayo de migraciones             | 6 migraciones, 109/109 | 10 migraciones, 307/307                       |
| Ensayo de implementación          | 4/4                    | 4/4, sin hallazgos                            |

Aislamiento entre tiendas en este bloque:

- pgTAP `144` a `147` (otra tienda: `forbidden` o `not_found`; RLS de las tablas nuevas) y `00_schema_security`;
- integración de 18,000 filas (otra tienda no ve el lote ni sus partes y no puede aplicarlo, cancelarlo ni subirle partes);
- concurrencia de categorías.

## Orden 10, mensaje 5 (2026-11-14): cierre de observaciones antes de staging

Partida: `4c5c332`, dictamen «APROBADO CON OBSERVACIONES».

| Hallazgo                   | Estado                        | Qué se hizo                                                                                                                                                                                           |
| -------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 (ALTO) cron             | Preparado, no activo          | Plan de Vercel no verificable. `vercel.json` sigue diario, porque en Hobby uno más frecuente rompe el despliegue. Plantilla `pg_cron` con firma probada. Prueba de cadencia con límites de producción |
| A2 (ALTO) ventana          | Corregido en el procedimiento | Runbook §11 con 12 pasos y criterios para detenerse; guiones `ventana/` probados en el ensayo; E2E del código anterior con la base nueva 17/17; contingencia probada                                  |
| M1 (MEDIO) reversa 0400    | Corregido                     | Guion y verificador versionados; pérdida de datos documentada                                                                                                                                         |
| M2 (MEDIO) D8              | Corregido en código           | 5 páginas y 2 webhooks con `maxDuration = 60`; prueba que lo vigila                                                                                                                                   |
| M3 (MEDIO) evidencia local | No verificable aquí           | Requiere staging                                                                                                                                                                                      |
| B1–B6, I1–I2               | Sin cambio                    | B1 y B2 esperan al piloto (D-O10-20)                                                                                                                                                                  |

Corrección a la auditoría: las alertas de cola sí existen (Consola → Salud). Lo que falta es el correo (Resend).

Suites al cierre del mensaje 5 (local, 2026-11-14, sobre `5597a61` + documentos):

| Suite                                      | Resultado                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| verify (lint, formato, tipos, unit, build) | 1,381                                                                     |
| pgTAP                                      | 3,157 (149 archivos)                                                      |
| Integración                                | 454 (41 archivos, 3 nuevos)                                               |
| E2E                                        | 162/162 (23.5 min)                                                        |
| Ensayo de las 10 migraciones               | 307/307; ventana `01-antes` 6 y `02-despues` 7 en verde; esquema idéntico |
| Reversa de la 0400 (`comprobar-0400.sh`)   | esquema idéntico al de `0300`                                             |
| E2E de `88edc6d` contra la base con las 10 | 17/17                                                                     |
| `pnpm audit --prod`                        | sin vulnerabilidades                                                      |
