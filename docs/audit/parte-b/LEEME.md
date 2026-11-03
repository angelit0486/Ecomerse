# Parte B · Portada de imágenes (2026-11-03)

Interruptor `hero_image_carousel`, **apagado por defecto**, por tienda.

## Qué hace

**En la tienda** (solo con el interruptor encendido):

- Muestra solo imágenes, sin texto visible.
- Cada imagen tiene:
  - imagen de computadora y, opcional, de celular;
  - punto focal;
  - texto alternativo obligatorio (no visible, para lectores de pantalla y buscadores);
  - destino y fechas, opcionales.
- Avanza sola cada 4 s (configurable de 3 a 10) y en bucle.
- Se puede deslizar con el dedo o con el mouse; al hacerlo, el temporizador se reinicia y sigue.
- Transición deslizar o desvanecer, puntos siempre y flechas opcionales.
- Un botón pequeño pausa y reanuda el avance.
- Con «reducir movimiento», no avanza sola ni anima.
- La primera imagen se pide con prioridad alta y las demás de forma diferida.
- El espacio queda reservado con la proporción elegida (CLS 0).

**En el panel** (Apariencia → Portada → «Nuevo bloque» → «Portada de imágenes»; solo con el interruptor encendido):

- Subir varias imágenes de una vez, desde la galería del celular.
- Subir, bajar, duplicar y quitar imágenes.
- Tamaño recomendado y aviso de baja resolución.
- Vista previa en vivo en celular y computadora.
- Borrador con autoguardado, publicar, historial y restaurar: los del editor de siempre.

## Evidencia [VERIFICADO en local]

| Comprobación                                                                                                                              | Resultado                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Pruebas de componente (avance, bucle, deslizar reinicia, pausa, reducir movimiento, accesibilidad)                                        | 10/10                                                           |
| pgTAP 122 (validación, imágenes solo de la propia tienda, vigencia, cumplimiento del texto alternativo, interruptor por tienda)           | 20/20                                                           |
| E2E `image-carousel` (panel → publicar → tienda en celular; avance a 4 s, deslizar, pausa, CSP sin violaciones, axe, interruptor apagado) | pasa                                                            |
| Interruptor apagado: 10 pantallas de la tienda contra la referencia de `255fa7f` (fotos tapadas)                                          | idénticas                                                       |
| LCP con perfil móvil emulado (4G lenta, CPU ×4), 3 corridas                                                                               | encendido 884–936 ms; portada actual 872–936 ms; CLS 0 en ambos |

Capturas: `encendido-375.png` (imagen de celular) y `encendido-1280.png`. Con el interruptor apagado, `apagado-*-comparar.png` son idénticas a `docs/audit/referencia/comparar/portada-*.png`.

## No verificado o pendiente

- **Lighthouse ≥ 95 [NO VERIFICADO]:** este entorno no permitió descargar Lighthouse. El LCP de arriba se midió en local, con imágenes de prueba de unos 10 KB; con fotos reales y en Vercel será mayor.
- **AVIF:** no se generan. Las copias que ya existen son WebP de 320 a 1280 px (`srcset`); para más ancho se usa el original. Generar AVIF es cambiar el procesamiento de imágenes (lote 3 d), que quedó para tu aprobación aparte.
- **Staging:** solo la tienda de pruebas `demo2`, y verla requiere que Vercel sirva la rama `mejoras/2026-11`.

## Reversa

- Al instante, sin desplegar: `update public.feature_flags set kill_switch = true where key = 'hero_image_carousel';`.
- Por tienda: borrar su fila en `feature_flag_overrides`.
- Código: `git revert` de los commits del paso 1 al 3. La migración `20261103000200` es aditiva: un bloque guardado no afecta a los demás y, apagado, no se dibuja.
