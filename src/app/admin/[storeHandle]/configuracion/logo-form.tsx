"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { ALLOWED_IMAGE_MIME, MAX_BRANDING_UPLOAD_BYTES } from "@/lib/media/constants";
import { Button } from "@/ui/primitives/button";

import { finalizeLogoUpload, requestLogoUpload, setLogoDraft, type StepState } from "./actions";

export interface LogoCandidate {
  id: string;
  status: "pending" | "ready" | "rejected";
  url: string | null;
}

/**
 * Logo de la tienda (F3-T06): sube por URL firmada, espera al worker (sin EXIF,
 * re-codificado) y se elige para el borrador del branding.
 */
export function LogoForm({
  storeHandle,
  storeName,
  current,
  candidates,
}: {
  storeHandle: string;
  storeName: string;
  current: { id: string; url: string } | null;
  candidates: LogoCandidate[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<StepState, FormData>(
    setLogoDraft.bind(null, storeHandle),
    {},
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const processing = candidates.some((c) => c.status === "pending");
  const latest = candidates[0];

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [processing, router]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    if (
      !(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type) ||
      file.size > MAX_BRANDING_UPLOAD_BYTES
    ) {
      setUploadError("Usa una imagen JPG, PNG, WebP o AVIF de hasta 2 MB.");
      return;
    }
    setUploading(true);
    const ticket = await requestLogoUpload(storeHandle, { mimeType: file.type, bytes: file.size });
    if (!ticket.ok) {
      setUploadError(ticket.error);
    } else {
      const response = await fetch(ticket.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      }).catch(() => null);
      if (!response?.ok) {
        setUploadError("No se pudo subir el logo. Revisa tu conexión e inténtalo de nuevo.");
      } else {
        const finalized = await finalizeLogoUpload(storeHandle, ticket.mediaId);
        if (!finalized.ok) setUploadError(finalized.error ?? "No pudimos procesar el logo.");
      }
    }
    setUploading(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen ya re-codificada y servida por Storage
          <img
            src={current.url}
            alt={`Logo de ${storeName}`}
            className="h-16 w-auto max-w-48 rounded border border-border object-contain p-1"
          />
        ) : (
          <p className="text-sm text-fg-muted">
            Tu tienda aún no tiene logo; se mostrará su nombre.
          </p>
        )}
        {current ? (
          <form action={action}>
            <input type="hidden" name="media_id" value="" />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              Quitar logo
            </Button>
          </form>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="logo-input" className="text-[13px] font-medium">
          Subir logo
        </label>
        <p id="logo-hint" className="text-[13px] text-fg-muted">
          JPG, PNG, WebP o AVIF de hasta 2 MB. Sin SVG.
        </p>
        <input
          id="logo-input"
          type="file"
          accept={ALLOWED_IMAGE_MIME.join(",")}
          aria-describedby="logo-hint"
          disabled={uploading}
          onChange={(e) => void upload(e.target.files?.[0])}
          className="block text-sm"
        />
      </div>

      <div aria-live="polite" className="space-y-2">
        {uploading ? <p className="text-sm text-fg-muted">Subiendo…</p> : null}
        {uploadError ? (
          <p role="alert" className="text-sm text-danger">
            {uploadError}
          </p>
        ) : null}
        {latest && latest.id !== current?.id ? (
          latest.status === "pending" ? (
            <p className="text-sm text-fg-muted">Procesando el logo…</p>
          ) : latest.status === "rejected" ? (
            <p role="alert" className="text-sm text-danger">
              El último archivo no es una imagen válida. Prueba con otro.
            </p>
          ) : latest.url ? (
            <form action={action} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- imagen ya re-codificada */}
              <img
                src={latest.url}
                alt="Logo nuevo"
                className="h-12 w-auto max-w-40 rounded border border-border object-contain p-1"
              />
              <input type="hidden" name="media_id" value={latest.id} />
              <Button type="submit" size="sm" loading={pending}>
                Usar este logo
              </Button>
            </form>
          ) : null
        ) : null}
        {state.ok ? (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        ) : state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
