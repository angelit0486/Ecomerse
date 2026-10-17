import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LoggerModule from "@/server/observability/logger";
import type { HostResolution } from "@/server/routing/storefront-decision";
import { createPreviewToken } from "@/server/storefront/preview";

const SECRET = "p".repeat(32);
const STORE = "0190a0d0-0000-7000-8000-00000000000a";
const OTHER = "0190a0d0-0000-7000-8000-00000000000b";

vi.mock("@/server/env", () => ({
  serverEnv: () => ({
    APP_ENV: "test",
    APP_HOSTNAME: "app.example.test",
    PREVIEW_HMAC_SECRET: SECRET,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-for-tests-000000",
  }),
}));

vi.mock("@/server/observability/logger", async (original) => {
  const actual = await original<typeof LoggerModule>();
  return { ...actual, createLogger: () => actual.createLogger({ sink: () => {} }) };
});

const resolutions = new Map<string, HostResolution>();
let resolveFails = false;
vi.mock("@/server/storefront/resolve-host", () => ({
  resolveHost: async (host: string) => {
    if (resolveFails) throw new Error("db down");
    return resolutions.get(host) ?? null;
  },
}));

const { proxy, config } = await import("./proxy");
const { STORE_ROUTE_HEADER, verifyStoreRoute } =
  await import("@/server/storefront/route-signature");

const now = () => Math.floor(Date.now() / 1000);

/** Como en producción: el header Host coincide con el host de la URL. */
function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers: { host: new URL(url).host, ...headers } });
}

function store(patch: Partial<HostResolution> = {}): HostResolution {
  return {
    storeId: STORE,
    status: "active",
    primaryHostname: "tienda-a.tiendas.test",
    isPrimary: true,
    ...patch,
  };
}

beforeEach(() => {
  resolutions.clear();
  resolveFails = false;
});

describe("proxy · cabeceras", () => {
  it("aplica CSP con nonce y cabeceras de seguridad a la respuesta", async () => {
    const response = await proxy(req("https://app.example.test/"));
    const csp = response.headers.get("content-security-policy");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]+=*' 'strict-dynamic'/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("asigna un request_id propio e ignora el enviado por el cliente", async () => {
    const response = await proxy(
      req("https://app.example.test/", { "x-request-id": "valor-del-cliente" }),
    );
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe("valor-del-cliente");
  });

  it("webhook de Mercado Pago: conserva su x-request-id firmado en una cabecera interna", async () => {
    const mp = await proxy(
      req("https://app.example.test/api/webhooks/payments/mercadopago?data.id=1", {
        "x-request-id": "bb56a2f1-6aae-46ac-982e-9dcd3581d08e",
      }),
    );
    expect(mp.headers.get("x-middleware-request-x-upstream-request-id")).toBe(
      "bb56a2f1-6aae-46ac-982e-9dcd3581d08e",
    );
    // En cualquier otra ruta no se copia, y el cliente nunca la inyecta directamente.
    const other = await proxy(
      req("https://app.example.test/api/health", {
        "x-request-id": "valor",
        "x-upstream-request-id": "inyectado",
      }),
    );
    expect(other.headers.get("x-middleware-request-x-upstream-request-id")).toBeNull();
  });

  it("usa un nonce distinto en cada request", async () => {
    const a = (await proxy(req("https://app.example.test/"))).headers.get(
      "content-security-policy",
    );
    const b = (await proxy(req("https://app.example.test/"))).headers.get(
      "content-security-policy",
    );
    expect(a).not.toBe(b);
  });
});

describe("proxy · rutas internas", () => {
  it.each(["https://app.example.test/_store/x", "https://tienda-a.tiendas.test/_store/" + OTHER])(
    "bloquea /_store desde fuera: %s",
    async (url) => {
      resolutions.set("tienda-a.tiendas.test", store());
      expect((await proxy(req(url))).status).toBe(404);
    },
  );
});

