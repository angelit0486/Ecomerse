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
