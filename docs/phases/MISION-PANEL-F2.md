# Misión panel — Fase 2: edición de tiendas y diseño

Fecha de cierre: 2026-10-20. Commit principal `db21f2c` (más la corrección de la revisión). Sin publicar en staging.

## Qué se hizo

| Pedido de la misión                       | Resultado                                                                                                                                                                                                                                             | Decisión |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Editor visual simple con vista previa     | Un solo formulario de marca (estilos de un clic, colores, tipografía, botones) con vista previa en vivo, en Apariencia y en «Configurar tienda». La tienda completa se revisa en la vista previa privada (otra pestaña, en el dispositivo que se use) | D-F2-02  |
| Estilos prediseñados sin romper contraste | Los 4 estilos existentes aplican con un clic; el formulario no deja guardar con contraste < 4.5:1 y la base vuelve a validar                                                                                                                          | D-F2-02  |
| Onboarding con checklist y progreso       | Barra «N de 4 pasos listos»; el error al publicar enumera los pendientes; el pendiente sanitario lleva a Cumplimiento                                                                                                                                 | D-F2-03  |
| La marca del asistente llega a la tienda  | La primera publicación publica el borrador del tema (antes quedaba en borrador)                                                                                                                                                                       | D-F2-01  |
| Dominio propio con guía                   | Ajustes → Dominio: direcciones reales, estado y pasos. La conexión automática (DNS, proveedor) espera el ADR E16                                                                                                                                      | D-F2-04  |

**No hecho en esta fase, con su motivo:**

- **Crear una tienda nueva desde una plantilla.** Hoy solo la crea la plataforma; el alta por cuenta propia requiere el ADR E15.
- **Editor de páginas y menús arrastrando bloques.** Ya existen el editor de Portada por secciones y los menús con reordenado; arrastrar en el celular es menos accesible que los botones de mover. No se añadió.

## Eliminado

`BrandingForm`, su vista previa y `saveBranding` (formulario de marca duplicado del asistente): unas 150 líneas.

## Pruebas al cierre

- `pnpm verify` en verde (681 unitarias).
- `pnpm db:test` en verde: pgTAP 2047 e integración 255.
- E2E completo sobre el build de la Fase 2: 68 en verde. Fallaron 2 pruebas de la Fase 3 (escritas antes de compilar su código) y pasan con el build siguiente.
- E2E nuevos o ampliados:
  - `launch`: la marca sale publicada con la tienda.
  - `onboarding`: el mismo formulario de marca.
  - `panel-smoke`: Ajustes → Dominio.

## Revisión adversarial

Hecha a mano. Se verificó que `appearance_publish_theme` exige `appearance.manage` en la base y que un conflicto de revisión se avisa en lugar de pisar.

Hallazgo corregido: si la lectura de `launched_at` fallaba, el lanzamiento la trataba como primera publicación; un relanzamiento tras pausar podía publicar un borrador de marca. Ahora solo se publica con la lectura confirmada.

## Pendiente del propietario

- **E15:** aprobar el alta de tienda por cuenta propia.
- **E16:** aprobar la conexión de dominio desde el panel y dar credenciales de Vercel.
