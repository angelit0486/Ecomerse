import "server-only";

import type { Metadata } from "next";

import { serverEnv } from "@/server/env";

import { mediaUrl, type ImageRef } from "./catalog";
import type { StorePublic } from "./store-public";

/**
 * SEO por tienda y por host (GATE0 §24): canonical absoluto al dominio
 * primario, Open Graph y Twitter, robots. Una tienda en borrador o en vista
 * previa nunca se indexa.
 */
export function storeOrigin(store: Pick<StorePublic, "primary_hostname" | "handle">): string {
  const env = serverEnv();
  const secure = env.APP_ENV === "production" || env.APP_ENV === "preview";
  const host = store.primary_hostname ?? store.handle;
  // En local las tiendas viven en {host}:{puerto del panel}.
  const port = !secure ? env.APP_HOSTNAME.split(":")[1] : undefined;
  return `${secure ? "https" : "http"}://${host}${port ? `:${port}` : ""}`;
}

export function canonicalUrl(
  store: Pick<StorePublic, "primary_hostname" | "handle">,
  path: string,
): string {
  return `${storeOrigin(store)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function indexable(store: Pick<StorePublic, "status">, preview: boolean): boolean {
  // Un entorno de vista previa (APP_ENV=preview, D-F9-17) nunca se indexa: sus
  // tiendas son de demostración aunque estén activas.
  return store.status === "active" && !preview && serverEnv().APP_ENV !== "preview";
}

/** Recorta a ~160 caracteres sin cortar palabras (descripción por defecto). */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

export function excerpt(text: string | null | undefined, max = 160): string | undefined {
  const plain = (text ?? "")
    .replace(/<[^>]*>/g, " ")
    // Entidades del HTML sanitizado; React vuelve a escapar al renderizar.
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e]!)
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return undefined;
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

function globalSeo(store: StorePublic): { title?: string; description?: string } {
  const seo = (
    store.theme?.settings as { seo?: { title?: unknown; description?: unknown } } | undefined
  )?.seo;
  return {
    ...(typeof seo?.title === "string" && seo.title ? { title: seo.title } : {}),
    ...(typeof seo?.description === "string" && seo.description
      ? { description: seo.description }
      : {}),
  };
}

export function pageMetadata(input: {
  store: StorePublic;
  preview: boolean;
  path: string;
  title: string;
  description?: string | undefined;
  image?: ImageRef | null | undefined;
  type?: "website" | "product";
}): Metadata {
  const { store, preview, path, title } = input;
  const url = canonicalUrl(store, path);
  const home = title === store.name;
  // SEO global de la tienda (§20.2): título y descripción de la portada, y
  // descripción e imagen por defecto de las demás páginas.
  const seo = globalSeo(store);
  const fullTitle = home ? (seo.title ?? title) : `${title} · ${store.name}`;
  // Sin texto propio, una descripción neutra con datos reales (nunca inventados).
  const description =
    input.description ||
    seo.description ||
    (home ? `Tienda en línea de ${store.name}.` : `${title} en ${store.name}.`);
  const image =
    input.image ??
    (store.seo_image ? { ...store.seo_image, alt: store.seo_image.alt ?? store.name } : null) ??
    (home && store.logo ? { ...store.logo, alt: store.name } : null);
  const images = image
    ? [
        {
          url: mediaUrl(image.path),
          ...(image.width ? { width: image.width } : {}),
          ...(image.height ? { height: image.height } : {}),
          alt: image.alt ?? title,
        },
      ]
    : undefined;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: url },
    robots: indexable(store, preview)
      ? { index: true, follow: true }
      : { index: false, follow: false },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: store.name,
      type: "website",
      locale: store.locale.replace("-", "_"),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: fullTitle,
      description,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
  };
}

/** JSON seguro dentro de <script type="application/ld+json"> (sin "<"). */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
