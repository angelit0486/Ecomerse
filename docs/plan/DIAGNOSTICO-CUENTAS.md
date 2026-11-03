# Diagnóstico: no se pueden crear cuentas (2026-11-03)

Parte A de la misión «portada de imágenes y panel completo». Se escribió antes de corregir nada.

## Resumen

**Causa raíz: en staging no hay proveedor de correo.** Crear cualquier cuenta, del panel o de comprador, depende de un correo, y en staging no sale ninguno.

- El panel crea cuentas solo por invitación, y la invitación es un correo.
- El comprador crea su cuenta con un código que llega por correo.

No se encontró un error de código: en local, con correo (Mailpit), los dos flujos funcionan y sus E2E pasan.

## Evidencia

### Staging (Supabase `pruva-staging`) [VERIFICADO con consultas de solo lectura]

- `EMAIL_PROVIDER=fake` en la vista previa (D-F9-17): la app «envía» a una lista en memoria y no a una persona. `docs/runbooks/correo-resend.md` ya lo advierte: «Sin esto no sale ningún correo en staging… ni códigos de acceso».
- `notification_deliveries` está vacía: la app nunca ha registrado un correo enviado en staging.
- `organization_invitations` tiene 0 filas: nadie ha recibido nunca una invitación al panel.
- Registros de Auth de las últimas 24 h: ninguna petición de código (`/otp`). Hay un inicio de sesión correcto con contraseña y app de autenticación hoy a las 08:38 UTC, de la cuenta dueña de `demo` y `demo2`.
- Cuentas en Auth (correos enmascarados):

| Cuenta           | Contraseña | App de autenticación | Organizaciones                        | Plataforma       | Último ingreso                |
| ---------------- | ---------- | -------------------- | ------------------------------------- | ---------------- | ----------------------------- |
| `a***@g***`      | sí         | sí                   | dueña de `org-demo` y `org-demo2`     | `platform_owner` | 2026-11-03                    |
| `m***@g***`      | sí         | **no**               | **ninguna**                           | —                | nunca                         |
| `d***@e***` (×2) | sí         | no                   | `org-demo` miembro, `org-demo2` admin | —                | nunca (datos de demostración) |

La cuenta `m***@g***` (creada el 2026-10-21) existe, pero aunque entre no ve ninguna tienda: no pertenece a ninguna organización.

### Local (stack sin Docker, correo en Mailpit) [VERIFICADO ejecutando]

| Flujo                                                             | Petición                                     | Resultado                                    |
| ----------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Panel, correo sin cuenta (`/ingresar`, `shouldCreateUser: false`) | `POST /auth/v1/otp` con `create_user: false` | 422 `Signups not allowed for otp`; 0 correos |
| Comprador, cuenta nueva (`/cuenta`, `shouldCreateUser: true`)     | `POST /auth/v1/otp` con `create_user: true`  | 200; 1 correo con el código                  |

## Por qué en el panel «parece» que funciona

`requestLoginCode` trata cualquier error igual que un éxito, para no revelar qué correos tienen cuenta (protección contra enumeración, D-F2-07 y SEC-01). Un correo sin cuenta ve «te enviamos un código», y el código nunca llega. Es intencional: el equipo del panel no se registra solo; la plataforma crea la organización e invita al dueño, o el dueño invita a su equipo.

## Qué NO es la causa

- No es RLS ni permisos: la cuenta dueña entra y opera hoy.
- No es la base desactualizada: staging está en `20261103000100`, igual que el repo.
- No es un error de los formularios: en local el código llega y las pruebas E2E de acceso pasan (120/120 en la línea base).

## Observación lateral [NO VERIFICADO]

En los registros de Auth de staging, las peticiones llegan con `referer: http://localhost:3000`. Eso sugiere que la «Site URL» de Auth en el proyecto de staging sigue en `localhost:3000`. No afecta los códigos de 6 dígitos, pero sí cualquier enlace de correo (recuperar contraseña, confirmar). Se revisa en Supabase → Authentication → URL Configuration cuando haya acceso; no lo cambié.

## Solución

1. **Definitiva:** configurar Resend en staging (`docs/runbooks/correo-resend.md`): clave `RESEND_API_KEY` en Vercel, `EMAIL_PROVIDER=resend`, dominio con SPF/DKIM/DMARC y Send Email Hook de Supabase. Requiere al propietario (bloqueo B3).
2. **Para entrar hoy sin correo:** usar una cuenta que ya tenga contraseña y app de autenticación (la dueña de `demo` y `demo2` ya existe y entró hoy) o darle acceso a una existente. No requiere código nuevo.
3. **Error de código a corregir:** ninguno encontrado.
