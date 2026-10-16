// =============================================================================
// Edge Function demo-seed (D-F9-17): siembra las tiendas de demostración de la
// vista previa DENTRO de Supabase, para que la clave de servicio nunca salga de
// la plataforma. La lógica es la misma del stack local (seed-core.mjs).
//
// Solo corre con un boleto de un solo uso que el operador crea en la base
// (supabase_migrations.pruva_seed_ticket, fuera de la Data API) y que caduca:
// sin boleto válido responde 403 sin tocar nada. Las ilustraciones se bajan del
// repositorio en un commit fijo y se verifican con el sha256 del manifiesto
// empaquetado antes de subirlas. Nunca se despliega en el proyecto de producción.
// =============================================================================
import postgres from "npm:postgres@3.4.9";

import manifest from "./media/manifest.json" with { type: "json" };
import { seedDemo } from "./seed-core.mjs";

const MEDIA_BASE =
  "https://raw.githubusercontent.com/angelit0486/Ecomerse/0ceb19fa6be6eda3a1081d5462a3ac21bc7f841e/supabase/functions/demo-seed/media";

type MediaEntry = { sha256: string; bytes: number; width: number; height: number };
const media = manifest as Record<string, MediaEntry>;

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const ticket = req.headers.get("x-demo-seed-ticket") ?? "";
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  const api = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (req.method !== "POST" || ticket.length < 32 || !dbUrl || !api || !serviceKey) {
    return Response.json({ ok: false }, { status: 403 });
  }
  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const hash = await sha256Hex(new TextEncoder().encode(ticket));
    const valid = await sql`
      delete from supabase_migrations.pruva_seed_ticket
       where token_hash = ${hash} and expires_at > now()
      returning 1`;
    if (valid.length === 0) return Response.json({ ok: false }, { status: 403 });

    const { stores } = (await req.json()) as { stores: { neutral: boolean; hostname: string }[] };
    const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

    const createOwner = async (email: string): Promise<string> => {
      const res = await fetch(`${api}/auth/v1/admin/users`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ email, email_confirm: true }),
      });
      if (!res.ok) throw new Error(`Auth ${res.status}: ${await res.text()}`);
      return (await res.json()).id;
    };

    const putImage = async ({ path, svg }: { path: string; svg: string }) => {
      const id = await sha256Hex(new TextEncoder().encode(svg));
      const entry = media[id];
      if (!entry) throw new Error(`Ilustración sin pre-renderizar: ${id}`);
      const res = await fetch(`${MEDIA_BASE}/${id}.webp`);
      const data = new Uint8Array(await res.arrayBuffer());
      if (!res.ok || (await sha256Hex(data)) !== entry.sha256) {
        throw new Error(`Ilustración no verificada: ${id}`);
      }
      const upload = await fetch(`${api}/storage/v1/object/store-media/${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "image/webp", "x-upsert": "true" },
        body: data,
      });
      if (!upload.ok) throw new Error(`Storage ${upload.status}: ${await upload.text()}`);
      return { bytes: entry.bytes, width: entry.width, height: entry.height };
    };

    const results = [];
    for (const store of stores) {
      results.push(
        await seedDemo({
          sql,
          neutral: store.neutral === true,
          hostname: String(store.hostname),
          createOwner,
          putImage,
          log: console.log,
        }),
      );
    }
    return Response.json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await sql.end();
  }
});
