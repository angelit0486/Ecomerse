import "server-only";

import { createHash } from "node:crypto";

import { ImageResponse } from "next/og";

import { monogramInitial, monogramSvg } from "@/lib/theme/monogram";
import { resolveTheme } from "@/lib/theme/resolve-theme";

import { storefrontForRoute } from "./context";
import type { StorePublic } from "./store-public";

/**
 * Íconos de la tienda (§20.2, D-F9-06): rutas públicas del dominio de la tienda
 * (el proxy las reescribe a /_store/{id}/…). Monograma con el color primario;
 * la URL lleva la versión publicada, así que se pueden cachear. En vista previa
 * reflejan el borrador y no se cachean.
 */
type Params = { params: Promise<{ storeId: string }> };

function cacheHeaders(preview: boolean): Record<string, string> {
  return preview
    ? { "cache-control": "no-store", "x-robots-tag": "noindex" }
    : { "cache-control": "public, max-age=86400" };
}

function colors(store: StorePublic) {
  const theme = resolveTheme(store.theme?.settings);
  return { bg: theme.palette.primary, fg: theme.buttonText };
}

export async function svgIcon(request: Request, { params }: Params): Promise<Response> {
  const resolved = await storefrontForRoute((await params).storeId, request.headers);
  if (!resolved) return new Response("Not found", { status: 404 });
  const { bg, fg } = colors(resolved.store);
  return new Response(monogramSvg(resolved.store.name, bg, fg), {
    headers: {
      "content-type": "image/svg+xml",
      // El SVG generado no tiene scripts; aun así, sin ejecutar nada si se abre solo.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      ...cacheHeaders(resolved.preview),
    },
  });
}

export async function pngIcon(
  request: Request,
  { params }: Params,
  size: number,
): Promise<Response> {
  const resolved = await storefrontForRoute((await params).storeId, request.headers);
  if (!resolved) return new Response("Not found", { status: 404 });
  const { bg, fg } = colors(resolved.store);
  const image = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.56),
        fontWeight: 700,
      }}
    >
      {monogramInitial(resolved.store.name)}
    </div>,
    { width: size, height: size },
  );
  const headers = new Headers(image.headers);
  for (const [k, v] of Object.entries(cacheHeaders(resolved.preview))) headers.set(k, v);
  return new Response(image.body, { status: 200, headers });
}

export async function manifest(request: Request, { params }: Params): Promise<Response> {
  const resolved = await storefrontForRoute((await params).storeId, request.headers);
  if (!resolved) return new Response("Not found", { status: 404 });
  const { store, preview } = resolved;
  const theme = resolveTheme(store.theme?.settings);
  const v = iconVersion(store);
  return Response.json(
    {
      name: store.name,
      short_name: store.name.slice(0, 12),
      start_url: "/",
      display: "browser",
      background_color: theme.palette.background,
      theme_color: theme.palette.primary,
      icons: [
        { src: `/icon-192.png?v=${v}`, sizes: "192x192", type: "image/png" },
        { src: `/icon-512.png?v=${v}`, sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "content-type": "application/manifest+json", ...cacheHeaders(preview) } },
  );
}

/**
 * Versión de los íconos y del manifiesto: cambia al publicar el tema y al
 * renombrar la tienda (el monograma y el nombre salen de `store.name`; Gate F9).
 */
export function iconVersion(store: StorePublic): string {
  const published = store.theme?.published_at;
  const theme = published ? String(Math.floor(Date.parse(published) / 1000)) : "0";
  return `${theme}-${createHash("sha256").update(store.name).digest("hex").slice(0, 8)}`;
}
