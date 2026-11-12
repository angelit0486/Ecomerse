# PRUVA — Preparación comercial (Orden 08, 2026-11-12)

**Objetivo comercial**: visitar un comercio físico, ofrecerle PRUVA y entregarle en **cinco días hábiles** una tienda en línea profesional y operando.

**Giros objetivo** (pedido del propietario, 2026-11-12):

- ropa, calzado y accesorios;
- hogar, belleza y regalos;
- abarrotes y suplementos pequeños.

En los tres casos, **hasta 10,000 productos**.

Etiquetas: **[VERIFICADO]**, **[ESTIMADO]**, **[NO VERIFICADO]** y **[PROPUESTA]**, como en el resto de la auditoría.

## 1. Dictamen comercial

**NO APTO TODAVÍA para vender a un comercio que cobre a sus clientes.**

Ningún bloqueo es de diseño. Son seis condiciones externas que solo el propietario puede cumplir:

1. producción;
2. correo;
3. pago real;
4. cola frecuente;
5. respaldos;
6. revisión legal.

Las cinco primeras corresponden a RSK-01 a RSK-04 y RSK-08; la sexta, a RSK-09.

Al cerrarlas, el producto queda **apto para pilotos controlados** con los tres giros objetivo y catálogos de hasta ~1,000 productos. Más tamaño necesita las tareas P1 de la sección 5.

## 2. Encaje con los giros objetivo [VERIFICADO en el código]

| Necesidad del giro                          | ¿Existe?                                                                   | Evidencia                                    |
| ------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| Variantes por talla y color (ropa, calzado) | Sí: hasta 3 opciones y 100 variantes                                       | F-17, `catalog.spec`                         |
| Plantilla visual por giro                   | Sí: ropa, belleza, hogar, regalos, abarrotes, suplementos, joyería y 7 más | F-52, `src/lib/templates/store-templates.ts` |
| Presentaciones, contenido neto y porciones  | Sí                                                                         | ADR-026, `variant-servings.spec`             |
| Suplementos con ficha sanitaria             | Parcial: bloqueado hasta capturar las reglas                               | F-27, RSK-14                                 |
| Productos físicos con envío                 | Sí                                                                         | F-59                                         |
| Pago con tarjeta                            | Sí, simulado                                                               | F-61, RSK-03                                 |
| OXXO o transferencia de Mercado Pago        | No (quitados por ADR-059)                                                  | F-62                                         |
| Transferencia manual                        | Sí                                                                         | F-60                                         |
| Factura (CFDI)                              | No                                                                         | F-67                                         |
| Guía de paquetería automática               | No: sin cuenta de Skydropx                                                 | F-66                                         |

## 3. Proceso de implementación: de la visita a la tienda operando

Para cada paso: qué existe hoy y quién lo hace.

| #   | Paso                                                  | Hoy                                                                                          | Tipo                                | Quién                 |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------- |
| 1   | Presentar PRUVA al comercio                           | Kit de venta en `docs/venta/` (resumen técnico, riesgos, paquetes)                           | Manual                              | Propietario           |
| 2   | Contrato, precio y plan                               | Sin precios de planes (ADR-044 pendiente); textos legales sin revisar                        | **No existe**                       | Propietario y abogado |
| 3   | Crear la organización y la tienda                     | Desde la consola (`platform_add_store`) o el panel (`org_create_store`)                      | Automatizado                        | Plataforma            |
| 4   | Dirección temporal `pruva-tienda-<nombre>.vercel.app` | Se genera sola; el alta en Vercel es manual sin `VERCEL_DOMAINS_TOKEN`                       | Semiautomático                      | Plataforma            |
| 5   | Invitar al comercio a su panel                        | Invitación por correo, pero el correo no sale (RSK-02); se puede usar contraseña (ADR-031)   | Bloqueado sin correo                | Plataforma            |
| 6   | Elegir plantilla, logo, colores y portada             | Plantillas por giro, editor de portada, logo                                                 | Automatizado                        | Comercio o plataforma |
| 7   | Crear el árbol de categorías                          | Viene con la plantilla; la importación **no crea** categorías nuevas (RSK-13)                | Manual                              | Plataforma            |
| 8   | Recibir el catálogo del comercio                      | Plantilla CSV descargable, hoja simple, archivos de Shopify o Tiendanube                     | Manual                              | Comercio              |
| 9   | Limpiar el archivo                                    | Sin revisor previo (F-39 parcial): los errores aparecen al subir                             | **Manual y lento**                  | Plataforma            |
| 10  | Importar productos                                    | Todo o nada; 5,000 filas por archivo; 23–30 s cada uno (local)                               | Automatizado, con límite            | Plataforma            |
| 11  | Fotos                                                 | Por enlace del archivo, en lote por SKU o por carpeta; la cola procesa una a la vez (RSK-05) | Automatizado, sin medir a escala    | Plataforma            |
| 12  | Precios, ofertas y existencias                        | Por archivo o en bloque                                                                      | Automatizado                        | Comercio o plataforma |
| 13  | Envíos (zonas y tarifas)                              | Configurables a mano                                                                         | Manual                              | Comercio o plataforma |
| 14  | Conectar el cobro                                     | Mercado Pago por OAuth (simulado) o transferencia                                            | Bloqueado sin credenciales (RSK-03) | Comercio              |
| 15  | Textos legales de la tienda                           | Plantillas en borrador que se completan                                                      | Manual; sin revisar (RSK-09)        | Comercio y abogado    |
| 16  | Dominio propio (opcional)                             | Verificación TXT y alta en Vercel                                                            | Semiautomático                      | Comercio y plataforma |
| 17  | Prueba de compra y lanzamiento                        | Checklist de lanzamiento (`launch.spec`)                                                     | Manual                              | Plataforma            |
| 18  | Capacitación                                          | Ayuda en el panel (`panel_help`, apagado)                                                    | Automatizado                        | Comercio              |
| 19  | Soporte y mantenimiento                               | Consola, acceso de soporte auditado, salud                                                   | Automatizado                        | Plataforma            |

