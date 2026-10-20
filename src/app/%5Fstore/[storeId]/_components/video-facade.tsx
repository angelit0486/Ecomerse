"use client";

import { useState } from "react";

import type { VideoProvider } from "@/lib/theme/constants";

/**
 * Video con carga al tocar (ADR-034): hasta que el comprador lo pide no se
 * conecta con YouTube ni Vimeo (sin cookies ni rastreo, y la portada no pesa
 * más). La dirección se arma con un host fijo y un código ya validado.
 */
function embedUrl(provider: VideoProvider, id: string): string {
  return provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`
    : `https://player.vimeo.com/video/${encodeURIComponent(id)}?autoplay=1&dnt=1`;
}

export function VideoFacade({
  provider,
  videoId,
  title,
}: {
  provider: VideoProvider;
  videoId: string;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[var(--sf-radius-card)] bg-[var(--sf-fg)]">
      {playing ? (
        <iframe
          src={embedUrl(provider, videoId)}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-3 text-[var(--sf-bg)] [&:focus-visible]:outline-[var(--sf-bg)]"
        >
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--sf-primary)] text-[var(--sf-on-primary)]"
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="px-4 text-center text-base font-semibold">Reproducir: {title}</span>
          <span className="text-[13px] opacity-80">
            Se abre el reproductor de {provider === "youtube" ? "YouTube" : "Vimeo"}
          </span>
        </button>
      )}
    </div>
  );
}
