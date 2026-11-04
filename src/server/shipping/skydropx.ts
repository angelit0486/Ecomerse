/**
 * Adaptador de Skydropx PRO (ADR-057). Forma tomada de la documentación oficial
 * (pro.skydropx.com/es-MX/api-docs, leída el 2026-11-04): token OAuth por
 * client credentials (2 h), cotización asíncrona (POST y luego GET hasta
 * `is_completed`), tarifas válidas 24 h. Ninguna llamada ocurre dentro de una
 * transacción de base de datos (§44.10). El cuerpo de error nunca sale de aquí.
 *
 * [NO VERIFICADO contra el sandbox]: el envoltorio `quotation` del cuerpo de la
 * cotización y el host de sandbox. Se confirman con la cuenta de pruebas.
 */
import { AppError } from "@/server/errors";
import { ProviderHttpError } from "@/server/payments/provider";

export const SKYDROPX_PRODUCTION_BASE = "https://pro.skydropx.com";

export class SkydropxHttpError extends ProviderHttpError {
  constructor(httpStatus: number, path: string, method: string) {
    super(httpStatus, "skydropx", path, method);
  }
}

export interface SkydropxCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SkydropxAddress {
  countryCode: string;
  postalCode: string;
  /** Estado. */
  state: string;
  /** Municipio o ciudad. */
  city: string;
  /** Colonia. */
  neighborhood: string;
}

export interface SkydropxParcel {
  /** Centímetros. */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Kilogramos. */
  weightKg: number;
}

export interface ShippingRate {
  rateId: string;
  carrier: string;
  service: string;
  days: number | null;
  /** Centavos. */
  total: number;
  currency: string;
}

interface Config {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface RawRate {
  id?: unknown;
  success?: unknown;
  provider_name?: unknown;
  provider_display_name?: unknown;
  provider_service_name?: unknown;
  currency_code?: unknown;
  total?: unknown;
  days?: unknown;
}

const ID_RE = /^[A-Za-z0-9-]{1,80}$/;
const POSTAL_RE = /^\d{5}$/;

/** Pesos con decimales (número o texto) → centavos enteros; null si no es válido. */
export function toCents(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
}

/** Solo tarifas exitosas, en MXN y con datos completos; de la más barata a la más cara. */
export function normalizeRates(rates: unknown): ShippingRate[] {
  if (!Array.isArray(rates)) return [];
  const out: ShippingRate[] = [];
  for (const r of rates as RawRate[]) {
    const total = toCents(r.total);
    const id = typeof r.id === "string" ? r.id : "";
    const currency = typeof r.currency_code === "string" ? r.currency_code.toUpperCase() : "";
    const carrier =
      typeof r.provider_display_name === "string" && r.provider_display_name
        ? r.provider_display_name
        : typeof r.provider_name === "string"
          ? r.provider_name
          : "";
    if (r.success !== true || total === null || !ID_RE.test(id) || currency !== "MXN" || !carrier)
      continue;
    out.push({
      rateId: id,
      carrier: carrier.slice(0, 60),
      service:
        typeof r.provider_service_name === "string" ? r.provider_service_name.slice(0, 80) : "",
      days: typeof r.days === "number" && Number.isInteger(r.days) && r.days >= 0 ? r.days : null,
      total,
      currency,
    });
  }
  return out.sort((a, b) => a.total - b.total || (a.days ?? 99) - (b.days ?? 99));
}

const address = (a: SkydropxAddress) => {
  if (
    !POSTAL_RE.test(a.postalCode) ||
    !a.state.trim() ||
    !a.city.trim() ||
    !a.neighborhood.trim()
  ) {
    throw new AppError(
      "validation_failed",
      "Revisa la dirección: estado, municipio, colonia y CP.",
    );
  }
  return {
    country_code: a.countryCode.toUpperCase(),
    postal_code: a.postalCode,
    area_level1: a.state.trim().slice(0, 80),
    area_level2: a.city.trim().slice(0, 80),
    area_level3: a.neighborhood.trim().slice(0, 80),
  };
};

const parcel = (p: SkydropxParcel) => {
  const dims = [p.lengthCm, p.widthCm, p.heightCm, p.weightKg];
  if (dims.some((d) => !Number.isFinite(d) || d <= 0 || d > 1000)) {
    throw new AppError("validation_failed", "Revisa las medidas y el peso del paquete.");
  }
  return { length: p.lengthCm, width: p.widthCm, height: p.heightCm, weight: p.weightKg };
};

export class SkydropxApi {
  private tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly cfg: Config = {}) {}

  private get base() {
    return this.cfg.apiBase ?? SKYDROPX_PRODUCTION_BASE;
  }

  private now() {
    return (this.cfg.now ?? Date.now)();
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await (this.cfg.fetchImpl ?? fetch)(`${this.base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new AppError("provider_error", undefined, { cause: error });
    }
    if (!response.ok) throw new SkydropxHttpError(response.status, path, init.method ?? "GET");
    return response;
  }

  /** Token de la cuenta; se reutiliza hasta un minuto antes de vencer. Sirve para validar las llaves. */
  async token(c: SkydropxCredentials): Promise<string> {
    const cached = this.tokens.get(c.clientId);
    if (cached && cached.expiresAt - 60_000 > this.now()) return cached.token;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: c.clientId,
      client_secret: c.clientSecret,
    });
    const res = await this.send("/api/v1/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const j = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== "string" || !j.access_token) throw new AppError("provider_error");
    const ttl = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 7200;
    this.tokens.set(c.clientId, { token: j.access_token, expiresAt: this.now() + ttl * 1000 });
    return j.access_token;
  }

  private async json<T>(
    c: SkydropxCredentials,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ) {
    const token = await this.token(c);
    const res = await this.send(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return (await res.json()) as T;
  }

  /**
   * Cotiza y espera a que la cotización termine (`is_completed`), como pide la
   * documentación. Devuelve las tarifas utilizables, la más barata primero.
   */
  async quote(
    c: SkydropxCredentials,
    input: { from: SkydropxAddress; to: SkydropxAddress; parcel: SkydropxParcel },
    opts: { attempts?: number; intervalMs?: number } = {},
  ): Promise<{ quotationId: string; rates: ShippingRate[] }> {
    const created = await this.json<{ id?: unknown }>(c, "POST", "/api/v1/quotations", {
      quotation: {
        address_from: address(input.from),
        address_to: address(input.to),
        parcels: [parcel(input.parcel)],
      },
    });
    const id = typeof created.id === "string" ? created.id : "";
    if (!ID_RE.test(id)) throw new AppError("provider_error");
    const sleep = this.cfg.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const attempts = opts.attempts ?? 6;
    for (let i = 0; i < attempts; i += 1) {
      const q = await this.json<{ is_completed?: unknown; rates?: unknown }>(
        c,
        "GET",
        `/api/v1/quotations/${id}`,
      );
      if (q.is_completed === true || i === attempts - 1) {
        return { quotationId: id, rates: normalizeRates(q.rates) };
      }
      await sleep(opts.intervalMs ?? 1_000);
    }
    return { quotationId: id, rates: [] };
  }
}
