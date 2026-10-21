import { resolveTxt } from "node:dns/promises";

/**
 * DomainProvider (GATE0 «Dominio propio», E16): el hosting que sirve la tienda en
 * el dominio y emite su certificado. Hoy Vercel; el resto del sistema solo ve
 * esta interfaz. Nada de esto corre dentro de una transacción (§44.10).
 */
export type ProviderState = "ready" | "pending" | "not_configured";

export interface DomainProvider {
  /** Idempotente: si el dominio ya está en el proyecto, no falla. */
  add(hostname: string): Promise<{ ref: string | null }>;
  /** `ready` cuando el DNS apunta bien y el certificado está emitido. */
  state(hostname: string): Promise<ProviderState>;
}

export const notConfiguredProvider: DomainProvider = {
  add: async () => ({ ref: null }),
  state: async () => "not_configured",
};

export interface VercelConfig {
  token: string;
  projectId: string;
  teamId?: string;
  apiBase?: string;
  fetch?: typeof fetch;
}

export function vercelDomainProvider(config: VercelConfig): DomainProvider {
  const base = config.apiBase ?? "https://api.vercel.com";
  const doFetch = config.fetch ?? fetch;
  const url = (path: string) => {
    const u = new URL(path, base);
    if (config.teamId) u.searchParams.set("teamId", config.teamId);
    return u;
  };
  const call = (path: string, init?: RequestInit) =>
    doFetch(url(path), {
      ...init,
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  const project = encodeURIComponent(config.projectId);

  return {
    async add(hostname) {
      const res = await call(`/v10/projects/${project}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: hostname }),
      });
      // 409: ya está en este proyecto (reintento del job).
      if (res.ok || res.status === 409) return { ref: config.projectId };
      throw new Error(`vercel add domain: ${res.status}`);
    },
    async state(hostname) {
      const name = encodeURIComponent(hostname);
      const [domain, cfg] = await Promise.all([
        call(`/v9/projects/${project}/domains/${name}`),
        call(`/v6/domains/${name}/config`),
      ]);
      if (domain.status === 404) return "pending";
      if (!domain.ok || !cfg.ok)
        throw new Error(`vercel domain state: ${domain.status}/${cfg.status}`);
      const d = (await domain.json()) as { verified?: boolean };
      const c = (await cfg.json()) as { misconfigured?: boolean };
      return d.verified === true && c.misconfigured === false ? "ready" : "pending";
    },
  };
}

/** Nombre del TXT de propiedad (contrato GATE0). */
export function verificationRecordName(hostname: string): string {
  return `_platform-verify.${hostname}`;
}

export type TxtLookup = (name: string) => Promise<string[]>;

/** TXT sin registro = lista vacía; otros fallos (red) se propagan y el job reintenta. */
export const dnsTxtLookup: TxtLookup = async (name) => {
  try {
    const records = await resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ENOTIMP") return [];
    throw error;
  }
};
