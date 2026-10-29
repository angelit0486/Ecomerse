# Misión vendible · Fase 4 · Brechas para vender la plataforma como SaaS (2026-10-29)

Qué pide la misión en cada punto y qué hay hoy. Etiquetas: **[VERIFICADO]** = probado en local; **[NO VERIFICADO]** = falta el servicio real.

| #   | Pide la misión                                                                                   | Hoy                                                                                                                                                                       | Falta                                                                                | Quién decide             |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------ |
| 1   | Cobro: planes, límites, mensual y anual, prueba, cambio de plan, cancelación, suspensión         | Planes con límites; ciclo completo con cobro **manual**: prueba, gracia de 7 días, solo lectura, suspensión a los 30, cambio de plan y cancelación (Fase 10) [VERIFICADO] | Precios, periodo anual y cobro automático con tarjeta                                | Propietario: **ADR-044** |
| 2   | Alta autoservicio y tienda publicada en menos de 1 hora                                          | Onboarding por giro, plantillas, checklist de lanzamiento con bloqueos; la tienda la crea la plataforma (E15 no aprobado el 2026-10-20)                                   | Registro público que cree la organización                                            | Propietario: **ADR-045** |
| 3   | Dominios propios automatizados                                                                   | Hecho (ADR-037): guía DNS, verificación TXT, certificado vía Vercel, revisión automática [VERIFICADO con DNS y Vercel simulados]                                          | Token de Vercel en staging [NO VERIFICADO real]                                      | Propietario: token       |
| 4   | Consola: tiendas, estado, plan, uso, ingresos, suspender, soporte auditado, MRR, ventas, errores | Organizaciones, tiendas, planes y uso, suspender y reactivar, soporte temporal auditado, Salud, Trabajos y **Métricas** (nuevo, `ac70294`) [VERIFICADO]                   | MRR: depende de los precios (ADR-044)                                                | ADR-044                  |
| 5   | Privacidad, términos, uso aceptable, exportación y borrado por tienda                            | Textos de cada tienda; **nuevos** borradores de la plataforma en `docs/legal/plataforma/` (PENDIENTE DE REVISIÓN); exportación CSV por tienda [VERIFICADO]                | Revisión del abogado; borrado/anonimización; lista de prohibidos (aplazada, ADR-042) | Abogado + **ADR-046**    |
| 6   | Integraciones: envíos, CFDI, WhatsApp, carritos, cupones                                         | Cupones básicos; ninguna de las otras                                                                                                                                     | Elegir orden y proveedores                                                           | Propietario: **ADR-047** |

## Hecho en esta fase sin esperar decisiones

1. **Consola → Métricas** (`ac70294`), solo para dueña y administración:
   - organizaciones nuevas y activas;
   - suscripciones por estado y plan;
   - pruebas que vencen en 7 días;
   - tiendas publicadas y con ventas;
   - ventas netas por moneda;
   - las 10 tiendas con más ventas.

   Sin datos de clientes. Pruebas: pgTAP 108, integración de paridad, unitarias y E2E con axe.

2. **Borradores legales de la plataforma:** términos del servicio, aviso de privacidad (PRUVA como encargado de los datos de los compradores) y uso aceptable.
