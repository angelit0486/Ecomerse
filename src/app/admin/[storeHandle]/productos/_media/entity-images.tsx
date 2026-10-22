"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { brandInitialsOf } from "@/lib/catalog/brand-initials";
import { matchBrandFile } from "@/lib/catalog/brand-files";
import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/media/constants";
import { frameImage, type Fit } from "@/lib/media/frame";
import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";

import { ENTITY_MEDIA, entityKind, type MediaEntity } from "./entity-media";
import {
  attachEntityImage,
  removeEntityImage,
  requestEntityImageUpload,
} from "./entity-media-actions";

/**
 * Imágenes de marcas (logo y portada; misión Portada/Marcas, Paso 2) y de
 * categorías (foto cuadrada y banner; misión Panel, Paso A). Se elige de la
 * galería del celular o de la computadora, se encuadra en el navegador
 * (cuadro o franja 8:3), se ve la vista previa y se sube por el pipeline seguro
 * de medios.
 */
export interface EntityImageView {
  status: "pending" | "ready" | "rejected";
  url: string | null;
}

const FILE_ERROR = "Usa una imagen JPG, PNG, WebP o AVIF de hasta 10 MB.";

function validFile(file: File): boolean {
  return (
    (ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type) && file.size <= MAX_UPLOAD_BYTES
  );
}

/** Sube un archivo ya encuadrado y lo liga a la marca o categoría. */
async function uploadEntityImage(
  storeHandle: string,
  entity: MediaEntity,
  item: { id: string; name: string },
  kind: string,
  file: File,
): Promise<string | null> {
  const ticket = await requestEntityImageUpload(storeHandle, {
    entity,
    mimeType: file.type,
    bytes: file.size,
  });
  if (!ticket.ok) return ticket.error;
  const put = await fetch(ticket.signedUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  }).catch(() => null);
  if (!put?.ok) return "No se pudo subir la imagen. Revisa tu conexión e inténtalo de nuevo.";
  const done = await attachEntityImage(storeHandle, {
    entity,
    id: item.id,
    mediaId: ticket.mediaId,
    kind,
    name: item.name,
  });
  return done.ok ? null : done.error;
}

