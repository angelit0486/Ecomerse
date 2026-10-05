# Prompt de arranque del modo autónomo

Copia y pega esto al iniciar una sesión de Claude Code sobre este repositorio (o úsalo como prompt de una rutina programada). Es el mismo para la primera sesión y para todas las siguientes: el estado vive en `docs/plan/PROGRESS.md`.

---

```text
MODO AUTÓNOMO — Plataforma e-commerce SaaS (repositorio pruva)

Trabaja solo hasta terminar el plan, sin pedirme aprobación entre tareas ni entre fases.

1. Lee, en este orden: CLAUDE.md, docs/plan/AUTONOMOUS_PLAN.md y docs/plan/PROGRESS.md.
2. Sigue el arranque de sesión del plan (§2.1): sincroniza git, intenta subir los commits
   pendientes, levanta el entorno (§6) y deja `pnpm verify` y `pnpm db:test` en verde
   antes de empezar algo nuevo.
3. Ejecuta las tareas de PROGRESS.md en orden con el ciclo del plan (§2.2): pruebas
   primero, implementación mínima, verificación completa, prueba de mutación si toca
   seguridad, documentación, commit y push. Actualiza PROGRESS.md después de CADA tarea.
4. Al terminar cada fase, ejecuta su gate (§2.3), escribe el informe en docs/phases/
   y sigue con la siguiente fase sin esperarme.
5. Usa las decisiones preaprobadas del plan (§3.1). Toda decisión nueva va a
   docs/DECISIONS.md.
6. Detente SOLO en los casos S1–S6 del plan (§2.4). En cualquier otro caso, decide con
   criterio profesional, regístralo y sigue.
7. Nunca debilites, saltes ni pongas en cuarentena una prueba. Nunca avances con
   pruebas en rojo.
8. Si el push sigue fallando y hay 3 o más commits sin subir, genera un git bundle en
   el scratchpad, envíamelo y continúa.
9. Si la sesión se acerca a su fin, deja en PROGRESS.md el "siguiente paso exacto"
   para que la próxima sesión retome sin perder contexto.

Al terminar la Fase 11, escribe docs/phases/FINAL-REPORT.md con la lista exacta de lo que
debo hacer yo para salir a producción (Fase 12).
```

---

## Formas de ejecutarlo

1. **Una sesión larga (lo más simple):** pega el prompt en esta conversación o en una nueva. Claude trabaja hasta que la sesión termina; si se corta, otra sesión con el mismo prompt retoma desde `PROGRESS.md`.
2. **Rutina programada:** una rutina de Claude Code que dispare este prompt cada pocas horas en una sesión nueva. Cada disparo retoma desde `PROGRESS.md`. Útil si quieres que avance sin abrir sesiones a mano.

**Requisito previo para ambas:** resolver el bloqueo P0 (acceso de Claude a GitHub). Sin él, cada sesión nueva arranca de un clon del repositorio remoto **sin** el trabajo local, y lo hecho en el contenedor anterior solo sobrevive en los bundles.
