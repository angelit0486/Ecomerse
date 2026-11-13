import "server-only";

import { sniffImageMime } from "@/server/media/image";
import { fetchRemoteImage, type RemoteFetchResult } from "@/server/media/remote-fetch";

/**
 * Revisar los enlaces de fotos de una importación ANTES de confirmarla (Orden 10,
 * O10-04). Usa el mismo descargador seguro que el worker (`fetchRemoteImage`:
 * solo https:443, cada IP resuelta debe ser pública, conexión fijada a la IP
 * validada contra DNS rebinding, cada redirección revalidada, tiempo y tamaño
 * limitados). No descarga la foto: lee los primeros bytes para saber su tipo real.
 *
 * Límites de cada revisión: enlaces distintos, concurrencia y tiempo total. Lo que
 * no alcanza a revisarse se informa como «sin revisar», nunca como correcto.
 */
export type PhotoCheckStatus =
  | "ok"
  | "blocked"
  | "not_found"
  | "no_domain"
  | "too_large"
  | "failed"
  | "not_image"
  | "not_checked";

export interface PhotoLink {
  url: string;
  /** Fila del archivo y nombre corto del producto, para encontrarla. */
  row: number;
  handle: string;
}

export interface PhotoCheckItem extends PhotoLink {
  status: PhotoCheckStatus;
}

export interface PhotoCheckResult {
  /** Enlaces distintos en el archivo. */
  total: number;
  checked: number;
  counts: Record<PhotoCheckStatus, number>;
  /** Solo los que tienen problema (o quedaron sin revisar), en orden de fila. */
  problems: PhotoCheckItem[];
}

export interface PhotoCheckLimits {
  maxLinks: number;
  concurrency: number;
  perLinkTimeoutMs: number;
  budgetMs: number;
  peekBytes: number;
  maxBytes: number;
}

export const PHOTO_CHECK_LIMITS: Readonly<PhotoCheckLimits> = {
  maxLinks: 500,
  concurrency: 6,
  perLinkTimeoutMs: 8_000,
  // Cabe con margen en una función de Vercel (la acción corre dentro de una).
  budgetMs: 25_000,
  /** Suficiente para reconocer JPEG, PNG, WebP y AVIF. */
  peekBytes: 64,
  /** El mismo máximo que el worker para fotos de producto (app.media_max_bytes). */
  maxBytes: 10 * 1024 * 1024,
};

export interface PhotoCheckDeps {
  fetch?: (
    url: string,
    options: Parameters<typeof fetchRemoteImage>[1],
  ) => Promise<RemoteFetchResult>;
  testOrigin?: string;
  now?: () => number;
  limits?: Partial<PhotoCheckLimits>;
}

function statusOf(result: RemoteFetchResult): PhotoCheckStatus {
  if (!result.ok) {
    switch (result.reason) {
      case "fetch_blocked":
        return "blocked";
      case "fetch_not_found":
        return "not_found";
      case "fetch_too_large":
        return "too_large";
      default:
        // D5: un dominio que no existe no es «no respondió a tiempo».
        return result.detail === "dns_not_found" ? "no_domain" : "failed";
    }
  }
  return sniffImageMime(result.data) ? "ok" : "not_image";
}

export async function checkPhotoLinks(
  links: readonly PhotoLink[],
  deps: PhotoCheckDeps = {},
): Promise<PhotoCheckResult> {
  const limits = { ...PHOTO_CHECK_LIMITS, ...deps.limits };
  const now = deps.now ?? Date.now;
  const fetchImage = deps.fetch ?? fetchRemoteImage;
  const deadline = now() + limits.budgetMs;

  // Un enlace repetido se revisa una vez (se informa en su primera fila).
  const unique = new Map<string, PhotoLink>();
  for (const link of links) if (!unique.has(link.url)) unique.set(link.url, link);
  const queue = [...unique.values()];
  const items: PhotoCheckItem[] = queue.map((link) => ({ ...link, status: "not_checked" }));

  let next = 0;
  const worker = async () => {
    while (next < items.length && next < limits.maxLinks) {
      const item = items[next++]!;
      const left = deadline - now();
      if (left <= 0) return;
      const result = await fetchImage(item.url, {
        maxBytes: limits.maxBytes,
        peekBytes: limits.peekBytes,
        timeoutMs: Math.min(limits.perLinkTimeoutMs, left),
        ...(deps.testOrigin ? { testOrigin: deps.testOrigin } : {}),
      });
      item.status = statusOf(result);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limits.concurrency) }, worker));

  const counts: Record<PhotoCheckStatus, number> = {
    ok: 0,
    blocked: 0,
    not_found: 0,
    no_domain: 0,
    too_large: 0,
    failed: 0,
    not_image: 0,
    not_checked: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return {
    total: items.length,
    checked: items.length - counts.not_checked,
    counts,
    problems: items.filter((i) => i.status !== "ok").sort((a, b) => a.row - b.row),
  };
}

/** Qué decirle a la tienda de cada resultado. */
export const PHOTO_CHECK_LABELS: Record<Exclude<PhotoCheckStatus, "ok">, string> = {
  blocked:
    "No descargamos fotos de esa dirección (solo enlaces públicos https; nada de direcciones internas).",
  not_found: "El enlace no existe o no lleva a una foto.",
  no_domain: "Ese dominio no existe: revisa que el enlace esté bien escrito.",
  too_large: "La foto pesa más de 10 MB.",
  failed:
    "No pudimos abrir el enlace: el servidor no respondió a tiempo o falló. Puede funcionar al importar; revísalo.",
  not_image: "El enlace abre, pero no es una foto JPG, PNG, WebP ni AVIF.",
  not_checked: "No alcanzó a revisarse (hay demasiados enlaces o tardaron mucho).",
};

/** Dominio y ruta del enlace, sin la consulta: puede llevar una firma. */
export function displayLink(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.slice(0, 200);
  } catch {
    return "enlace no válido";
  }
}