## 4. ¿Se puede entregar en cinco días hábiles?

| Escenario                                               | Hoy                                                                  | Tras P0 y P1 del roadmap                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Hasta 1,000 productos, archivo limpio, fotos por enlace | **No**: sin correo, sin cobro real, sin producción ni cola frecuente | **Sí** [ESTIMADO]: un archivo, importación en segundos, cientos de fotos en horas con cron cada minuto |
| Hasta 1,000 productos, archivo desordenado              | No                                                                   | Probable (2 a 3 días de limpieza) [ESTIMADO]; el revisor de archivo (RM-12) reduce ese tiempo          |
| 10,000 productos sin variantes                          | No                                                                   | Probable [ESTIMADO]: 2 archivos de 5,000; la importación está medida, las fotos no                     |
| 10,000 productos con tallas (≈18,000 filas)             | No                                                                   | Incierto: 4 archivos sin la importación por partes (RM-11); fotos **sin medir** (RM-10)                |

**Medido** (local, 4 núcleos):

- importar 5,000 filas tarda de 23 a 30 s;
- una tienda de 10,000 productos responde al comprador en menos de 160 ms y al panel en menos de 70 ms (salvo el reporte de calidad);
- 500,000 productos en 50 tiendas, sin degradación para el comprador.

**No medido**:

- cuánto tardan 10,000 fotos;
- cualquier cifra en Supabase o Vercel reales.

## 5. Brechas para comercializar, por etapa

### Para el primer piloto (P0)

1. Producción separada en Supabase Pro con PITR, Vercel y dominio (RSK-01, RSK-08).
2. Correo con Resend y Send Email Hook (RSK-02).
3. Mercado Pago real: escenarios en modo prueba y una compra con reembolso (RSK-03).
4. Cola cada minuto con `CRON_SECRET` (RSK-04).
5. Aplicar las 5 migraciones pendientes y desplegar el código corregido (RSK-06, RSK-07).
6. Revisión legal (RSK-09).
7. Plan y precio para la tienda piloto (RSK-11).

### Para entregar tiendas de 10,000 productos en cinco días (P1)

8. Medir el procesamiento de fotos (RM-10).
9. Importación por partes en el servidor (RM-11, requiere ADR).
10. Revisor de archivo con un solo reporte (RM-12).
11. Crear categorías al importar o desde la plantilla (RM-13).
12. Plantilla de importación por giro (RM-14).
13. Guion de implementación de 5 días (RM-15).

### Para operar varias tiendas (P1 y P2)

14. Monitoreo de errores (RSK-15).
15. Topes de gasto (RSK-16).
16. Firewall (RSK-19).
17. Precios y cobro de planes con Stripe real (F-08).
18. Repositorio privado con un solo titular (RSK-10).

### Para escalar (P2 y P3)

19. Guías Skydropx (F-66).
20. CFDI con Facturapi (F-67).
21. Tiendas de más de 10,000 productos (CAP-12).
22. Escalones de 1 a 5 millones de productos en un entorno aislado (requiere presupuesto).

## 6. Dependencias del cliente, por tienda

- Catálogo en CSV o Excel con SKU, precio y categoría.
- Fotos (enlaces, carpeta o archivos con el SKU en el nombre).
- Logo y colores.
- Cuenta de Mercado Pago del comercio, o datos para transferencia.
- Datos legales: razón social, domicilio y política de devoluciones.
- Tarifas de envío.
- Dominio propio, opcional (acceso a su DNS).
- Para suplementos: registros sanitarios y leyendas.
