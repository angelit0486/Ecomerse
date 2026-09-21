# Cambios — Fase 1 y 2

> No pude correr `npm run verify` aquí (sin red, sin dependencias instaladas).
> Revisé la sintaxis con TypeScript y probé con Node la lógica de `md.ts`,
> `pasos.ts`, `revisor-nombre.ts` y `seguro.ts`. **Antes de promover el sitio,
> corre `npm run verify` o mira que el build de Vercel pase.**

## Estado del repo `angelii33/app-cursos` (rama main)

Comparé `main` con el ZIP original: son idénticos, salvo dos cosas:

- **Falta `.gitignore`** (este ZIP lo trae). Sin él, un `git add .` puede subir
  `node_modules/`, `.next/` o un `.env.local` con llaves. Agrégalo primero.
- **Sobra `listo-codigo-completo.zip`** dentro del repo. Bórralo: es una copia
  del propio código.
- `CabeceraLeccion`, `FlujoLeccion` y `ContinuarCurso` **no existen en `main`**.
  Si existen en otro lado, todavía no están en GitHub.

## Cómo aplicarlo

1. Reemplaza los archivos del repo con los de este ZIP (mismas rutas).
2. En Supabase → SQL Editor, abre `contenido/tu-negocio-en-google-M01-L01.sql`:
   corre primero el `SELECT` (respaldo) y luego el `UPDATE`.
3. Sube a GitHub; Vercel despliega. Abre
   `/cursos/tu-negocio-en-google/1/1` y recórrela en el celular.

Mientras no corras el SQL, la lección 1 se sigue viendo como antes (artículo):
el modo guiado solo se activa cuando el texto tiene 2 o más secciones `##`.

## Fase 1 — correcciones

- **Redirección abierta** (`//sitio-malo.com` pasaba el filtro `startsWith("/")`):
  nuevo `src/lib/seguro.ts`, usado en `entrar/page.tsx` y en las acciones de
  entrar, completar lección y completar misión.
- **`md.ts`** ahora entiende `[texto](https://…)` (solo http/https o rutas
  internas) y `` `código` ``. Todo sigue escapándose antes de dar formato.
- **`layout.tsx`:** `metadataBase` ya no está fijo en `app-cursos-mu`; toma el
  dominio del proyecto en Vercel (o `NEXT_PUBLIC_SITE_URL` si lo defines).
- **Lección 1 corregida** (en el `.md`/`.sql`): sin la promesa de "en el mapa
  en 30 minutos", sin "ya no puede un desconocido cambiarte el horario", sin la
  cifra del 76% (sin fuente), y con la errata de "los mejores tacos".

## Fase 2 — guiada e interactiva

- `lib/pasos.ts`: parte la lección en pasos (cada `##` es un paso).
- `components/leccion-guiada.tsx`: un paso por pantalla, avance, puntos para
  saltar, "Hecho, sigue". Recuerda el paso en el navegador.
- `components/widgets-leccion.tsx`: buscador de tu negocio en Google Maps,
  revisor de nombre y pregunta rápida.
- `components/checklist-interactiva.tsx`: las casillas de "Cómo saber que
  quedó bien" se marcan al tocarlas (se guardan en el navegador).
- `components/cierre-venta.tsx`: al final de una lección abierta muestra lo que
  ya lograste, las 3 lecciones que faltan (con su resultado), minutos por
  semana, precio y un botón. La pantalla de candado también tiene botón y
  precio.
- `components/mapa-curso.tsx`: una fila de círculos, uno por lección, con la
  actual resaltada y las cerradas con candado (datos reales, sin interacción).
- Dos elementos más para las lecciones guiadas:
  `::autochequeo ¿Ya lo tienes? || 7` (sin nota: "Todavía no" te lleva de
  vuelta al paso 7) y `::cuaderno Título || Ayuda` (borrador que se guarda solo
  en el navegador del lector).
- `globals.css`: secciones 19 y mapa del curso.

## Cómo escribir una lección guiada (para los otros cursos)

```
## Título del paso

Texto normal, con **negrita**, listas, tablas y [enlaces](https://…).

::buscar-negocio
::revisor-nombre
::pregunta ¿Texto? || Opción A | *Opción correcta* | Opción C || Explicación
::autochequeo ¿Ya lo tienes listo? || 7
::cuaderno Tu versión || Texto de ayuda opcional
```

Cada `##` abre un paso. Las líneas `::` van solas. `buscar-negocio` y
`revisor-nombre` son específicos de Google Business; `::pregunta` sirve en
cualquier curso. Una `::pregunta` mal escrita se ignora en silencio.

## Pendiente (Fase 3 y 4)

- **`enroll_in_course` sigue dando acceso sin cobrar.** El botón del cierre usa
  la misma acción que la página del curso, así que hoy inscribe gratis. No
  promociones el sitio hasta conectar Mercado Pago.
- Seguridad de Supabase: políticas de `user_roles` y funciones SECURITY DEFINER.
- Medición de eventos, captura de correo y reescribir los otros 5 cursos.
