# Modelo comercial y costos (Orden 09, 2026-11-12)

Propuesta para decidir precios. **Nada de este documento es un precio definitivo**: los planes y cuotas son [PROPUESTA] y dependen de dos datos que solo tiene el propietario (cuánto vale su hora y cuántas tiendas espera vender).

Etiquetas: **[VERIFICADO]** leído hoy en la página oficial; **[MEDIDO]** medido en este proyecto; **[ESTIMADO]** cálculo; **[SUPUESTO]** dato que hay que confirmar; **[PROPUESTA]** por decidir.

## 1. Costos de infraestructura [VERIFICADO el 2026-11-12]

Precios en dólares, sin impuestos, de las páginas oficiales.

| Servicio                          | Plan                                        | Costo fijo al mes                                        | Qué incluye                                                                   | Excedente                                                       |
| --------------------------------- | ------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Supabase (`supabase.com/pricing`) | Pro                                         | 25 USD (incluye el cómputo Micro)                        | 8 GB de base, 100 GB de archivos, 250 GB de salida, respaldo diario de 7 días | Base: 0.125 USD/GB. Archivos: 0.021 USD/GB. Salida: 0.09 USD/GB |
| Supabase                          | Cómputo mayor                               | Small 15, Medium 60, Large 110 USD (menos 10 de crédito) | Más memoria y conexiones                                                      | —                                                               |
| Supabase                          | Recuperación a un punto en el tiempo (PITR) | 100 USD por cada 7 días de retención                     | Volver a cualquier minuto                                                     | —                                                               |
| Vercel (`vercel.com/pricing`)     | Pro                                         | 20 USD (1 asiento, con 20 USD de crédito de uso)         | Cron **cada minuto** (en Hobby, una vez al día)                               | Uso por encima del crédito                                      |
| Resend (`resend.com/pricing`)     | Pro                                         | 20 USD                                                   | 50,000 correos al mes                                                         | 0.90 USD por 1,000                                              |
| Resend                            | Gratis                                      | 0                                                        | 3,000 al mes, 100 al día                                                      | —                                                               |

Mercado Pago (`mercadopago.com.mx`, Checkout) lo paga **el comercio**, no PRUVA: 3.49 % + 4 MXN + IVA con el dinero al instante; 3.19 % a 14 días; 2.95 % a 30 días.

No verificados: Sentry, dominio, Skydropx, Facturapi y el uso de Vercel por encima del crédito.

## 2. Qué consume cada tienda

| Recurso        | Consumo                                                                                       | Clase                                         |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Base de datos  | 55 MB por tienda de 10,000 productos con 2,000 pedidos (escalón D: 2,731 MB entre 50 tiendas) | MEDIDO                                        |
| Fotos          | ~0.4 MB por foto con sus copias; 10,000 fotos ≈ 4 GB                                          | ESTIMADO (falta medir con fotos reales)       |
| Procesar fotos | 0.25 s por foto de catálogo; 1.0 s por foto de celular                                        | MEDIDO (local, sin la red del almacenamiento) |
| Correos        | 3 a 5 por pedido                                                                              | ESTIMADO (del código)                         |

Con esos consumos, los 8 GB de base incluidos alcanzan para unas 140 tiendas de 10,000 productos, y los 100 GB de archivos para unas 25 tiendas con 10,000 fotos cada una [ESTIMADO]. Pasado eso, cada tienda grande agrega centavos de dólar al mes.

**Conclusión: la infraestructura no es el costo que decide el precio.** Lo decide el tiempo de implementación y de soporte.

## 3. Costo fijo de la plataforma

Tipo de cambio de trabajo: 20 MXN por dólar [SUPUESTO; confirmar al decidir].

| Escenario           | Componentes                            | USD al mes                    | MXN al mes  |
| ------------------- | -------------------------------------- | ----------------------------- | ----------- |
| Mínimo para pilotos | Supabase Pro + Vercel Pro + Resend Pro | 65                            | 1,300       |
| Con PITR            | Lo anterior + PITR de 7 días           | 165                           | 3,300       |
| ~50 tiendas         | Lo anterior con cómputo Medium         | 215                           | 4,300       |
| ~200 tiendas        | Cómputo Large y más archivos           | 300–400 [ESTIMADO, sin medir] | 6,000–8,000 |

Costo de infraestructura por tienda [ESTIMADO]:

| Tiendas | MXN por tienda al mes |
| ------- | --------------------- |
| 5       | 660                   |
| 10      | 330                   |
| 25      | 132                   |
| 50      | 86                    |
| 200     | 30–40                 |

