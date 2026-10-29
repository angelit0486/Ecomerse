# Radar regulatorio de México (2026-10-29)

> **PENDIENTE DE REVISIÓN.** Esta lista sirve para no perder de vista los cambios regulatorios; no es asesoría legal. Cada decisión la confirma un abogado o el asesor regulatorio.

Ninguna fuente oficial (DOF, COFEPRIS, Profeco, INAI, SAT) fue accesible desde el entorno de desarrollo el 2026-10-29. Por eso esta lista dice **dónde y cada cuándo mirar**, sin afirmar el contenido vigente de cada norma [NO VERIFICADO].

| Tema                                           | Autoridad o fuente                                                 | Por qué importa a PRUVA                                                                                              | Qué vigilar                                                                                                         | Frecuencia                     | Dueño              |
| ---------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------ |
| Suplementos alimenticios                       | COFEPRIS; Ley General de Salud; reglamentos y normas de etiquetado | Las tiendas de suplementos publican leyendas sanitarias y fichas (perfil de cumplimiento `MX`, hoy `pending`)        | Cambios de leyendas obligatorias, claims prohibidos, alertas sanitarias de productos retirados                      | Mensual + alertas COFEPRIS     | Asesor regulatorio |
| Etiquetado (NOM-051 y relacionadas)            | Secretaría de Economía, COFEPRIS, DOF                              | Datos nutrimentales y sellos que se muestran en la ficha                                                             | Modificaciones a la NOM y fechas de entrada en vigor                                                                | Trimestral                     | Asesor regulatorio |
| Comercio electrónico y consumidor              | Profeco; Ley Federal de Protección al Consumidor; NMX-COE vigente  | Información de precios, total con impuestos, devoluciones, publicidad por correo (recordatorio de carritos)          | Reglas de comercio electrónico, publicidad y derecho de cancelación; listas de no recibir publicidad (REPEP)        | Trimestral                     | Abogado            |
| Datos personales                               | LFPDPPP y su reglamento; autoridad garante vigente                 | Avisos de privacidad de plataforma y tiendas, consentimiento, derechos ARCO, transferencias a Supabase/Vercel/Resend | Cambios a la ley o a la autoridad garante; lineamientos de aviso de privacidad y transferencias internacionales     | Trimestral                     | Abogado            |
| Facturación electrónica (CFDI)                 | SAT: Anexo 20, Resolución Miscelánea Fiscal anual                  | Integración CFDI futura (ADR-047, 3.º en la fila); datos fiscales de los comercios                                   | Versión de CFDI, complementos de pago, cambios de la miscelánea                                                     | Anual (enero) + avisos del SAT | Contador           |
| Plataformas digitales (retención de impuestos) | SAT; Ley del IVA e ISR, capítulo de plataformas digitales          | Si PRUVA se considera intermediario de ventas, podrían aplicar retenciones                                           | Criterios del SAT sobre plataformas que no cobran el pago (cada comercio cobra con su propia cuenta, ADR-041)       | Anual                          | Contador + abogado |
| Productos prohibidos y restringidos            | Leyes federales y políticas de Mercado Pago y Stripe               | Lista de categorías bloqueadas de la plataforma (ADR-053)                                                            | Vapeadores y cigarros electrónicos, medicamentos, armas, alcohol y tabaco; cambios en políticas de los procesadores | Trimestral                     | Propietario        |
| Correo masivo                                  | Gmail/Yahoo (requisitos de remitentes), Profeco                    | Entregabilidad y baja de suscripción                                                                                 | Umbral de remitente masivo, tasa de quejas, baja en un clic                                                         | Semestral                      | Ingeniería         |

## Cómo se usa

1. Una vez al mes, el dueño de cada fila revisa su fuente (DOF del mes y avisos de cada autoridad) y anota aquí la fecha y lo que encontró.
2. Si algo cambia, se abre un ADR con el impacto en la plataforma y en los textos legales.
3. Los textos de `docs/legal/` siguen PENDIENTE DE REVISIÓN hasta que el abogado los apruebe.

## Bitácora

| Fecha      | Fila | Hallazgo                                                       | Acción |
| ---------- | ---- | -------------------------------------------------------------- | ------ |
| 2026-10-29 | —    | Radar creado; fuentes oficiales no accesibles desde el entorno | —      |
