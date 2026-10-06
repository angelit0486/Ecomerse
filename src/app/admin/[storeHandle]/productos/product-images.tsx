"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/media/constants";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";

import {
  finalizeProductImageUpload,
  mediaAction,
  requestProductImageUpload,
  type CatalogActionState,
} from "./actions";
import { FIELD_MESSAGES, REJECTION_REASONS } from "./messages";

export interface ProductImage {
  id: string;
  status: "pending" | "ready" | "rejected";
  url: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  rejection_reason: string | null;
}

/**
 * Imágenes del producto (§25.3): el archivo va directo del navegador a Storage
 * con una URL firmada para una ruta reservada; el servidor solo recibe metadatos.
 * Mientras alguna esté en proceso, la lista se refresca sola.
 */
export function ProductImages({
  storeHandle,
  productId,
  images,
  canEdit,
}: {
  storeHandle: string;
  productId: string;
  images: ProductImage[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const processing = images.some((i) => i.status === "pending");

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [processing, router]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage(null);
    let done = 0;
    for (const file of Array.from(files).slice(0, 10)) {
      if (
        !(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type) ||
        file.size > MAX_UPLOAD_BYTES
      ) {
        setMessage({ kind: "error", text: `${file.name}: ${FIELD_MESSAGES.file}` });
        continue;
      }
      const ticket = await requestProductImageUpload(storeHandle, {
        productId,
        mimeType: file.type,
        bytes: file.size,
      });
      if (!ticket.ok) {
        setMessage({ kind: "error", text: `${file.name}: ${ticket.error}` });
        continue;
      }
      const response = await fetch(ticket.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      }).catch(() => null);
      if (!response?.ok) {
        setMessage({
          kind: "error",
          text: `${file.name}: no se pudo subir. Revisa tu conexión e inténtalo de nuevo.`,
        });
        continue;
      }
      const finalized = await finalizeProductImageUpload(storeHandle, ticket.mediaId);
      if (!finalized.ok) {
        setMessage({ kind: "error", text: `${file.name}: ${finalized.error}` });
        continue;
      }
      done += 1;
    }
    if (done > 0) {
      setMessage({
        kind: "ok",
        text: `${done} ${done === 1 ? "imagen subida" : "imágenes subidas"}; las estamos procesando.`,
      });
    }
    if (fileRef.current) fileRef.current.value = "";
    setUploading(false);
    router.refresh();
  }

  return (
    <section
      aria-labelledby="imagenes-titulo"
      className="space-y-3 rounded-[var(--radius-container)] border border-border p-4"
    >
      <h2 id="imagenes-titulo" className="text-base font-semibold">
        Imágenes
      </h2>
      {canEdit ? (
        <div className="space-y-1">
          <label htmlFor="product-images-input" className="text-[13px] font-medium">
            Agregar imágenes
          </label>
          <p id="product-images-hint" className="text-[13px] text-fg-muted">
            JPG, PNG, WebP o AVIF de hasta 10 MB. Quitamos los datos de ubicación de las fotos.
          </p>
          <input
            ref={fileRef}
            id="product-images-input"
            type="file"
            accept={ALLOWED_IMAGE_MIME.join(",")}
            multiple
            aria-describedby="product-images-hint"
            disabled={uploading}
            onChange={(e) => void upload(e.target.files)}
            className="block text-sm"
          />
        </div>
      ) : null}
      <div aria-live="polite">
        {uploading ? <p className="text-sm text-fg-muted">Subiendo…</p> : null}
        {message ? (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`text-sm ${message.kind === "error" ? "text-danger" : "text-success"}`}
          >
            {message.text}
          </p>
        ) : null}
      </div>
      {images.length === 0 ? (
        <p className="text-sm text-fg-muted">Este producto aún no tiene imágenes.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, index) => (
            <ImageCard
              key={image.id}
              storeHandle={storeHandle}
              productId={productId}
              image={image}
              first={index === 0}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ImageCard({
  storeHandle,
  productId,
  image,
  first,
  canEdit,
}: {
  storeHandle: string;
  productId: string;
  image: ProductImage;
  first: boolean;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    mediaAction.bind(null, storeHandle, productId),
    {},
  );
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      {image.status === "ready" && image.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen ya re-codificada y servida por Storage
        <img
          src={image.url}
          alt={image.alt_text ?? ""}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          className="aspect-square w-full rounded object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded bg-canvas p-3 text-center text-sm text-fg-muted">
          {image.status === "pending"
            ? "Procesando…"
            : `Rechazada: ${REJECTION_REASONS[image.rejection_reason ?? ""] ?? "archivo no válido."}`}
        </div>
      )}
      {first && image.status === "ready" ? (
        <p className="text-[13px] font-medium">Imagen principal</p>
      ) : null}
      {canEdit ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="media_id" value={image.id} />
          {image.status === "ready" ? (
            <div className="flex gap-2">
              <Input
                name="alt_text"
                aria-label="Texto alternativo"
                placeholder="Describe la imagen"
                defaultValue={image.alt_text ?? ""}
                maxLength={250}
              />
              <Button
                type="submit"
                name="action"
                value="alt"
                variant="secondary"
                size="sm"
                disabled={pending}
              >
                Guardar
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!first && image.status === "ready" ? (
              <Button
                type="submit"
                name="action"
                value="first"
                variant="ghost"
                size="sm"
                disabled={pending}
              >
                Hacer principal
              </Button>
            ) : null}
            <Button
              type="submit"
              name="action"
              value="delete"
              variant="ghost"
              size="sm"
              disabled={pending}
            >
              Eliminar imagen
            </Button>
          </div>
          {state.error ? (
            <p role="alert" className="text-[13px] text-danger">
              {state.error}
            </p>
          ) : state.ok ? (
            <p role="status" className="text-[13px] text-success">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}
