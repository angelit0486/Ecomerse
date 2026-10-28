# Misión vendible · Fase 1 · Informe de cierre parcial (2026-10-28)

Fase 1 = desbloqueo y confiabilidad. Este informe cierra **lo que no depende del propietario**. Lo que sí depende de él queda listado abajo con su guía.

Etiquetas: **[VERIFICADO]** = probado aquí con evidencia; **[SIMULADOR]** = probado contra un servicio simulado; **[NO VERIFICADO]** = falta el servicio real.

## Resultado por tarea

| Paso  | Tarea                                                   | Estado                                            | Evidencia                                                            |
| ----- | ------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| F1.1  | CI en verde                                             | ✅ [VERIFICADO]                                   | Corridas 108 y 110 de GitHub Actions en verde                        |
| F1.2  | Migraciones en staging                                  | ⏸ Propietario                                     | 8 pendientes; guía `docs/runbooks/migraciones-2026-10-27.md`         |
| F1.3  | Correos reales (Resend + hook de Supabase)              | ⏸ Propietario; guía lista                         | `docs/runbooks/correo-resend.md` [NO VERIFICADO]                     |
| F1.4  | Escenarios de Mercado Pago                              | 14/15 [SIMULADOR]; 1 hallazgo → ADR-043           | `docs/runbooks/mercadopago-escenarios.md`                            |
| F1.5  | Correo de confirmación con dirección, solo tras el pago | ✅ [VERIFICADO en local]                          | `4b85dd7`; pgTAP 33, unitarias de plantilla                          |
| F1.6  | Salud de la plataforma y alertas                        | ✅ [VERIFICADO en local]; correos [NO VERIFICADO] | `269c093`; Consola → Salud, pgTAP 105, integración, E2E con axe      |
| F1.7  | Respaldos con restauración probada, RTO/RPO             | ✅ en local ×2; staging en plan Free              | `68d0c66`; `docs/runbooks/respaldos.md`                              |
| F1.8  | Monitoreo de errores (Sentry)                           | ⏸ Propietario (DSN)                               | Mientras tanto: Consola → Salud y alertas por correo                 |
| F1.9  | Revisión de seguridad                                   | ✅ lo que no depende del propietario              | `docs/phases/VENDIBLE-F1.9-SEGURIDAD.md`; migración `20261028000500` |
| F1.10 | Categorías prohibidas y Términos                        | 📝 ADR-042 propuesto                              | `docs/legal/politica-de-contenido.md` (PENDIENTE DE REVISIÓN)        |

## Suites completas al cierre

| Suite                  | Resultado                                 |
| ---------------------- | ----------------------------------------- |
| `pnpm verify` (unit)   | 989/989 [VERIFICADO]                      |
| pgTAP                  | 2,440/2,440 [VERIFICADO]                  |
| Integración            | 362/362 [VERIFICADO]                      |
| E2E (Playwright + axe) | 104/104 [VERIFICADO], en la segunda ronda |
| `pnpm audit`           | sin vulnerabilidades conocidas (Fase 0)   |

## La primera ronda E2E no salió en verde

La primera ronda completa dio 99 pasadas, 2 fallidas y 3 sin correr (dependían de una fallida). No se tomó como «inestable» sin investigar:

- **Barra de categorías (360 px):** se reprodujo 2 de 3 veces. Causa: la prueba preguntaba enlace por enlace «¿se ve?» y luego «¿cuánto mide?»; si la barra se volvía a dibujar entre las dos preguntas, el tamaño daba `null`. Se corrigió la prueba para medir todos los enlaces en un solo paso (`f09935b`): 5 de 5 en verde. No era un fallo de la tienda.
- **Agregar tienda desde la consola:** el mensaje «Tienda creada en …» sí aparece en la captura del fallo, pero llegó después de los 5 s que espera la prueba. Ocurrió justo después de reiniciarse el contenedor. Aislada pasó 3 de 3 y en la segunda ronda completa también. Queda anotada; si se repite, se mide la duración de esa acción.

## Revisión adversarial de la fase

1. **¿Las alertas de salud pueden filtrar datos?** Solo leen conteos; un test pgTAP inserta un payload con un texto secreto y comprueba que no sale. Los destinatarios son dueño y administración activos; soporte y tiendas no reciben nada (pgTAP 105).
2. **¿Una alerta puede inundar el correo?** Un correo por problema, destinatario y hora, deduplicado en `notification_deliveries` (integración `platform-health`: dos corridas en la misma hora = un correo; la hora siguiente, otro).
3. **¿El simulacro de restauración prueba lo que importa?** Compara conteos de cada tabla, totales de dinero y los metatests de seguridad sobre la copia. Encontró un fallo real (ajustes de la base que `pg_dump` no copia), ya documentado y resuelto en el script. No prueba la restauración de Supabase alojado: sigue [NO VERIFICADO].
4. **¿El metatest de guardas da falsa seguridad?** Comprueba que la guarda está, no que se use bien; se dejó escrito y lo complementan las pruebas de aislamiento de cada función. Tiene pruebas negativas que demuestran que detecta una función sin guarda.
5. **¿El cambio a `lock_media` rompe algo?** Las pruebas anteriores de medios siguen en verde; las nuevas fallan con la función vieja (rojo comprobado) y pasan con la nueva.
6. **Contracargos (hallazgo nuevo):** hoy se ignoran. No se corrigió sin permiso porque toca el contrato de pagos: ADR-043 propuesto.
7. **Riesgo de operación:** staging no tiene respaldos automáticos (plan Free). Con datos de demostración es aceptable; antes del primer comercio real no.

## Pendientes del propietario (agrupados)

1. Aplicar 8 migraciones en staging o configurar `MIGRATION_DATABASE_URL`.
2. Resend + dominio de envío (guía de 7 pasos).
3. Activar la protección de contraseñas filtradas en Supabase (1 interruptor).
4. Credenciales de prueba de la aplicación de Mercado Pago.
5. Decidir el plan de Supabase (Pro y, antes del primer cliente de pago, PITR).
6. Responder ADR-042 (política de contenido) y ADR-043 (contracargos).
7. DSN de Sentry si quieres monitoreo de errores externo.
8. Autorizar el conector de Vercel.
