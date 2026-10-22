# Revisión adversarial · Misión Portada/Marcas · Paso 3 (editor completo de la portada)

Fecha: 2026-10-22. Alcance: commits 85bbd60 (tema v3, carrusel, barra apagada, publicar con confirmación y deshacer) y 6b44a22 (plantillas y autoguardado), más el arreglo de rendimiento y el mínimo de fecha de las ofertas de este cierre.
Enfoque: seguridad, XSS, aislamiento entre tiendas, permisos, pérdida de datos, accesibilidad y rendimiento.

> El agente revisor automático se detuvo por límite de uso antes de terminar; esta revisión la hice directamente sobre el código y las pruebas.

## Resultado

**Sin hallazgos de seguridad ni de aislamiento.**

- **Portadas extra (`slides`).** Las valida `app.home_hero_slide_valid`, que acepta solo las llaves `heading`, `subheading`, `image_media_id`, `mobile_image_media_id` y `cta`.
  - Los textos son texto plano y React los escapa.
  - Los enlaces pasan por `home_cta_valid`, que rechaza `javascript:`.
  - Las imágenes deben ser banners listos de la misma tienda (`theme_reference_issues`).
  - pgTAP 95 cubre el script, `javascript:`, la imagen de otra tienda y las llaves extra.
- **Permisos.** «Deshacer la última publicación» usa las mismas RPC que «Restaurar» y «Publicar», con su permiso y su candado de revisión. No hay ninguna función nueva expuesta: `app.home_hero_slide_valid` no se concede a nadie (pgTAP 95).
- **`preconnect`.** Solo anuncia el origen público del almacenamiento, que ya aparece en cada `<img>`.

## Hallazgos y decisiones

| ID    | Severidad | Qué                                                                                                                                                                    | Estado                                                                                                                                           |
| ----- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P3-M1 | Media     | Un enlace escrito sin la diagonal («categoria/proteinas») se guardaba como `https://categoria/proteinas`, una dirección rota.                                          | Corregido en `normalizeLink`: sin punto antes de la primera «/» es una ruta de la tienda. Pruebas en `patch.test.ts` y `home-normalize.test.ts`. |
| P3-M2 | Media     | «Volver a como estaba» de las plantillas restauraba el último guardado, porque el autoguardado actualiza `initial`, y no lo que había al abrir el editor.              | Corregido: se guarda una copia al abrir. Lo cubre el E2E `home-templates`.                                                                       |
| P3-M3 | Media     | La imagen principal viene de otro dominio (almacenamiento) y la conexión se abría tarde, lo que retrasa el LCP en el celular.                                          | Mitigado: `<link rel="preconnect">` en el `<head>` de la tienda. `preload()` de `react-dom` no llegaba al HTML en Next 16, así que se descartó.  |
| P3-B1 | Baja      | «Deshacer» son dos pasos (restaurar y luego publicar). Si la versión anterior ya no pasa la revisión de cumplimiento al publicar, queda en el borrador sin publicarse. | Aceptado: no se pierde nada, porque lo publicado sigue igual y el mensaje dice qué revisar.                                                      |
| P3-B2 | Baja      | El autoguardado de un cambio grande puede ocurrir mientras se sigue escribiendo.                                                                                       | Aceptado: lo escrito después se guarda en la siguiente vuelta. Nunca publica, y si falla no reintenta en bucle.                                  |
| P3-B3 | Baja      | Ofertas programadas: el selector de fecha permitía horas pasadas que la base rechaza (4 rechazos en los registros de staging).                                         | Corregido: `min` con la hora actual de la tienda al abrir el selector (`localInputNow`, con pruebas unitarias).                                  |

## Accesibilidad

- **Carrusel.**
  - Botón «Pausar portadas».
  - Se detiene al pasar el mouse o al enfocar, y no rota con «reducir movimiento» (WCAG 2.2.2).
  - Las portadas ocultas quedan `hidden` e `inert`; sin JavaScript se ve la primera.
  - Las flechas y los puntos miden 44 px.
  - Lo verifican el E2E `home-hero-v3` y axe sin violaciones a 375 px.
- **Panel.**
  - El interruptor «Mostrar el anuncio en la tienda», las plantillas (radios con su descripción) y el indicador de autoguardado (`aria-live`) pasan axe.
  - «Publicar» y «Deshacer» piden confirmación dentro de la página.

## Rendimiento (Lighthouse móvil, portada de la tienda local `demo`)

| Medición                                                                     | Rendimiento       | LCP       | Accesibilidad / Prácticas / SEO |
| ---------------------------------------------------------------------------- | ----------------- | --------- | ------------------------------- |
| Versión anterior (15e06ee), 2 corridas válidas                               | 98 y 92           | 2.2–3.3 s | —                               |
| Tema v3, una portada                                                         | 96, 92 y 94       | 2.7–3.3 s | 100 / 100 / 100                 |
| Tema v3, foto de fondo y 2 portadas que rotan, con `preconnect` (7 corridas) | 91–99, mediana 93 | 2.0–3.4 s | 100 / 100 / 100                 |

La variación viene de la simulación de Lighthouse en este contenedor: las descargas son idénticas entre una corrida rápida y una lenta. **No se puede afirmar ≥ 95 de forma estable aquí.** Hay que medir en staging con PageSpeed una vez desplegado.

## Verificación

- `pnpm verify`: 910 pruebas y build OK (antes de este cierre).
- `pnpm db:test`: pgTAP 2293 (97 archivos) e integración 335.
- E2E completa: **90/90** (12.2 min), con `home-hero-v3`, `home-templates`, `brands` e `imports`.
