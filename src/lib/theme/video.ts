import { VIDEO_ID_RE, type VideoProvider } from "./constants";

/**
 * Enlace de YouTube o Vimeo pegado por la dueña → proveedor y código (ADR-034).
 * Solo se guarda el código: la tienda arma la dirección del reproductor con un
 * host fijo, así que nada del enlace pegado llega a la página.
 */
export function parseVideoLink(input: string): { provider: VideoProvider; id: string } | null {
  const raw = input.trim();
  if (VIDEO_ID_RE.youtube.test(raw)) return { provider: "youtube", id: raw };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  if (host === "youtu.be") id = parts[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") id = url.searchParams.get("v") ?? undefined;
    else if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") id = parts[1];
  } else if (host === "vimeo.com" || host === "player.vimeo.com") {
    const candidate = parts.find((p) => VIDEO_ID_RE.vimeo.test(p));
    return candidate ? { provider: "vimeo", id: candidate } : null;
  }
  return id && VIDEO_ID_RE.youtube.test(id) ? { provider: "youtube", id } : null;
}
