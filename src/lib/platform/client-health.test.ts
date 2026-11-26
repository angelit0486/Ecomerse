import { describe, expect, it } from "vitest";

import {
  clientSignals,
  clientStatuses,
  lightOf,
  storeOverview,
  type StoreOverviewRow,
} from "./client-health";

const NOW = new Date("2026-11-26T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

/** Tienda sana: publicada hace tiempo, vendiendo y con el equipo activo. */
function healthy(over: Partial<StoreOverviewRow> = {}): StoreOverviewRow {
  return {
    store_id: "s1",
    store_name: "Tienda Uno",
    handle: "uno",
    store_status: "active",
    store_created_at: daysAgo(120),
    launched_at: daysAgo(100),
    organization_id: "o1",
    organization_name: "Org Uno",
    organization_status: "active",
    owner_email: "duena@uno.mx",
    plan_key: "basico",
    subscription_status: "active",
    trial_ends_at: null,
    grace_ends_at: null,
    products_active: 40,
    paid_orders_30d: 12,
    last_paid_at: daysAgo(1),
    stale_pending_payments: 0,
    unshipped_paid: 0,
    orders_need_attention: 0,
    dead_jobs_7d: 0,
    last_staff_sign_in_at: daysAgo(2),
    total_count: 1,
    ...over,
  };
}
const codes = (row: StoreOverviewRow) => clientSignals(row, NOW).map((s) => s.code);

describe("semáforo de cada cliente («Mis clientes»)", () => {
  it("una tienda sana queda en verde, sin motivos", () => {
    expect(clientSignals(healthy(), NOW)).toEqual([]);
    expect(lightOf(clientSignals(healthy(), NOW))).toBe("green");
  });

  it("rojo cuando algo ya afecta a sus compradores o a su cuenta, con el motivo en español", () => {
    const s = clientSignals(
      healthy({
        stale_pending_payments: 2,
        unshipped_paid: 1,
        orders_need_attention: 3,
        dead_jobs_7d: 1,
      }),
      NOW,
    );
    expect(s.map((x) => x.text)).toEqual([
      "2 transferencias sin confirmar desde hace más de 24 h",
      "1 pedido pagado sin enviar desde hace más de 3 días",
      "3 pedidos marcados para revisión",
      "1 trabajo en segundo plano falló esta semana (fotos, importaciones o correos)",
    ]);
    expect(lightOf(s)).toBe("red");
  });

  it("rojo: organización suspendida, plan vencido (con fin de gracia) y tienda publicada sin productos", () => {
    expect(codes(healthy({ organization_status: "suspended" }))).toContain("org_suspended");
    const due = clientSignals(
      healthy({ subscription_status: "past_due", grace_ends_at: "2026-12-03T00:00:00Z" }),
      NOW,
    );
    expect(due[0]?.text).toBe("Pago del plan vencido (gracia hasta el 3 dic)");
    expect(codes(healthy({ products_active: 0 }))).toContain("no_products");
    // En preparación (borrador) aún no se le piden productos.
    expect(
      codes(healthy({ store_status: "draft", products_active: 0, launched_at: null })),
    ).not.toContain("no_products");
  });

  it("amarillo: sin ventas en 30 días, salvo si se lanzó hace menos de 14 días", () => {
    expect(codes(healthy({ paid_orders_30d: 0 }))).toEqual(["no_sales"]);
    expect(codes(healthy({ paid_orders_30d: 0, launched_at: daysAgo(5) }))).toEqual([]);
  });

  it("amarillo: el equipo nunca entró o dejó de entrar hace 14 días o más", () => {
    expect(codes(healthy({ last_staff_sign_in_at: null }))).toEqual(["never_signed_in"]);
    expect(clientSignals(healthy({ last_staff_sign_in_at: daysAgo(20) }), NOW)[0]?.text).toBe(
      "Nadie del equipo entra al panel desde hace 20 días",
    );
    expect(codes(healthy({ last_staff_sign_in_at: daysAgo(13) }))).toEqual([]);
  });

  it("amarillo: atorada en preparación, prueba por terminar y sin plan", () => {
    expect(
      codes(healthy({ store_status: "draft", launched_at: null, store_created_at: daysAgo(30) })),
    ).toEqual(["stuck_draft"]);
    expect(
      clientSignals(
        healthy({ subscription_status: "trialing", trial_ends_at: "2026-11-30T12:00:00Z" }),
        NOW,
      )[0]?.text,
    ).toBe("La prueba termina el 30 nov");
    // Una prueba que termina en 20 días, o que ya terminó, no avisa.
    expect(codes(healthy({ subscription_status: "trialing", trial_ends_at: inDays(20) }))).toEqual(
      [],
    );
    expect(codes(healthy({ subscription_status: "trialing", trial_ends_at: daysAgo(2) }))).toEqual(
      [],
    );
    expect(codes(healthy({ plan_key: null, subscription_status: null }))).toEqual(["no_plan"]);
  });

  it("la lista pone primero a quien más ayuda necesita", () => {
    const list = clientStatuses(
      [
        healthy({ store_id: "verde", store_name: "A verde" }),
        healthy({ store_id: "ambar", store_name: "B ámbar", paid_orders_30d: 0 }),
        healthy({ store_id: "rojo1", store_name: "C rojo", dead_jobs_7d: 1 }),
        healthy({ store_id: "rojo2", store_name: "D rojo", dead_jobs_7d: 1, unshipped_paid: 2 }),
      ],
      NOW,
    );
    expect(list.map((c) => c.row.store_id)).toEqual(["rojo2", "rojo1", "ambar", "verde"]);
    expect(list.map((c) => c.light)).toEqual(["red", "red", "amber", "green"]);
  });

  it("valida la forma que entrega la base", () => {
    expect(storeOverview.safeParse([healthy()]).success).toBe(true);
    expect(storeOverview.safeParse([{ ...healthy(), paid_orders_30d: "12" }]).success).toBe(false);
  });
});
