# Pulido · Revisión adversarial del Paso 1

**Fecha:** 2026-10-21 · **Alcance:** commits `de5d6f8`..`6fa7660` (confirmación de acciones destructivas, `useSafeActionState`, plantilla «En blanco», vista previa de Google y consola en el celular). **Revisor:** agente independiente sin poder modificar el código; leyó el árbol de trabajo (no pudo usar git). Las correcciones y sus pruebas son de esta sesión.

## Resultado

Sin violaciones de las reglas de `CLAUDE.md` (RLS, autoridad del cliente, secretos, HTML del comerciante). 11 hallazgos: 1 alto, 4 medios y 6 bajos.

| #   | Severidad | Hallazgo                                                                                                                                                                           | Estado                                                                                                                                                       |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | Alta      | La confirmación se quedaba abierta tras un envío exitoso: en el reembolso, un «Sí» posterior pedía otro reembolso por el saldo restante, con clave nueva y sin preguntar de nuevo. | **Corregido.** La pregunta se cierra al terminar la acción y el foco vuelve al botón. Prueba unitaria y E2E `order-ops`.                                     |
| H2  | Media     | La pregunta del reembolso decía «por el monto indicado» y el monto se podía cambiar con «Sí» a la vista.                                                                           | **Corregido.** La pregunta dice el monto («¿Reembolsar 100.50 (máximo …)?») y se cierra si cambia cualquier campo. Unitarias y E2E `order-ops`.              |
| H3  | Media     | `useSafeActionState` trataba como sensible todo nombre con «code»: el código de un cupón o un código postal se perdían tras un error.                                              | **Corregido.** Se compara por segmento del nombre (`password`, `token`, `secret`, `otp`, `totp`). Prueba unitaria con `code` y `otp_code`.                   |
| H4  | Media     | Equipo: sin red, Suspender, Quitar, Restablecer 2FA, Revocar y cambiar rol cambiaban la pantalla por la de error.                                                                  | **Corregido.** Aviso en un toast; `redirect()` y `notFound()` siguen pasando.                                                                                |
| H5  | Media     | Casillas, radios y el rol de la invitación no se rellenaban con lo enviado; además se guardaba el primer valor repetido (el `hidden` «0» de una casilla).                          | **Corregido.** Gana el último valor; impuestos (radios y casilla), categoría (visible), tarifa (activa) y rol de la invitación se rellenan. Prueba unitaria. |
| H6  | Baja      | El error atrapado no quedaba en ningún registro.                                                                                                                                   | **Corregido.** `console.error` en el navegador.                                                                                                              |
| H7  | Baja      | Tras un fallo de red se arrastraban errores de campo del intento anterior.                                                                                                         | **Corregido.** El estado de error parte de cero. Prueba unitaria.                                                                                            |
| H8  | Baja      | Foco: con «Sí» deshabilitado en carga, Escape no cancela.                                                                                                                          | **Mitigado.** Al terminar, la pregunta se cierra y el foco vuelve al botón (H1).                                                                             |
| H9  | Baja      | Pruebas cuyo título no coincidía con lo que comprobaban (p. ej. «Sí deshabilitado en carga»).                                                                                      | **Corregido.** Las pruebas de `ConfirmButton` abren la pregunta y miran «Sí».                                                                                |
| H10 | Baja      | «Lo que ya tengas no se borra» era falso: aplicar una plantilla reemplaza colores y portada del borrador, sin confirmación.                                                        | **Corregido.** Texto exacto y confirmación con el nombre de la plantilla. E2E `store-templates`.                                                             |
| H11 | Baja      | La tienda (carrito, pago, cuenta) y el acceso siguen con `useActionState`.                                                                                                         | **Decisión documentada** (abajo).                                                                                                                            |

## Decisión sobre H11

El pago y el acceso tienen flujos propios con secretos (contraseña, código) e idempotencia del pedido; cambiarlos exige revisar el contrato del checkout (GATE0 §43). Quedan fuera de este paso; se registran como pendiente técnico.

## Pruebas

verify 863 (antes 849), unitarias nuevas de `ConfirmButton` (7) y `useSafeActionState` (7), E2E `order-ops`, `store-templates`, `team`, `panel-resilience`, `catalog`, `supplement-categories`, `launch` y `checkout` en verde.
