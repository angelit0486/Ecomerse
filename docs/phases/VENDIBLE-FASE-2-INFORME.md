# Misión vendible · Fase 2 · Estudio de diseño (2026-10-29)

Objetivo: que una tienda recién creada con una plantilla se vea profesional el primer día, en cualquier pantalla, sin depender de fotos. Detalle: `docs/design/AUDITORIA-F2.md` (auditoría, plan, crítica y capturas antes/después en `docs/design/f2/`).

## Qué cambió para quien vende tiendas

| Antes                                                    | Ahora                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| 4 giros (Suplementos, Ropa, Belleza, Abarrotes)          | **6 giros**: + Hogar y decoración, + Mascotas (más Genérica y En blanco) |
| Hero sin foto = bloque de color plano                    | Hero con los objetos del giro sobre una repisa («Anaquel ilustrado»)     |
| Categorías sin foto = una letra («P P S A»)              | Cada categoría con su objeto dibujado                                    |
| Productos sin foto = caja gris «Sin imagen»              | El objeto que corresponde al producto, tenue                             |
| Buscador «¿Qué estás buscando?»                          | «Buscar en {nombre de la tienda}»                                        |
| 3 beneficios pegados a la izquierda en escritorio        | Llenan la fila                                                           |
| En el celular la foto tapaba la ruta de navegación larga | Corregido                                                                |

Los dibujos son código de la plataforma (28 objetos en un solo trazo), no imágenes subidas por el comerciante: no se abre la puerta a SVG de terceros (regla 13). Con foto, nada de esto aparece.

## Pruebas al cierre

| Suite                     | Resultado                                                                   |
| ------------------------- | --------------------------------------------------------------------------- |
| `pnpm verify` (unitarias) | 1,018/1,018 [VERIFICADO]                                                    |
| pgTAP + integración       | 2,440 + 362 [VERIFICADO]                                                    |
| E2E (Playwright + axe)    | 110/110 en la primera ronda [VERIFICADO]                                    |
| Diseño a 5 anchos         | 6 plantillas × 360/375/768/1280/1920 px sin desborde y con axe [VERIFICADO] |

## Lighthouse (móvil, local, 2 corridas por página)

| Tienda | Página  | Rendimiento                   | Acc. | BP  | SEO |
| ------ | ------- | ----------------------------- | ---- | --- | --- |
| demo   | inicio  | 96 (80 en la corrida en frío) | 100  | 100 | 100 |
| demo   | listado | 92–93                         | 100  | 100 | 100 |
| demo2  | inicio  | 94–95                         | 100  | 100 | 100 |
| demo2  | listado | 94–98                         | 100  | 100 | 100 |

**La meta de 95 en rendimiento no se cumple en todas las páginas** (listado de demo: 92–93, igual que antes de esta fase: 93–95 el 2026-10-27). La imagen principal ya se precarga con prioridad alta, tiene `srcset` y la conexión al servidor de fotos se abre por adelantado; lo que queda es la red simulada (LCP 3.1 s) y la variación de medir en este contenedor. No hay regresión. **Panel:** no cambió en esta fase; la última medición (2026-10-27) dio Buenas prácticas 100. Lighthouse contra staging real: [NO VERIFICADO] (este contenedor no alcanza Vercel).

## Revisión adversarial

1. **¿Un objeto equivocado avergüenza a la tienda?** Las palabras clave tienen trampas probadas («botanas» no es «botas», «botas de piel» no es cuidado facial, «maceta con plato» no es plato de mascota). Sin coincidencia se usa una bolsa o una etiqueta, que sirven para cualquier giro. Riesgo residual: nombres ambiguos; es un respaldo hasta que el comerciante suba fotos.
2. **¿Los dibujos bajan el contraste del texto del hero?** Van debajo del texto, en el borde inferior, con el trazo al 35 % del color de contraste; el texto no cambia y axe no reporta problemas en ningún ancho.
3. **¿Cuesta rendimiento?** Son unas decenas de trazos en el HTML, sin peticiones ni JavaScript nuevos.
4. **¿Las plantillas nuevas cumplen las reglas de la base?** Pasan la misma validación (tema, portada, contraste AA, límites, textos sin promesas) que las demás; se aplican con la misma función, sin migraciones.
5. **Hallazgo colateral corregido:** la ruta de navegación tapada en el celular; la prueba nueva falla sin el arreglo (rojo comprobado).

## Pendiente (Fase 2)

- Fotos reales de ejemplo por giro: se descartaron a propósito (serían iguales en todas las tiendas y el comerciante debe reemplazarlas).
- Hero «EJEMPLO» de la demo de staging: se reemplaza desde Apariencia → Portada → Hero → imagen; es dato de staging, no de las plantillas.