describe("proxy · host de tienda (GATE0 §21.1)", () => {
  it("reescribe al store_id resuelto desde store_domains", async () => {
    resolutions.set("tienda-a.tiendas.test", store());
    const response = await proxy(req("https://tienda-a.tiendas.test/productos?orden=precio"));
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/_store/${STORE}/productos?orden=precio`,
    );
  });

  it("el cliente no puede inyectar cabeceras internas", async () => {
    resolutions.set("tienda-a.tiendas.test", store());
    const response = await proxy(
      req("https://tienda-a.tiendas.test/", { "x-store-id": OTHER, "x-store-preview": "1" }),
    );
    expect(response.headers.get("x-middleware-request-x-store-id")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-store-preview")).toBeNull();
  });

  it("x-forwarded-host no cambia la tienda", async () => {
    resolutions.set("tienda-a.tiendas.test", store());
    resolutions.set("tienda-b.tiendas.test", store({ storeId: OTHER }));
    const response = await proxy(
      req("https://tienda-a.tiendas.test/", { "x-forwarded-host": "tienda-b.tiendas.test" }),
    );
    expect(response.headers.get("x-middleware-rewrite")).toContain(STORE);
  });

  it("tienda inexistente: 404 genérico", async () => {
    const response = await proxy(req("https://no-existe.tiendas.test/"));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Tienda no disponible");
  });

  it("tienda suspendida: 503 con Retry-After", async () => {
    resolutions.set("tienda-a.tiendas.test", store({ status: "suspended" }));
    const response = await proxy(req("https://tienda-a.tiendas.test/"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
  });

  it("si la resolución falla: 503, nunca otra tienda", async () => {
    resolveFails = true;
    expect((await proxy(req("https://tienda-a.tiendas.test/"))).status).toBe(503);
  });

  it("host no primario: 301 al primario", async () => {
    resolutions.set("www.mitienda.mx", store({ isPrimary: false }));
    const response = await proxy(req("https://www.mitienda.mx/productos?x=1"));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://tienda-a.tiendas.test/productos?x=1");
  });
});

describe("proxy · vista previa de borradores (CF-09)", () => {
  beforeEach(() => {
    resolutions.set("tienda-a.tiendas.test", store({ status: "draft" }));
  });

  it("borrador sin vista previa: 404", async () => {
    expect((await proxy(req("https://tienda-a.tiendas.test/"))).status).toBe(404);
  });

  it("canje del token: cookie host-only HttpOnly y redirección", async () => {
    const token = createPreviewToken(SECRET, STORE, now());
    const response = await proxy(req(`https://tienda-a.tiendas.test/_preview?token=${token}`));
    expect(response.status).toBe(303);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__preview=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("un token de otra tienda no sirve", async () => {
    const token = createPreviewToken(SECRET, OTHER, now());
    const response = await proxy(req(`https://tienda-a.tiendas.test/_preview?token=${token}`));
    expect(response.status).toBe(404);
  });

  it("con la cookie válida: se sirve con noindex y sin caché", async () => {
    const token = createPreviewToken(SECRET, STORE, now());
    const response = await proxy(
      req("https://tienda-a.tiendas.test/", { cookie: `__preview=${token}` }),
    );
    expect(response.headers.get("x-middleware-rewrite")).toContain(`/_store/${STORE}`);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("proxy · sin rutas que lo salten", () => {
  it("el matcher no exime ninguna cabecera (p. ej. prefetch)", () => {
    expect(JSON.stringify(config.matcher)).not.toContain("missing");
  });

  it("la reescritura lleva la firma de la tienda resuelta; la del cliente se descarta", async () => {
    resolutions.set("tienda-a.tiendas.test", store());
    const response = await proxy(
      req("https://tienda-a.tiendas.test/", { [STORE_ROUTE_HEADER]: "f".repeat(64) }),
    );
    const signature = response.headers.get(`x-middleware-request-${STORE_ROUTE_HEADER}`);
    expect(verifyStoreRoute(SECRET, STORE, signature)).toEqual({ preview: false });
    expect(verifyStoreRoute(SECRET, OTHER, signature)).toBeNull();
  });
});
