import { describe, expect, it } from "vitest";

import { normalizeRates, SkydropxApi, SkydropxHttpError, toCents } from "./skydropx";

// Tarifa tal como la muestra el ejemplo oficial de GET /api/v1/quotations/{id}.
const officialRate = {
  id: "0ac5adcc-a13d-427d-81dd-9ddd70b2f660",
  success: true,
  provider_name: "fedex",
  provider_display_name: "FedEx",
  provider_service_name: "Standard Overnight",
  provider_service_code: "standard_overnight",
  status: "pending",
  currency_code: "MXN",
  amount: 150.0,
  total: 150.0,
  days: 2,
};

const creds = { clientId: "cid", clientSecret: "secret" };
const from = {
  countryCode: "MX",
  postalCode: "72000",
  state: "Puebla",
  city: "Puebla",
  neighborhood: "Centro",
};
const to = {
  countryCode: "mx",
  postalCode: "64000",
  state: "Nuevo León",
  city: "Monterrey",
  neighborhood: "Centro",
};
const box = { lengthCm: 20, widthCm: 15, heightCm: 10, weightKg: 1.2 };

function fakeServer(polls: { is_completed: boolean; rates: unknown[] }[]) {
  const calls: { method: string; path: string; body: string; auth: string | null }[] = [];
  let poll = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    calls.push({
      method: init.method ?? "GET",
      path,
      body: String(init.body ?? ""),
      auth: headers.get("authorization"),
    });
    if (path === "/api/v1/oauth/token") {
      return new Response(
        JSON.stringify({ access_token: "tok-1", token_type: "Bearer", expires_in: 7200 }),
      );
    }
    if (path === "/api/v1/quotations" && init.method === "POST") {
      return new Response(JSON.stringify({ id: "q-123" }), { status: 201 });
    }
    if (path === "/api/v1/quotations/q-123") {
      return new Response(JSON.stringify(polls[Math.min(poll++, polls.length - 1)]));
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return {
    calls,
    api: new SkydropxApi({ fetchImpl, apiBase: "https://sky.test", sleep: async () => {} }),
  };
}

describe("Skydropx: token", () => {
  it("client credentials en form-urlencoded; el token se reutiliza", async () => {
    const { api, calls } = fakeServer([]);
    expect(await api.token(creds)).toBe("tok-1");
    expect(await api.token(creds)).toBe("tok-1");
    const tokenCalls = calls.filter((c) => c.path === "/api/v1/oauth/token");
    expect(tokenCalls).toHaveLength(1);
    expect(new URLSearchParams(tokenCalls[0]!.body).get("grant_type")).toBe("client_credentials");
  });

  it("llaves inválidas: rechazo definitivo (401), sin el cuerpo de error", async () => {
    const api = new SkydropxApi({
      apiBase: "https://sky.test",
      fetchImpl: (async () =>
        new Response('{"error":"invalid_client"}', { status: 401 })) as unknown as typeof fetch,
    });
    const error = await api.token(creds).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SkydropxHttpError);
    expect((error as SkydropxHttpError).rejected).toBe(true);
    expect(String((error as Error).message)).not.toContain("invalid_client");
  });
});

describe("Skydropx: cotizar", () => {
  it("espera a is_completed y devuelve las tarifas de la más barata a la más cara", async () => {
    const { api, calls } = fakeServer([
      { is_completed: false, rates: [] },
      {
        is_completed: true,
        rates: [
          { ...officialRate, id: "r-caro", total: "320.50", provider_display_name: "DHL" },
          officialRate,
          { ...officialRate, id: "r-fallo", success: false },
          { ...officialRate, id: "r-usd", currency_code: "USD" },
        ],
      },
    ]);
    const q = await api.quote(creds, { from, to, parcel: box });
    expect(q.quotationId).toBe("q-123");
    expect(q.rates).toEqual([
      {
        rateId: officialRate.id,
        carrier: "FedEx",
        service: "Standard Overnight",
        days: 2,
        total: 15000,
        currency: "MXN",
      },
      {
        rateId: "r-caro",
        carrier: "DHL",
        service: "Standard Overnight",
        days: 2,
        total: 32050,
        currency: "MXN",
      },
    ]);
    const created = calls.find((c) => c.path === "/api/v1/quotations")!;
    expect(created.auth).toBe("Bearer tok-1");
    const body = JSON.parse(created.body) as { quotation: Record<string, unknown> };
    expect(body.quotation.address_to).toEqual({
      country_code: "MX",
      postal_code: "64000",
      area_level1: "Nuevo León",
      area_level2: "Monterrey",
      area_level3: "Centro",
    });
    expect(body.quotation.parcels).toEqual([{ length: 20, width: 15, height: 10, weight: 1.2 }]);
    expect(calls.filter((c) => c.path === "/api/v1/quotations/q-123")).toHaveLength(2);
  });

  it("dirección o paquete incompletos: no se llama a Skydropx", async () => {
    const { api, calls } = fakeServer([]);
    await expect(
      api.quote(creds, { from, to: { ...to, postalCode: "640" }, parcel: box }),
    ).rejects.toThrow();
    await expect(api.quote(creds, { from, to, parcel: { ...box, weightKg: 0 } })).rejects.toThrow();
    expect(calls.filter((c) => c.path === "/api/v1/quotations")).toHaveLength(0);
  });
});

describe("Skydropx: dinero", () => {
  it("pesos → centavos sin errores de redondeo; valores raros se descartan", () => {
    expect(toCents(150)).toBe(15000);
    expect(toCents("99.99")).toBe(9999);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-1)).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(normalizeRates("x")).toEqual([]);
  });
});

describe("toCents sin aritmética de punto flotante (regla 14; revisión 2026-11-05)", () => {
  it("redondea al centavo de forma exacta, también con más de 2 decimales", () => {
    expect(toCents("1.005")).toBe(101);
    expect(toCents(1.005)).toBe(101);
    expect(toCents("123.45")).toBe(12345);
    expect(toCents(0.29)).toBe(29);
    expect(toCents("99")).toBe(9900);
    expect(toCents("1.004")).toBe(100);
  });

  it("rechaza lo que no es un monto válido", () => {
    for (const bad of ["1e3", "-1", "abc", "", "1.2.3", 1_000_001, Number.NaN, null]) {
      expect(toCents(bad), String(bad)).toBeNull();
    }
  });
});
