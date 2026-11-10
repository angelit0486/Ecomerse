import { describe, expect, it, vi } from "vitest";

import type { Sql } from "@/server/db/role-clients";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import type { Logger } from "@/server/observability/logger";

import { createDomainHandlers } from "./handlers";
import { DomainTakenError, notConfiguredProvider, type DomainProvider } from "./provider";

const DOMAIN = "0191f3a0-0000-7000-8000-000000000001";
const HOST = "pruva-tienda-cafe.vercel.app";

/** Base de mentira: responde según la función de `system` que se llame. */
function fakeDb(target: { store_id: string; hostname: string } | null, calls: string[]) {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push(`${text.replace(/\s+/g, " ").trim()} ${JSON.stringify(values)}`);
    if (text.includes("domains_platform_target")) return Promise.resolve([{ target }]);
    if (text.includes("domains_platform_attached")) return Promise.resolve([{ ok: true }]);
    return Promise.reject(new Error(`consulta inesperada: ${text}`));
  }) as unknown as Sql;
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log } as unknown as Logger;

function attach(db: Sql, provider: DomainProvider): JobHandler {
  const entry = createDomainHandlers({ db, provider, txt: async () => [] }).find(
    ([type]) => type === "domains.attach_platform",
  );
  return entry![1];
}

const job = (payload: Record<string, unknown>) => ({
  id: "job",
  type: "domains.attach_platform",
  storeId: "s1",
  payload,
  attempts: 1,
  maxAttempts: 8,
});
const ctx = { log, deadline: Date.now() + 10_000 };

describe("job domains.attach_platform", () => {
  it("da de alta la dirección en el hosting y lo anota", async () => {
    const calls: string[] = [];
    const add = vi.fn(async () => ({ ref: "prj_1" }));
    await attach(fakeDb({ store_id: "s1", hostname: HOST }, calls), {
      ...notConfiguredProvider,
      add,
    })(job({ domain_id: DOMAIN }), ctx);
    expect(add).toHaveBeenCalledWith(HOST);
    expect(calls[1]).toContain("domains_platform_attached");
    expect(calls[1]).toContain(`["${DOMAIN}","prj_1"]`);
  });

  it("ya dada de alta (o no es de la plataforma): no llama al hosting", async () => {
    const calls: string[] = [];
    const add = vi.fn(async () => ({ ref: "prj_1" }));
    await attach(fakeDb(null, calls), { ...notConfiguredProvider, add })(
      job({ domain_id: DOMAIN }),
      ctx,
    );
    expect(add).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("sin proveedor configurado no anota nada", async () => {
    const calls: string[] = [];
    await attach(fakeDb({ store_id: "s1", hostname: HOST }, calls), notConfiguredProvider)(
      job({ domain_id: DOMAIN }),
      ctx,
    );
    expect(calls).toHaveLength(1);
  });

  it("si otro proyecto tiene la dirección, no reintenta; un fallo de red sí", async () => {
    const taken = {
      ...notConfiguredProvider,
      add: async () => Promise.reject(new DomainTakenError(HOST)),
    };
    await expect(
      attach(fakeDb({ store_id: "s1", hostname: HOST }, []), taken)(
        job({ domain_id: DOMAIN }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(PermanentJobError);
    const down = { ...notConfiguredProvider, add: async () => Promise.reject(new Error("red")) };
    const error = await attach(fakeDb({ store_id: "s1", hostname: HOST }, []), down)(
      job({ domain_id: DOMAIN }),
      ctx,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentJobError);
  });

  it("un payload sin id válido no se reintenta", async () => {
    await expect(
      attach(fakeDb(null, []), notConfiguredProvider)(job({ domain_id: "x" }), ctx),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });
});
