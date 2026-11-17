import { beforeEach, describe, expect, it, vi } from "vitest";

const callRpc = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/platform", () => ({
  requirePlatformRole: vi.fn(async () => "platform_owner"),
}));
vi.mock("@/server/actions/report", () => ({
  reportActionError: (_: string, e: unknown) => ({ code: "unexpected", message: String(e) }),
}));
vi.mock("@/server/db/rpc", () => ({ callRpc: (...args: unknown[]) => callRpc(...args) }));
vi.mock("@/server/jobs/run-now", () => ({ processQueueSoon: vi.fn() }));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));

import { createTenant, savePlanPricing, setSetupFeeSettled } from "./actions";

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

/** ADR-068: precios aprobados, cuota de arranque y días de prueba del plan. */
describe("consola: precios y cuota de arranque", () => {
  beforeEach(() => callRpc.mockReset());

  it("guarda mensual, anual, prueba y cuota en centavos con la función de 5 argumentos", async () => {
    callRpc.mockResolvedValue(null);
    const r = await savePlanPricing(
      "tienda",
      {},
      form({ price_monthly: "699", price_annual: "6,990", trial_days: "14", setup_fee: "2900" }),
    );
    expect(r).toMatchObject({ ok: true });
    expect(callRpc).toHaveBeenCalledWith(expect.anything(), "platform_set_plan_pricing", {
      p_key: "tienda",
      p_price_monthly: 69900,
      p_price_annual: 699000,
      p_trial_days: 14,
      p_setup_fee: 290000,
    });
  });

  it("cuota vacía = sin cuota; importe inválido no llega a la base", async () => {
    callRpc.mockResolvedValue(null);
    await savePlanPricing("tienda", {}, form({ price_monthly: "699", setup_fee: "" }));
    expect(callRpc.mock.calls[0]![2]).toMatchObject({ p_setup_fee: null });
    callRpc.mockReset();
    const bad = await savePlanPricing("tienda", {}, form({ setup_fee: "dos mil" }));
    expect(bad.fields?.setup_fee).toBeDefined();
    expect(callRpc).not.toHaveBeenCalled();
  });

  it("marcar la cuota como saldada exige elegir qué hacer y manda el motivo", async () => {
    callRpc.mockResolvedValue(null);
    const none = await setSetupFeeSettled("org-1", {}, form({ reason: "Pagó por transferencia" }));
    expect(none.fields?.settled).toBeDefined();
    expect(callRpc).not.toHaveBeenCalled();
    const ok = await setSetupFeeSettled(
      "org-1",
      {},
      form({ settled: "true", reason: "Pagó por transferencia" }),
    );
    expect(ok).toMatchObject({ ok: true });
    expect(callRpc).toHaveBeenCalledWith(expect.anything(), "platform_set_setup_fee_settled", {
      p_organization_id: "org-1",
      p_settled: true,
      p_reason: "Pagó por transferencia",
    });
  });
});

describe("consola: alta de tienda con los días de prueba del plan", () => {
  beforeEach(() => callRpc.mockReset());
  const tenant = {
    org_name: "Ferretería",
    org_slug: "ferreteria",
    owner_email: "duena@ferreteria.mx",
    store_name: "Ferretería",
    store_handle: "ferreteria",
    plan: "tienda",
  };
  const rpc = (trialDays: number | null) =>
    callRpc.mockImplementation(async (_: unknown, name: string) =>
      name === "platform_list_plans"
        ? [{ key: "tienda", trial_days: trialDays }]
        : { hostname: "ferreteria.example" },
    );

  it("usa los días del plan", async () => {
    rpc(14);
    await createTenant({}, form(tenant));
    const create = callRpc.mock.calls.find(
      (c) => c[1] === "platform_create_organization_with_store",
    );
    expect(create![2]).toMatchObject({ p_plan_key: "tienda", p_trial_days: 14 });
  });

  it("sin días en el plan deja los 14 por omisión de la base", async () => {
    rpc(null);
    await createTenant({}, form(tenant));
    const create = callRpc.mock.calls.find(
      (c) => c[1] === "platform_create_organization_with_store",
    );
    expect(create![2]).not.toHaveProperty("p_trial_days");
  });
});