export function EntityImageField({
  storeHandle,
  entity,
  item,
  kind: kindKey,
  current,
}: {
  storeHandle: string;
  entity: MediaEntity;
  item: { id: string; name: string };
  kind: string;
  current: EntityImageView | null;
}) {
  const kind = entityKind(entity, kindKey);
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // Un logo se acomoda completo; una foto o un banner llenan el cuadro.
  const [fit, setFit] = useState<Fit>(kind.key === "logo" ? "contain" : "cover");
  const [picked, setPicked] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const label = kind.label;
  const alt = `${kind.altPrefix} ${item.name}`;

  // Vista previa encuadrada, como quedará en la tienda.
  useEffect(() => {
    if (!picked) return;
    let url: string | null = null;
    let alive = true;
    frameImage(picked, kind.size, fit)
      .then((framed) => {
        if (!alive) return;
        url = URL.createObjectURL(framed);
        setPreview(url);
      })
      .catch(() => {
        if (alive) setStatus({ error: "No pudimos leer esa imagen. Prueba con otra (JPG o PNG)." });
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked, fit, kind.size]);

  async function upload() {
    if (!picked) return;
    setBusy(true);
    setStatus({});
    try {
      const framed = await frameImage(picked, kind.size, fit).catch(() => null);
      if (!framed)
        return setStatus({ error: "No pudimos leer esa imagen. Prueba con otra (JPG o PNG)." });
      const error = await uploadEntityImage(storeHandle, entity, item, kind.key, framed).catch(
        () => "No se pudo subir la imagen. Revisa tu conexión e inténtalo de nuevo.",
      );
      if (error) return setStatus({ error });
      setStatus({ message: `Listo. En unos segundos se ve en la tienda.` });
      setPicked(null);
      setPreview(null);
      if (input.current) input.current.value = "";
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setStatus({});
    try {
      const done = await removeEntityImage(storeHandle, { entity, id: item.id, kind: kind.key });
      if (!done.ok) return setStatus({ error: done.error });
      setStatus({ message: kind.removedMessage });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? current?.url ?? null;
  const box = kind.square ? "size-24" : "aspect-[8/3] w-full max-w-sm";
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{kind.legend}</legend>
      <div className="flex flex-wrap items-start gap-3">
        <div
          className={`${box} flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-canvas`}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local o imagen re-codificada
            <img src={shown} alt={alt} className="size-full object-contain" />
          ) : current?.status === "pending" ? (
            <span className="p-2 text-center text-[13px] text-fg-muted">Procesando…</span>
          ) : kind.square ? (
            <span aria-hidden="true" className="text-2xl font-bold text-fg-muted">
              {brandInitialsOf(item.name)}
            </span>
          ) : (
            <span className="p-2 text-center text-[13px] text-fg-muted">Sin {label}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor={`${id}-file`} className="text-sm font-medium">
            {current?.url || current?.status === "pending" ? `Cambiar ${label}` : `Elegir ${label}`}
          </label>
          <input
            id={`${id}-file`}
            ref={input}
            type="file"
            accept={ALLOWED_IMAGE_MIME.join(",")}
            className="block min-h-11 max-w-full text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setStatus({});
              if (file && !validFile(file)) {
                setPicked(null);
                setPreview(null);
                e.target.value = "";
                return setStatus({ error: FILE_ERROR });
              }
              setPicked(file);
            }}
          />
          {picked ? (
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <legend className="sr-only">Encuadre</legend>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-fit`}
                  checked={fit === "contain"}
                  onChange={() => setFit("contain")}
                />
                Completa (sin recortar)
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-fit`}
                  checked={fit === "cover"}
                  onChange={() => setFit("cover")}
                />
                Llenar el cuadro (recorta al centro)
              </label>
            </fieldset>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {picked ? (
              <Button type="button" size="sm" loading={busy} onClick={upload}>
                {`Subir ${label}`}
              </Button>
            ) : null}
            {current && !picked ? (
              <form action={remove}>
                <ConfirmButton
                  size="sm"
                  loading={busy}
                  question={`¿Quitar ${kind.article} de ${item.name}?`}
                  confirmLabel={`Sí, quitar ${label}`}
                >
                  {`Quitar ${label}`}
                </ConfirmButton>
              </form>
            ) : null}
          </div>
          {status.error ? (
            <p role="alert" className="text-sm text-danger">
              {status.error}
            </p>
          ) : status.message ? (
            <p role="status" className="text-sm text-success">
              {status.message}
            </p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}

/**
 * Imágenes de varias marcas o categorías a la vez: se arrastran o se eligen
 * varios archivos y cada uno se asigna a la que tiene el mismo nombre que el
 * archivo; los que no coinciden se asignan a mano o se omiten.
 */
export function BulkEntityImages({
  storeHandle,
  entity,
  items: brands,
}: {
  storeHandle: string;
  entity: MediaEntity;
  items: { id: string; name: string; slug: string }[];
}) {
  const cfg = ENTITY_MEDIA[entity];
  const main = cfg.kinds[0];
  const router = useRouter();
  const id = useId();
  const [rows, setRows] = useState<{ file: File; brandId: string; result?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  function add(files: FileList | File[]) {
    setSummary(null);
    // Dos archivos para la misma marca: solo el primero se asigna solo.
    const taken = new Set<string>();
    setRows(
      [...files].map((file) => {
        if (!validFile(file)) return { file, brandId: "", result: FILE_ERROR };
        const match = matchBrandFile(file.name, brands)?.id ?? "";
        if (match && taken.has(match)) return { file, brandId: "" };
        if (match) taken.add(match);
        return { file, brandId: match };
      }),
    );
  }

  const duplicated = new Set(
    rows.map((r) => r.brandId).filter((id, i, all) => id && all.indexOf(id) !== i),
  );

  async function uploadAll() {
    setBusy(true);
    let ok = 0;
    const next = [...rows];
    // De a 3: rápido sin saturar la conexión del celular.
    const queue = next
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.brandId && !row.result);
    async function worker() {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const brand = brands.find((b) => b.id === item.row.brandId)!;
        let error: string | null;
        try {
          const framed = await frameImage(item.row.file, main.size, cfg.bulkFit);
          error = await uploadEntityImage(storeHandle, entity, brand, main.key, framed);
        } catch {
          error = "No pudimos leer o subir esta imagen.";
        }
        next[item.index] = { ...item.row, result: error ?? "Subido" };
        if (!error) ok += 1;
        setRows([...next]);
      }
    }
    try {
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      setBusy(false);
    }
    const [one, many] = cfg.bulkUnit;
    setSummary(
      `${ok} ${ok === 1 ? `${one} subid${one === "foto" ? "a" : "o"}` : `${many} subid${one === "foto" ? "as" : "os"}`}.`,
    );
    router.refresh();
  }

  const ready = rows.filter((r) => r.brandId && !r.result).length;
  const blocked = duplicated.size > 0;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-md border border-border p-4"
    >
      <h2 id={`${id}-title`} className="text-base font-semibold">
        {cfg.bulkTitle}
      </h2>
      <p className="text-sm text-fg-muted">{cfg.bulkHint}</p>
      <label
        htmlFor={`${id}-files`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed p-4 text-center text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${
          over ? "border-accent bg-canvas" : "border-border"
        }`}
      >
        <span className="font-medium">{cfg.bulkDrop}</span>
        <span className="text-[13px] text-fg-muted">
          JPG, PNG, WebP o AVIF, hasta 10 MB cada uno
        </span>
        <input
          id={`${id}-files`}
          type="file"
          multiple
          accept={ALLOWED_IMAGE_MIME.join(",")}
          className="sr-only"
          onChange={(e) => e.target.files && add(e.target.files)}
        />
      </label>
      {rows.length > 0 ? (
        <ul aria-label={cfg.bulkListLabel} aria-live="polite" className="space-y-2">
          {rows.map((row, index) => (
            <li
              key={`${row.file.name}-${index}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate" title={row.file.name}>
                {row.file.name}
              </span>
              <label className="sr-only" htmlFor={`${id}-brand-${index}`}>
                {cfg.bulkPickLabel} {row.file.name}
              </label>
              <select
                id={`${id}-brand-${index}`}
                value={row.brandId}
                disabled={busy || Boolean(row.result)}
                onChange={(e) =>
                  setRows((all) =>
                    all.map((r, i) => (i === index ? { ...r, brandId: e.target.value } : r)),
                  )
                }
                className="min-h-11 rounded-md border border-control bg-surface px-2"
              >
                <option value="">{cfg.bulkNone}</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {row.result ? (
                <span className={row.result === "Subido" ? "text-success" : "text-danger"}>
                  {row.result}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {blocked ? (
          <p role="alert" className="basis-full text-sm text-danger">
            {cfg.bulkDuplicate}
          </p>
        ) : null}
        <Button type="button" disabled={ready === 0 || blocked} loading={busy} onClick={uploadAll}>
          {ready === 1 ? `Subir 1 ${cfg.bulkUnit[0]}` : `Subir ${ready} ${cfg.bulkUnit[1]}`}
        </Button>
        {summary ? (
          <p role="status" className="text-sm">
            {summary}
          </p>
        ) : null}
      </div>
    </section>
  );
}
