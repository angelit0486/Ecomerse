import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * Descarga de una imagen remota para la importación (ADR-033, GATE0 T-08: SSRF).
 *
 *   - Solo `https` al puerto 443, sin usuario ni contraseña en la URL.
 *   - El nombre se resuelve aquí y se rechaza si CUALQUIER dirección es privada,
 *     de loopback, link-local, de metadatos, multicast o reservada; la conexión
 *     va a la IP ya validada (`lookup` fijo), así un DNS que cambia entre la
 *     validación y la conexión no puede apuntar a la red interna.
 *   - Redirecciones: como mucho 3, solo al mismo host y por https.
 *   - Límite de tiempo total y de bytes (se corta al pasarlo, sin leer el resto).
 *
 * Devuelve los bytes sin interpretar: el tipo se valida por su contenido y la
 * imagen pasa después por el worker de medios (recodificación, §25.3).
 */

export type RemoteFetchFailure =
  /** Dirección no permitida (esquema, puerto, IP interna, redirección a otro host). */
  | "fetch_blocked"
  /** 404/410 u otra respuesta 4xx: el enlace no lleva a una imagen. */
  | "fetch_not_found"
  | "fetch_too_large"
  /** Red, tiempo o 5xx/429: se puede reintentar. */
  | "fetch_failed";

export type RemoteFetchResult =
  | { ok: true; data: Buffer; contentType: string | null }
  | { ok: false; reason: RemoteFetchFailure; retryable: boolean; detail?: string };

export interface RemoteFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Resolución DNS (inyectable en pruebas). Devuelve todas las direcciones. */
  resolve?: (hostname: string) => Promise<{ address: string; family: 4 | 6 }[]>;
  /**
   * Solo desarrollo y pruebas: un origen exacto (p. ej. `http://127.0.0.1:4599`)
   * que se acepta aunque sea http o local. El entorno lo prohíbe en preview y
   * producción (src/config/env.ts).
   */
  testOrigin?: string;
  /** Certificados de confianza adicionales (solo pruebas con TLS local). */
  ca?: string | Buffer;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

// ---------------------------------------------------------------------------
// Direcciones públicas
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const V4_BLOCKED: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8], // «esta red»
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local y metadatos de la nube (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservada y broadcast
];

function inV4Range(value: number, base: string, bits: number): boolean {
  const start = ipv4ToInt(base)!;
  const size = 2 ** (32 - bits);
  return value >= start && value < start + size;
}

function isPublicIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return !V4_BLOCKED.some(([base, bits]) => inV4Range(value, base, bits));
}

/** IPv6 → 8 grupos de 16 bits (acepta «::» y un IPv4 al final). */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase();
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  let tail: number[] = [];
  const lastColon = address.lastIndexOf(":");
  if (address.slice(lastColon + 1).includes(".")) {
    const v4 = ipv4ToInt(address.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    address = `${address.slice(0, lastColon + 1)}0:0`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(":") : []);
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const values = groups.map((g) => parseInt(g, 16));
  if (tail.length) values.splice(6, 2, ...tail);
  return values;
}

function isPublicIpv6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return false;
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  // ::ffff:a.b.c.d (mapeada) y ::a.b.c.d (compatible): se juzga el IPv4.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicIpv4(embeddedV4(g[6]!, g[7]!));
  }
  // 64:ff9b::/96 (NAT64) también lleva un IPv4 dentro.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicIpv4(embeddedV4(g[6]!, g[7]!));
  }
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 (única local)
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 (link-local)
  if ((first & 0xffc0) === 0xfec0) return false; // fec0::/10 (site-local, obsoleta)
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 (multicast)
  if (first === 0x2001 && g[1] === 0x0db8) return false; // documentación
  if (first === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false; // 100::/64
  if (first === 0x2002) return false; // 6to4 (puede encapsular IPv4 privado)
  if (first === 0x2001 && g[1] === 0) return false; // Teredo
  return true;
}

