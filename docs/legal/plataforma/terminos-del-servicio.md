# Términos del servicio de PRUVA (plataforma ↔ comercio)

> **PENDIENTE DE REVISIÓN.** Borrador de trabajo, no asesoría legal. Lo debe revisar y aprobar un abogado antes de usarse. Aplica a los comercios que contratan la plataforma, no a sus compradores (para ellos están los textos de cada tienda en `docs/legal/`).

Fecha del borrador: 2026-10-29 · Versión: `2026-10-borrador-1`

Entre **[RAZÓN SOCIAL DE PRUVA]** (RFC **[RFC]**), «PRUVA», y el comercio que crea una cuenta, «el Comercio».

## 1. Qué es el servicio

PRUVA ofrece software para crear y operar tiendas en línea: catálogo, inventario, pedidos, clientes, diseño de la tienda, dominio propio y conexión con medios de pago. El Comercio es el vendedor de sus productos y el responsable frente a sus compradores.

## 2. El dinero de las ventas

- Los cobros a los compradores se hacen en la **cuenta del propio Comercio** en su medio de pago (por ejemplo, Mercado Pago). PRUVA no recibe ni retiene ese dinero.
- Las comisiones del medio de pago las cobra el medio de pago al Comercio, según su propio contrato.
- Contracargos y reembolsos se resuelven entre el Comercio, el comprador y el medio de pago; la plataforma los registra y avisa al Comercio.

## 3. Plan, pago y periodo de prueba

- El Comercio elige un plan con límites (por ejemplo, número de tiendas, productos, personas del equipo y almacenamiento). Precios: **[PRECIOS POR DEFINIR, ADR-044]**.
- Prueba gratuita de **[N] días**, cuando aplique. Al terminar sin pago, la cuenta pasa a solo lectura.
- **Si el pago se atrasa:** la cuenta sigue funcionando durante un periodo de gracia de **[7] días**. Después queda en solo lectura (la tienda no recibe pedidos nuevos ni se pueden hacer cambios). A los **30 días** en solo lectura, la cuenta se suspende.
- Al pagar lo pendiente, la cuenta vuelve a funcionar con sus datos.
- Cambios de plan: **[REGLA DE PRORRATEO POR DEFINIR, ADR-044]**.

## 4. Cancelación

El Comercio puede cancelar cuando quiera desde **[MEDIO]**. Antes de cancelar puede descargar sus datos (sección 6). **[Reembolso de periodos pagados: POR DEFINIR]**.

## 5. Obligaciones del Comercio

- Vender solo productos legales en México y cumplir la Política de uso aceptable.
- Publicar sus propios avisos de privacidad, términos, cambios y devoluciones para sus compradores. PRUVA da borradores, pero no sustituyen la revisión de un abogado.
- Cumplir las reglas sanitarias de sus productos (por ejemplo, suplementos) y la Ley Federal de Protección al Consumidor.
- Mantener seguras sus contraseñas y la verificación en dos pasos de su equipo.

## 6. Datos del Comercio

- Los datos de la tienda (productos, pedidos, clientes) son del Comercio. PRUVA los trata solo para prestar el servicio (ver el Aviso de privacidad de la plataforma).
- El Comercio puede descargarlos en cualquier momento: **Ajustes → Exportar** (productos, inventario, pedidos y clientes, en CSV).
- **Al terminar el servicio:** el Comercio tiene 30 días para descargar sus datos. Después se anonimizan los datos personales de sus compradores (nombre, correo, teléfono, dirección y notas). Los pedidos, pagos y movimientos de inventario se conservan sin esos datos el tiempo que exija la ley fiscal (**[PLAZO, a confirmar por el abogado]**).

## 7. Soporte y acceso del personal de PRUVA

- El personal de soporte solo entra a una tienda con un permiso temporal, con motivo y fecha de vencimiento, que queda registrado. El Comercio puede ver ese registro en **[Actividad]**.
- Tiempo de respuesta de soporte: **[POR DEFINIR]**.

## 8. Disponibilidad y respaldos

- PRUVA procura mantener el servicio disponible, sin garantizar que funcione sin interrupciones. **[NIVEL DE SERVICIO, SI SE OFRECE]**.
- Respaldos: **[FRECUENCIA Y RETENCIÓN, según el plan de la base de datos; hoy staging no tiene respaldos automáticos]**.

## 9. Suspensión por uso indebido

PRUVA puede suspender una tienda que infrinja la ley o la Política de uso aceptable, avisando al Comercio y explicando el motivo, salvo cuando la ley o un riesgo grave lo impidan.

## 10. Responsabilidad

**[LÍMITES DE RESPONSABILIDAD, A REDACTAR POR EL ABOGADO]**.

## 11. Cambios a estos términos

PRUVA avisará los cambios con **[30]** días de anticipación por correo y en el panel.

## 12. Ley y tribunales

Leyes de México; tribunales de **[CIUDAD]**.
