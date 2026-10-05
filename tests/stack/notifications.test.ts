import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Invitación de punta a punta: la RPC encola → el runner de la app (Bearer de
 * Vercel Cron) emite el token → Mailpit recibe el enlace. Requiere la app y el
 * stack levantados y CRON_SECRET en el entorno.
 */
const APP = process.env.STACK_PANEL_URL ?? "http://localhost:3000";
const MAIL = process.env.STACK_MAIL_URL ?? "http://127.0.0.1:8025";
const admin = postgres(
  process.env.STACK_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pruva_dev",
  { max: 1, onnotice: () => {} },
);
const run = randomBytes(3).toString("hex");

afterAll(async () => {
  await admin.end();
});

describe("emails de plataforma por el runner de jobs", () => {
  it("la invitación llega a Mailpit con el enlace de aceptación", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error("Falta CRON_SECRET (el mismo que usa la app).");
    const email = `invitada-${run}@example.test`;

    const [org] = await admin<{ id: string }[]>`
      insert into public.organizations (name, slug, country) values (${`Org N${run}`}, ${`org-n${run}`}, 'MX')
      returning id`;
    const [inv] = await admin<{ id: string }[]>`
      insert into public.organization_invitations (organization_id, email, org_role, expires_at)
      values (${org!.id}, ${email}, 'org_member', now() + interval '7 days') returning id`;
    await admin`select app.enqueue_job('access.invitation_email', ${admin.json({ invitation_id: inv!.id })},
                                       null, ${`invitation:${inv!.id}`})`;

    const response = await fetch(`${APP}/api/jobs/run`, {
      headers: { authorization: `Bearer ${secret}`, host: new URL(APP).host },
    });
    expect(response.status).toBe(200);

    let text = "";
    for (let i = 0; i < 40 && !text; i += 1) {
      const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
      const { messages } = (await res.json()) as { messages: { ID: string }[] };
      if (messages[0]) {
        const msg = await fetch(`${MAIL}/api/v1/message/${messages[0].ID}`);
        text = ((await msg.json()) as { Text: string }).Text;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    expect(text).toMatch(new RegExp(`${APP}/invitacion/[0-9a-f]{64}`));
  });
});
