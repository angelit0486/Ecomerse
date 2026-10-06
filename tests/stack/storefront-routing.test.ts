import { randomBytes } from "node:crypto";
import http from "node:http";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPreviewToken } from "@/server/storefront/preview";

/**
 * Resolución host → tienda de punta a punta (GATE0 §21.1): app compilada
 * (`pnpm build && pnpm start`) + stack local. Dos hosts, dos tiendas, sin mezcla.
 */
const APP = new URL(process.env.STACK_APP_URL ?? "http://localhost:3000");
const PANEL_HOST = process.env.STACK_PANEL_HOST ?? "localhost:3000";
const adminUrl =
  process.env.STACK_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pruva_dev";
const admin = postgres(adminUrl, { max: 2, onnotice: () => {} });
const run = randomBytes(3).toString("hex");

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function get(host: string, path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: APP.hostname, port: APP.port, path, method: "GET", headers: { host, ...headers } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const stores: Record<string, { id: string; host: string; name: string }> = {};

async function createStore(key: string, status: "active" | "draft" | "paused") {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('routing_test', 'routing_test')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country)
    values (${`Org ${key}`}, ${`org-${key}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status)
              values (${org!.id}, ${plan!.id}, 'active')`;
  const name = `Tienda ${key.toUpperCase()}`;
  const [store] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at)
    values (${org!.id}, ${name}, ${key}, 'MXN', 'MX', 'America/Mexico_City', ${status},
            ${status === "draft" ? null : new Date()})
    returning id`;
  const host = `${key}.localhost`;
  await admin`insert into public.store_domains (store_id, hostname, type, status, is_primary)
              values (${store!.id}, ${host}, 'platform_subdomain', 'active', true)`;
  stores[key] = { id: store!.id, host, name };
}

beforeAll(async () => {
  const health = await get(PANEL_HOST, "/api/health").catch(() => null);
  if (health?.status !== 200) {
    throw new Error("App apagada. Ejecuta `pnpm build && pnpm start` con el stack levantado.");
  }
  await createStore(`rta${run}`, "active");
  await createStore(`rtb${run}`, "active");
  await createStore(`rtd${run}`, "draft");
  await createStore(`rtp${run}`, "paused");
});

afterAll(async () => {
  await admin.end();
});

describe("storefront: host → tienda", () => {
  it("cada host muestra su tienda y solo la suya", async () => {
    const a = await get(stores[`rta${run}`]!.host, "/");
    const b = await get(stores[`rtb${run}`]!.host, "/");
    expect(a.status).toBe(200);
    expect(a.body).toContain(stores[`rta${run}`]!.name);
    expect(a.body).not.toContain(stores[`rtb${run}`]!.name);
    expect(b.body).toContain(stores[`rtb${run}`]!.name);
    expect(b.body).not.toContain(stores[`rta${run}`]!.name);
  });

  it("/_store no es accesible desde fuera, ni apuntando a otra tienda", async () => {
    const res = await get(stores[`rta${run}`]!.host, `/_store/${stores[`rtb${run}`]!.id}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain(stores[`rtb${run}`]!.name);
  });

  it("una cabecera de prefetch no salta el proxy (revisión de seguridad del gate)", async () => {
    const target = stores[`rtd${run}`]!;
    const variants: Record<string, string>[] = [
      { purpose: "prefetch" },
      { "next-router-prefetch": "1" },
    ];
    for (const headers of variants) {
      const res = await get(stores[`rta${run}`]!.host, `/_store/${target.id}`, {
        ...headers,
        "x-store-preview": "1",
      });
      expect(res.status).toBe(404);
      expect(res.body).not.toContain(target.name);
    }
  });

  it("cabeceras del cliente no eligen otra tienda", async () => {
    const res = await get(stores[`rta${run}`]!.host, "/", {
      "x-forwarded-host": stores[`rtb${run}`]!.host,
      "x-store-id": stores[`rtb${run}`]!.id,
    });
    expect(res.body).toContain(stores[`rta${run}`]!.name);
    expect(res.body).not.toContain(stores[`rtb${run}`]!.name);
  });

  it("inexistente y borrador sin vista previa: el mismo 404", async () => {
    const missing = await get(`nada${run}.localhost`, "/");
    const draft = await get(stores[`rtd${run}`]!.host, "/");
    expect(missing.status).toBe(404);
    expect(draft.status).toBe(404);
    expect(draft.body).toBe(missing.body);
  });

  it("pausada: 503 de mantenimiento", async () => {
    const res = await get(stores[`rtp${run}`]!.host, "/");
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("300");
  });

  it("vista previa de un borrador: canje del token y cookie de esa tienda (CF-09)", async () => {
    const secret = process.env.PREVIEW_HMAC_SECRET;
    if (!secret) throw new Error("Falta PREVIEW_HMAC_SECRET (el mismo que usa la app).");
    const draft = stores[`rtd${run}`]!;
    const token = createPreviewToken(secret, draft.id, Math.floor(Date.now() / 1000));

    const redeem = await get(draft.host, `/_preview?token=${token}`);
    expect(redeem.status).toBe(303);
    const cookie = String(redeem.headers["set-cookie"]?.[0] ?? "").split(";")[0]!;
    expect(cookie).toMatch(/^__preview=/);

    const page = await get(draft.host, "/", { cookie });
    expect(page.status).toBe(200);
    expect(page.body).toContain("Vista previa");
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");

    // La cookie de una tienda no abre otra tienda en borrador.
    const other = await get(stores[`rta${run}`]!.host, "/", { cookie });
    expect(other.body).not.toContain("Vista previa");
    const wrongToken = await get(stores[`rta${run}`]!.host, `/_preview?token=${token}`);
    expect(wrongToken.status).toBe(404);
  });

  it("el host del panel no se resuelve como tienda", async () => {
    const res = await get(PANEL_HOST, "/");
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("Tienda no disponible");
  });

  it("las rutas del storefront existen desde la Fase 5; una ruta desconocida responde 404", async () => {
    expect((await get(stores[`rta${run}`]!.host, "/productos")).status).toBe(200);
    expect((await get(stores[`rta${run}`]!.host, "/no-existe")).status).toBe(404);
  });
});