## 4. El costo que sí importa: horas de implementación

Tiempos de máquina [MEDIDO en local]: importar 5,000 filas, 23–30 s; 1,000 fotos de catálogo, ~4 minutos de cola.

Tiempos de persona [ESTIMADO; se medirán en el piloto]:

| Tienda                                                   | Horas de implementación |
| -------------------------------------------------------- | ----------------------- |
| Hasta 500 productos, hoja limpia                         | 6–10                    |
| Hasta 3,000 productos                                    | 12–20                   |
| Hasta 10,000 productos o migración desde otra plataforma | 24–40                   |

Soporte mensual por tienda [SUPUESTO]: 0.5 a 2 horas.

## 5. Referencia de mercado [VERIFICADO el 2026-11-12]

Tiendanube México (`tiendanube.com/mx/planes-y-precios`): Gratis, 149, 374 y 999 MXN al mes. Además cobra de 0.5 % a 2 % por venta si no se usa su medio de pago. Es autoservicio: el comercio configura y carga todo.

PRUVA no compite por precio de mensualidad: vende la tienda **ya configurada y cargada**. El precio debe cobrar ese servicio.

## 6. Propuesta de planes [PROPUESTA]

Sin comisión por venta: es un argumento de venta frente a la referencia.

|                               | Básico                                                                 | Profesional                                                         | Avanzado                                                       |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Productos                     | 1,000                                                                  | 5,000                                                               | 10,000                                                         |
| Personas del equipo           | 2                                                                      | 5                                                                   | 10                                                             |
| Almacenamiento                | 2 GB                                                                   | 10 GB                                                               | 25 GB                                                          |
| Mensualidad (MXN)             | 399–499                                                                | 799–999                                                             | 1,499–1,999                                                    |
| Implementación, una vez (MXN) | 2,500–4,000                                                            | 6,000–9,000                                                         | 12,000–20,000                                                  |
| Incluye                       | Tienda, plantilla del giro, carga del catálogo, capacitación de 1 hora | Lo anterior + dominio propio, devoluciones, reporte de rentabilidad | Lo anterior + migración desde otra plataforma y carga de fotos |

Servicios aparte [PROPUESTA], para que las tiendas de más consumo no vuelvan insostenible el negocio:

- carga adicional de catálogo o fotos, por bloque de 1,000 productos;
- limpieza de un archivo desordenado, por hora;
- sesiones de fotografía o edición de fotos (tercero);
- almacenamiento adicional, por cada 10 GB;
- dominio propio (lo paga el comercio);
- soporte prioritario.

## 7. Escenarios [ESTIMADO]

Supuestos: hora de implementación y soporte a 250 MXN; mezcla de planes 60 % Básico, 30 % Profesional y 10 % Avanzado; precios en el punto bajo de cada rango; costos fijos de la sección 3.

|                                                         | Conservador | Base       | Optimista   |
| ------------------------------------------------------- | ----------- | ---------- | ----------- |
| Tiendas activas al mes 12                               | 10          | 30         | 80          |
| Ingreso recurrente mensual                              | 6,290       | 18,870     | 50,320      |
| Infraestructura mensual                                 | 3,300       | 4,300      | 5,000       |
| Soporte mensual (1 h por tienda)                        | 2,500       | 7,500      | 20,000      |
| **Margen mensual recurrente**                           | **490**     | **7,070**  | **25,320**  |
| Ingreso por implementaciones del año                    | 45,000      | 135,000    | 360,000     |
| Horas de implementación del año (8, 16 y 32 h por plan) | 128         | 384        | 1,024       |
| Costo de esas horas                                     | 32,000      | 96,000     | 256,000     |
| **Margen de las implementaciones**                      | **13,000**  | **39,000** | **104,000** |

Lectura:

- Con 10 tiendas el recurrente apenas cubre la infraestructura con PITR: la cuota de implementación es la que paga el arranque.
- El margen recurrente depende sobre todo de las horas de soporte por tienda. Bajar de 1 hora a media hora duplica el margen del escenario base.
- Cada hora de implementación ahorrada (plantillas por giro, hoja con tallas, fotos en lote) es margen directo.

## 8. Lo que falta para cerrar precios

1. El valor real de la hora de quien implementa y da soporte [propietario].
2. Horas de implementación **medidas** en el piloto, por giro.
3. Horas de soporte por tienda en los primeros 3 meses.
4. Tipo de cambio y forma de facturar.
5. Costo de adquisición por cliente (visitas y cierre): sin datos todavía.
