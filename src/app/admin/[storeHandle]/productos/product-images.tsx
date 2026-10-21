"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { ALLOWED_IMAGE_MIME } from "@/lib/media/constants";
import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Input } from "@/ui/primitives/input";

import { mediaAction, setVariantImageAction, type CatalogActionState } from "./actions";
import { REJECTION_REASONS } from "./messages";
import { nativeControl } from "./styles";
import { uploadProductImages } from "./upload-client";

export interface ProductImage {
  id: string;
  status: "pending" | "ready" | "rejected";
  url: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  rejection_reason: string | null;
  created_at?: string;
}

/** Una foto que lleva más que esto en «Procesando» ya no es normal. */
const SLOW_MS = 10 * 60 * 1000;

/** Presentación del producto (sabor, tamaño) y su foto propia, si tiene. */
export interface VariantImageChoice {
  id: string;
  label: string;
  image_id: string | null;
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
  variants = [],
  processingBlocked = false,
}: {
  storeHandle: string;
  productId: string;
  images: ProductImage[];
  canEdit: boolean;
  /** Solo productos con varias presentaciones. */
  variants?: VariantImageChoice[];
  /** El servidor no puede optimizar fotos (falta configuración): se dice, no se espera. */
  processingBlocked?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const processing = images.some((i) => i.status === "pending");

  useEffect(() => {
    // Bloqueado por configuración, recargar cada 2.5 s no cambia nada.
    if (!processing || processingBlocked) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [processing, processingBlocked, router]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploading(true);
    setMessage(null);
    setProgress({ done: 0, total: list.length });
    try {
      let finished = 0;
      const outcomes = await uploadProductImages(
        storeHandle,
        list.map((file) => ({ productId, file })),
        () => setProgress({ done: ++finished, total: list.length }),
      );
      const failed = outcomes
        .map((outcome, index) => (outcome.ok ? null : `${list[index]!.name}: ${outcome.error}`))
        .filter((line): line is string => line !== null);
      const done = outcomes.length - failed.length;
      if (failed.length > 0) {
        setMessage({ kind: "error", text: failed.join(" · ") });
      } else if (done > 0) {
        setMessage({
          kind: "ok",
          text: `${done} ${done === 1 ? "imagen subida" : "imágenes subidas"}; las estamos procesando.`,
        });
      }
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setUploading(false);
      setProgress(null);
      router.refresh();
    }
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
            JPG, PNG, WebP o AVIF. Las aligeramos antes de subirlas y quitamos los datos de
            ubicación.
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
            className="block min-h-11 text-sm"
          />
        </div>
      ) : null}
      {processing && processingBlocked ? (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          Tus fotos están guardadas y en espera: el servidor todavía no tiene configurada la
          optimización de imágenes. Se procesarán solas en cuanto se configure (lo ves en Inicio →
          Estado del sistema).
        </p>
      ) : null}
      <div aria-live="polite">
        {uploading ? (
          <p className="text-sm text-fg-muted">
            {progress ? `Subiendo ${progress.done} de ${progress.total}…` : "Subiendo…"}
          </p>
        ) : null}
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
              index={index}
              count={images.length}
              canEdit={canEdit}
              processingBlocked={processingBlocked}
            />
          ))}
        </ul>
      )}
      {canEdit && variants.length > 1 && images.some((i) => i.status === "ready") ? (
        <section aria-labelledby="fotos-presentaciones" className="space-y-2">
          <h3 id="fotos-presentaciones" className="text-sm font-semibold">
            Foto de cada presentación
          </h3>
          <p className="text-[13px] text-fg-muted">
            Al elegir un sabor o tamaño en la tienda se muestra su foto. Sin foto propia, se usa la
            principal.
          </p>
          <ul className="space-y-2">
            {variants.map((v) => (
              <VariantImageRow
                key={v.id}
                storeHandle={storeHandle}
                productId={productId}
                variant={v}
                images={images}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function VariantImageRow({
  storeHandle,
  productId,
  variant,
  images,
}: {
  storeHandle: string;
  productId: string;
  variant: VariantImageChoice;
  images: ProductImage[];
}) {
  const [state, action, pending] = useActionState<CatalogActionState, FormData>(
    setVariantImageAction.bind(null, storeHandle, productId),
    {},
  );
  const id = `foto-${variant.id}`;
  return (
    <li>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="variant_id" value={variant.id} />
        <label htmlFor={id} className="min-w-32 text-sm">
          {variant.label}
        </label>
        <select
          id={id}
          name="media_id"
          defaultValue={variant.image_id ?? ""}
          // Las descripciones largas no deben ensanchar la pantalla a 375 px.
          className={`${nativeControl} min-w-0 max-w-full`}
        >
          <option value="">La del producto</option>
          {images.map((image, index) =>
            image.status === "ready" ? (
              <option key={image.id} value={image.id}>
                Foto {index + 1}
                {image.alt_text ? ` · ${image.alt_text.slice(0, 40)}` : ""}
              </option>
            ) : null,
          )}
        </select>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={pending}
          aria-label={`Guardar foto de ${variant.label}`}
        >
          Guardar foto
        </Button>
        {state.error ? (
          <span role="alert" className="text-[13px] text-danger">
            {state.error}
          </span>
        ) : state.ok ? (
          <span role="status" className="text-[13px] text-success">
            {state.message}
          </span>
        ) : null}
      </form>
    </li>
  );
}

function ImageCard({
  storeHandle,
  productId,
  image,
  index,
  count,
  canEdit,
  processingBlocked,
}: {
  storeHandle: string;
  productId: string;
  image: ProductImage;
  index: number;
  count: number;
  canEdit: boolean;
  processingBlocked: boolean;
}) {
  const first = index === 0;
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
            ? pendingLabel(image, processingBlocked)
            : `Rechazada: ${REJECTION_REASONS[image.rejection_reason ?? ""] ?? "archivo no válido."}`}
        </div>
      )}
      <p className="text-[13px] font-medium">
        Foto {index + 1}
        {first && image.status === "ready" ? " · principal" : ""}
      </p>
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
            {index > 0 ? (
              <Button
                type="submit"
                name="action"
                value="left"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Mover la foto ${index + 1} antes`}
              >
                ← Antes
              </Button>
            ) : null}
            {index < count - 1 ? (
              <Button
                type="submit"
                name="action"
                value="right"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Mover la foto ${index + 1} después`}
              >
                Después →
              </Button>
            ) : null}
            <ConfirmButton
              name="action"
              value="delete"
              size="sm"
              disabled={pending}
              question={`¿Eliminar la foto ${index + 1}?`}
            >
              Eliminar imagen
            </ConfirmButton>
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

function pendingLabel(image: ProductImage, blocked: boolean): string {
  if (blocked) return "En espera de configuración del servidor";
  const age = image.created_at ? Date.now() - Date.parse(image.created_at) : 0;
  return age > SLOW_MS ? "Tarda más de lo normal; recarga en unos minutos" : "Procesando…";
}
