# Correos reales con Resend (paso a paso desde el celular)

Misión vendible F1.3. Sin esto **no sale ningún correo** en staging ni en producción: ni confirmaciones de pedido, ni códigos de acceso, ni alertas de salud. Tiempo: unos 20 minutos más la espera del DNS (de minutos a unas horas).

> En todo este documento, `tudominio.com` es un ejemplo: usa el dominio desde el que quieres enviar. Las claves se pegan **solo** en Vercel o en Supabase, nunca en el chat ni en el código.

## Antes de empezar

- Un dominio propio y acceso al lugar donde administras su DNS (donde lo compraste, o Vercel si el DNS está ahí).
- Acceso a Vercel (proyecto `ecomerse`) y a Supabase (proyecto `pruva-staging`).

## 1. Cuenta y dominio en Resend

1. Abre **resend.com** → **Sign up** (puedes entrar con tu cuenta de GitHub o Google).
2. Menú **Domains** → **Add Domain**.
3. Escribe `envios.tudominio.com` (un subdominio solo para enviar protege la reputación de tu correo normal). Región: la más cercana a tus clientes que te ofrezca.
4. Resend te muestra **3 o 4 registros DNS** (tipo TXT y MX). Déjala abierta.

## 2. Copiar los registros al DNS

En otra pestaña abre el panel DNS de tu dominio y, **por cada registro que muestra Resend**:

1. **Agregar registro** → elige el mismo **Tipo** (TXT o MX).
2. **Nombre/Host**: copia exactamente el de Resend (p. ej. `resend._domainkey.envios`). Algunos paneles agregan el dominio solos: si al guardar queda repetido (`…tudominio.com.tudominio.com`), quita la parte final.
3. **Valor**: cópialo con el botón de copiar de Resend (es largo; no lo escribas a mano).
4. En MX, la **prioridad** es la que indica Resend.
5. Guarda.

Esos registros son SPF (quién puede enviar) y DKIM (firma de cada correo).

**DMARC** (recomendado; Resend lo sugiere aparte): agrega un TXT con nombre `_dmarc` y valor:

```
v=DMARC1; p=none; rua=mailto:tu-correo@tudominio.com
```

`p=none` solo observa; cuando todo funcione unas semanas se puede subir a `p=quarantine`.

## 3. Verificar en Resend

Vuelve a Resend → tu dominio → **Verify DNS Records**. Cuando todos digan **Verified** (puede tardar), sigue. Si alguno falla después de 1 hora, revisa que el nombre no quedara duplicado.

## 4. Crear la clave de Resend

1. Resend → **API Keys** → **Create API Key**.
2. Nombre: `pruva-staging`; permiso: **Sending access**; dominio: `envios.tudominio.com`.
3. Copia la clave (empieza con `re_`). **Solo se muestra una vez.**

## 5. Variables en Vercel

Vercel → proyecto `ecomerse` → **Settings** → **Environment Variables**. Agrega (entorno Preview y Production):

| Nombre           | Valor                                      |
| ---------------- | ------------------------------------------ |
| `EMAIL_PROVIDER` | `resend`                                   |
| `RESEND_API_KEY` | la clave `re_…` del paso 4                 |
| `EMAIL_FROM`     | `Tu Marca <no-reply@envios.tudominio.com>` |

Guarda y, en **Deployments**, toca los tres puntos del último despliegue → **Redeploy** para que tome las variables.

## 6. Códigos de acceso con tu marca (Send Email Hook de Supabase)

Así los códigos para entrar al panel y a la tienda salen por Resend con el diseño de la plataforma, no con el correo genérico de Supabase.

1. Supabase → proyecto `pruva-staging` → **Authentication** → **Hooks** (o **Auth Hooks**).
2. **Send Email hook** → **Enable** → tipo **HTTPS**.
3. URL: `https://<tu-dominio-del-panel>/api/auth/email-hook`.
4. Toca **Generate secret** y cópialo (empieza con `v1,whsec_`).
5. Guarda el hook.
6. En Vercel agrega `SEND_EMAIL_HOOK_SECRET` con ese valor y vuelve a desplegar (paso 5).

## 7. Comprobar que funciona

1. Entra al panel con «Recibir un código»: debe llegar el correo con el código desde `no-reply@envios.tudominio.com`.
2. Haz un pedido de prueba en la tienda demo: tras confirmarse el pago llega «Pedido confirmado» con la dirección de envío.
3. En Resend → **Emails** ves cada envío y si llegó, rebotó o se marcó como spam.
4. En la Consola → **Salud**, «Correos enviados» sube y «no enviados» se queda en 0.

Cuando lo hagas, avísame: marco F1.3 como [VERIFICADO] solo después de ver un envío real.

## Si algo falla

| Síntoma                                           | Causa probable y arreglo                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| El despliegue falla al arrancar                   | Falta `RESEND_API_KEY` con `EMAIL_PROVIDER=resend`, o `EMAIL_FROM` no tiene la forma `Nombre <correo>` (la app lo valida al arrancar, a propósito) |
| Consola → Trabajos muestra «resend respondió 403» | El dominio de `EMAIL_FROM` no es el verificado en Resend                                                                                           |
| «resend respondió 401»                            | Clave mal copiada o revocada: crea otra y reemplázala en Vercel                                                                                    |
| No llega el código de acceso pero sí los pedidos  | El hook de Supabase no está activo o el secreto no coincide con `SEND_EMAIL_HOOK_SECRET`                                                           |
| Llegan a spam                                     | Falta DMARC o algún registro sigue sin verificar; espera 24–48 h tras verificar                                                                    |