/** true si la dirección es enrutable en internet público. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicIpv4(ip);
  if (family === 6) return isPublicIpv6(ip);
  return false;
}

// ---------------------------------------------------------------------------
// Descarga
// ---------------------------------------------------------------------------

interface Target {
  url: URL;
  address: string;
  family: 4 | 6;
  trustedTest: boolean;
}

const fail = (
  reason: RemoteFetchFailure,
  detail?: string,
  retryable = reason === "fetch_failed",
): RemoteFetchResult => ({ ok: false, reason, retryable, detail });

async function defaultResolve(hostname: string) {
  const all = await dnsLookup(hostname, { all: true, verbatim: true });
  return all.map((a) => ({ address: a.address, family: (a.family === 6 ? 6 : 4) as 4 | 6 }));
}

/** Valida la URL y resuelve su host a una IP pública (o al origen de pruebas). */
async function target(
  raw: string,
  options: RemoteFetchOptions,
): Promise<Target | RemoteFetchResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("fetch_blocked", "url");
  }
  if (url.username || url.password) return fail("fetch_blocked", "credentials");
  const trustedTest = Boolean(options.testOrigin) && url.origin === options.testOrigin;
  if (!trustedTest) {
    if (url.protocol !== "https:") return fail("fetch_blocked", "scheme");
    if (url.port && url.port !== "443") return fail("fetch_blocked", "port");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (!trustedTest && !isPublicAddress(hostname)) return fail("fetch_blocked", "address");
    return { url, address: hostname, family: isIP(hostname) as 4 | 6, trustedTest };
  }
  let addresses: { address: string; family: 4 | 6 }[];
  try {
    addresses = await (options.resolve ?? defaultResolve)(hostname);
  } catch {
    return fail("fetch_failed", "dns");
  }
  if (addresses.length === 0) return fail("fetch_failed", "dns");
  // Si una sola dirección es interna, no se usa ninguna (DNS con mezcla).
  if (!trustedTest && addresses.some((a) => !isPublicAddress(a.address))) {
    return fail("fetch_blocked", "address");
  }
  return { url, address: addresses[0]!.address, family: addresses[0]!.family, trustedTest };
}

type Hop = { kind: "done"; result: RemoteFetchResult } | { kind: "redirect"; location: string };

function requestOnce(t: Target, options: RemoteFetchOptions, signal: AbortSignal): Promise<Hop> {
  return new Promise((settle) => {
    // Un solo desenlace: el corte por tiempo puede llegar a media respuesta.
    let settled = false;
    const resolve = (hop: Hop) => {
      if (settled) return;
      settled = true;
      settle(hop);
    };
    const client = t.url.protocol === "https:" ? https : http;
    const req = client.request(
      t.url,
      {
        method: "GET",
        agent: false,
        signal,
        ca: options.ca,
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1",
          "user-agent": "PRUVA-Importador/1.0 (+https://pruva.mx)",
        },
        // Conexión a la IP ya validada; TLS sigue verificando el nombre del host.
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (opts?.all) cb(null, [{ address: t.address, family: t.family }]);
          else cb(null, t.address, t.family);
        }) as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ kind: "redirect", location: res.headers.location });
          return;
        }
        if (status === 429 || status >= 500) {
          res.resume();
          resolve({ kind: "done", result: fail("fetch_failed", `http_${status}`) });
          return;
        }
        if (status !== 200) {
          res.resume();
          resolve({ kind: "done", result: fail("fetch_not_found", `http_${status}`) });
          return;
        }
        const declared = Number(res.headers["content-length"] ?? NaN);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          res.destroy();
          resolve({ kind: "done", result: fail("fetch_too_large") });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            res.destroy();
            resolve({ kind: "done", result: fail("fetch_too_large") });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (size > options.maxBytes) return;
          resolve({
            kind: "done",
            result: {
              ok: true,
              data: Buffer.concat(chunks),
              contentType: (res.headers["content-type"] as string | undefined) ?? null,
            },
          });
        });
        res.on("error", () => resolve({ kind: "done", result: fail("fetch_failed", "stream") }));
        res.on("close", () =>
          resolve({
            kind: "done",
            result: fail("fetch_failed", signal.aborted ? "timeout" : "stream"),
          }),
        );
      },
    );
    req.on("error", (error: NodeJS.ErrnoException) => {
      const tls = /CERT|SSL|TLS/i.test(error.code ?? "") || /certificate/i.test(error.message);
      // Un certificado inválido no se arregla reintentando.
      resolve({
        kind: "done",
        result: signal.aborted
          ? fail("fetch_failed", "timeout")
          : tls
            ? fail("fetch_blocked", "tls")
            : fail("fetch_failed", error.code ?? "network"),
      });
    });
    req.on("close", () =>
      resolve({
        kind: "done",
        result: fail("fetch_failed", signal.aborted ? "timeout" : "closed"),
      }),
    );
    req.end();
  });
}

export async function fetchRemoteImage(
  url: string,
  options: RemoteFetchOptions,
): Promise<RemoteFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let current = url;
    let first: URL | null = null;
    for (let hop = 0; hop <= (options.maxRedirects ?? DEFAULT_MAX_REDIRECTS); hop++) {
      const t = await target(current, options);
      if (!("url" in t)) return t;
      first ??= t.url;
      const result = await requestOnce(t, options, controller.signal);
      if (result.kind === "done") return result.result;
      let next: URL;
      try {
        next = new URL(result.location, t.url);
      } catch {
        return fail("fetch_blocked", "redirect");
      }
      // Solo dentro del mismo host y por la misma vía; se decide antes de
      // resolver el DNS del destino.
      if (next.host !== first.host || next.protocol !== first.protocol) {
        return fail("fetch_blocked", "redirect_host");
      }
      current = next.toString();
    }
    return fail("fetch_blocked", "too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}
