# Informes técnicos por tarea (protocolo permanente)

Instrucción del propietario del 27 nov 2026. Aplica a todo prompt o tarea que se ejecute en PRUVA.

## Regla

- Cada tarea termina con un **informe técnico independiente**, escrito **antes** de declararla finalizada.
- Si la tarea queda bloqueada, el informe se escribe igual y explica el motivo.
- Una tarea solo es «terminada» si sus criterios de aceptación están **demostrados** con evidencia.

## Nombre y lugar

- Carpeta: `docs/reports/`.
- Nombre: `PRUVA_INFORME_<NNN>_<DESCRIPCION>.md`, con numeración consecutiva de tres dígitos y una descripción en mayúsculas que corresponda al trabajo real. Ejemplos: `PRUVA_INFORME_002_IMPLEMENTACION.md`, `PRUVA_INFORME_003_RENDIMIENTO.md`.
- Si el entorno lo permite, también se entrega una versión `.docx` con el mismo nombre.

## Contenido obligatorio

1. Objetivo recibido.
2. Estado inicial del repositorio: rama, HEAD, cambios sin confirmar y ramas remotas relevantes.
3. Trabajo realizado.
4. Archivos afectados: creados, modificados y eliminados; migraciones; configuración; dependencias.
5. Decisiones técnicas.
6. Problemas encontrados.
7. Pruebas ejecutadas y resultados reales (números y comandos).
8. Comparación antes/después cuando existan métricas.
9. Riesgos y pendientes.
10. Criterios de aceptación cumplidos y no cumplidos.
11. Estado final de Git.
12. Recomendación del siguiente paso.

## Estados de verificación

| Estado                  | Significado                                  |
| ----------------------- | -------------------------------------------- |
| VERIFICADO              | Evidencia directa                            |
| PARCIALMENTE VERIFICADO | Evidencia incompleta                         |
| NO VERIFICADO           | No se pudo comprobar                         |
| FALLIDO                 | La comprobación encontró un problema         |
| BLOQUEADO               | Requiere acceso, credenciales o autorización |

**Reglas de la evidencia:**

- Encontrar el código no demuestra que una función funcione.
- No se declaran pruebas que no se ejecutaron.
- La evidencia previa reutilizada se marca como tal, con su fecha.

## Límites que siguen vigentes

Sin autorización expresa del propietario, nada de:

- despliegues;
- migraciones remotas;
- merges protegidos;
- borrado de datos;
- operaciones irreversibles.

El resto de las reglas está en `CLAUDE.md`.

## Índice

| N.º | Informe                                                                          | Tarea                                           |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| 001 | [PRUVA_INFORME_001_AUDITORIA_INICIAL.md](PRUVA_INFORME_001_AUDITORIA_INICIAL.md) | Auditoría inicial de solo lectura (26 nov 2026) |
