"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { matchFiles, uploadOrder, type FileMatch } from "@/lib/media/bulk-match";
import { ALLOWED_IMAGE_MIME } from "@/lib/media/constants";
import { Button } from "@/ui/primitives/button";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { assignVariantPhotosWhenReady } from "../../actions";
import { uploadProductImages, type UploadOutcome } from "../../upload-client";

export interface BulkTarget {
  id: string;
  title: string;
  slug: string;
  skus: string[];
  variants: { id: string; sku: string }[];
  imageCount: number;
}

/**
 * Un catálogo completo cabe en una tanda; la subida va de 4 en 4 y espera si la
 * tienda tiene muchas fotos en proceso (D-LOTE-03).
 */
const MAX_FILES = 2000;
/** Filas de la tabla de asignación: más harían lenta la pantalla en un celular. */
const SHOWN_ROWS = 300;
/** La foto de cada sabor se asigna cuando termina de optimizarse (segundos). */
const VARIANT_POLL_MS = 3_000;
const VARIANT_POLL_TRIES = 60;

type VariantPhotos =
  | { phase: "asignando"; total: number; assigned: number }
  | { phase: "listo"; total: number; assigned: number; failed: number }
  | { phase: "pendiente"; total: number; assigned: number }
  | { phase: "error"; total: number; assigned: number; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RowState = "lista" | "subiendo" | "subida" | { error: string };

export function BulkImages({
  storeHandle,
  targets,
  processingBlocked = false,
}: {
  storeHandle: string;
  targets: BulkTarget[];
  processingBlocked?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [reading, setReading] = useState(false);
  const [tooMany, setTooMany] = useState(false);
  const [states, setStates] = useState<Map<number, RowState>>(new Map());
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState<{ ok: number; failed: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [variantPhotos, setVariantPhotos] = useState<VariantPhotos | null>(null);

  const matches = useMemo(
    () =>
      matchFiles(
        files.map((f) => f.path),
        targets,
      ),
    [files, targets],
  );
  const ready = useMemo(() => uploadOrder(matches), [matches]);
  const unmatched = matches.filter((m) => !m.productId);
  const productCount = new Set(ready.map((m) => m.productId)).size;
  const done = [...states.values()].filter((s) => s === "subida" || typeof s === "object").length;
  // Solo lo que falta: una foto ya subida nunca se vuelve a mandar (no se duplica).
  const pending = ready.filter((m) => states.get(m.index) !== "subida");
  const retrying = pending.length > 0 && pending.length < ready.length;

  // Cerrar la pestaña a media subida (o mientras se asignan las fotos de cada
  // sabor) corta lo que falta: se avisa.
  const busy = running || variantPhotos?.phase === "asignando";
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function choose(picked: PickedFile[]) {
    const images = picked.filter((f) =>
      (ALLOWED_IMAGE_MIME as readonly string[]).includes(f.file.type),
    );
    setTooMany(images.length > MAX_FILES);
    setFiles(images.slice(0, MAX_FILES));
    setStates(new Map());
    setFinished(null);
    setVariantPhotos(null);
  }

  async function start() {
    const batch = pending;
    if (batch.length === 0) return;
    setRunning(true);
    setFinished(null);
    setStates((prev) => {
      const next = new Map(prev);
      for (const m of batch) next.set(m.index, "subiendo");
      return next;
    });
    const outcomes = await uploadProductImages(
      storeHandle,
      batch.map((m) => ({ productId: m.productId!, file: files[m.index]!.file })),
      (position, outcome: UploadOutcome) => {
        const row = batch[position]!.index;
        setStates((prev) =>
          new Map(prev).set(row, outcome.ok ? "subida" : { error: outcome.error }),
        );
      },
    );
    const failed = outcomes.filter((o) => !o.ok).length;
    setFinished({ ok: ready.length - failed, failed });
    setRunning(false);
    const pairs = batch.flatMap((m, i) => {
      const outcome = outcomes[i];
      return m.variantId && outcome?.ok
        ? [{ variantId: m.variantId, mediaId: outcome.mediaId }]
        : [];
    });
    if (pairs.length > 0) await assignVariantPhotos(pairs);
  }

  /** Pide la asignación hasta que todas las fotos de sabor estén listas. */
  async function assignVariantPhotos(pairs: { variantId: string; mediaId: string }[]) {
    const total = pairs.length;
    if (processingBlocked) {
      setVariantPhotos({ phase: "pendiente", total, assigned: 0 });
      return;
    }
    let left = pairs;
    let assigned = 0;
    let failed = 0;
    setVariantPhotos({ phase: "asignando", total, assigned });
    for (let attempt = 0; attempt < VARIANT_POLL_TRIES && left.length > 0; attempt++) {
      if (attempt > 0) await sleep(VARIANT_POLL_MS);
      const result = await assignVariantPhotosWhenReady(storeHandle, left).catch(() => null);
      if (!result) continue;
      assigned += result.assigned.length;
      if (result.fatal) {
        setVariantPhotos({ phase: "error", total, assigned, message: result.fatal });
        return;
      }
      failed += result.failed.length;
      left = left.filter((p) => result.waiting.includes(p.variantId));
      setVariantPhotos({ phase: "asignando", total, assigned });
    }
    setVariantPhotos(
      left.length > 0
        ? { phase: "pendiente", total, assigned }
        : { phase: "listo", total, assigned, failed },
    );
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          if (running) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (running) return;
          // Carpetas arrastradas: se recorren para conservar la ruta de cada foto.
          setReading(true);
          void filesFromDrop(e.dataTransfer)
            .then(choose)
            .finally(() => setReading(false));
        }}
        className={`space-y-1 rounded-md border p-4 ${dragging ? "border-2 border-dashed border-accent bg-surface" : "border-border"}`}
      >
        <label htmlFor="bulk-images-input" className="text-sm font-medium">
          Fotos (JPG, PNG, WebP o AVIF; hasta {MAX_FILES} por tanda)
        </label>
        <p id="bulk-images-hint" className="text-[13px] text-fg-muted">
          Elígelas aquí o arrástralas a este recuadro (también una carpeta completa). Las aligeramos
          en tu dispositivo antes de subirlas, así suben mucho más rápido.
        </p>
        <input
          ref={inputRef}
          id="bulk-images-input"
          type="file"
          accept={ALLOWED_IMAGE_MIME.join(",")}
          multiple
          disabled={running}
          aria-describedby="bulk-images-hint"
          onChange={(e) => choose(fromInput(e.target.files))}
          className="block min-h-11 text-sm"
        />
        <div className="pt-2">
          <input
            ref={folderRef}
            id="bulk-folder-input"
            type="file"
            multiple
            disabled={running}
            // Lo abre el botón de abajo; fuera del orden de tabulación para no repetirlo.
            aria-label="Carpeta de fotos"
            tabIndex={-1}
            // Elegir una carpeta completa (con una subcarpeta por producto).
            {...{ webkitdirectory: "" }}
            onChange={(e) => choose(fromInput(e.target.files))}
            className="sr-only"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={running}
            onClick={() => folderRef.current?.click()}
          >
            Elegir una carpeta completa
          </Button>
        </div>
        {reading ? (
          <p role="status" className="text-sm text-fg-muted">
            Leyendo la carpeta…
          </p>
        ) : null}
        {tooMany ? (
          <p role="alert" className="text-sm text-danger">
            Elegiste más de {MAX_FILES} fotos: tomamos las primeras {MAX_FILES}. Sube el resto en
            otra tanda (elige solo las carpetas que faltan).
          </p>
        ) : null}
      </div>

      {files.length > 0 ? (
        <>
          <div aria-live="polite" className="space-y-1 text-sm">
            <p>
              <strong>{ready.length}</strong> {ready.length === 1 ? "foto" : "fotos"} para{" "}
              <strong>{productCount}</strong> {productCount === 1 ? "producto" : "productos"}
              {unmatched.length > 0 ? (
                <>
                  {" "}
                  · <strong>{unmatched.length}</strong> sin producto (no se subirán)
                </>
              ) : null}
              .
            </p>
            {running ? (
              <p className="text-fg-muted">
                Subiendo {done} de {ready.length}…
              </p>
            ) : null}
            {finished ? (
              <p role="status" className={finished.failed ? "text-danger" : "text-success"}>
                {finished.ok} {finished.ok === 1 ? "foto subida" : "fotos subidas"}
                {finished.failed
                  ? `, ${finished.failed} con error (revisa la tabla y reintenta)`
                  : ""}
                . Las estamos optimizando; en unos segundos aparecen en cada producto.{" "}
                <Link href={`/admin/${storeHandle}/productos`} className="underline">
                  Ver productos
                </Link>
              </p>
            ) : null}
            {variantPhotos ? <p role="status">{variantPhotosText(variantPhotos)}</p> : null}
          </div>

          {pending.length > 0 ? (
            <Button type="button" onClick={() => void start()} disabled={running}>
              {running
                ? "Subiendo…"
                : retrying
                  ? `Reintentar ${pending.length} con error`
                  : `Subir ${pending.length} ${pending.length === 1 ? "foto" : "fotos"}`}
            </Button>
          ) : null}

          <Table caption="Asignación de fotos a productos">
            <THead>
              <TR>
                <TH>Archivo</TH>
                <TH>Producto</TH>
                <TH>Foto</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {[...ready, ...unmatched].slice(0, SHOWN_ROWS).map((m) => (
                <TR key={m.index}>
                  <TD className="break-all">{m.name}</TD>
                  <TD>{productCell(m)}</TD>
                  <TD className="tabular-nums">{m.productId ? orderLabel(m, targets) : "—"}</TD>
                  <TD>{stateCell(m, states.get(m.index))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {ready.length + unmatched.length > SHOWN_ROWS ? (
            <p className="text-[13px] text-fg-muted">
              Se muestran las primeras {SHOWN_ROWS} fotos; se suben todas las que tienen producto.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function variantPhotosText(v: VariantPhotos): string {
  const of = `${v.assigned} de ${v.total}`;
  if (v.phase === "asignando") return `Asignando la foto de cada sabor o tamaño: ${of}…`;
  if (v.phase === "error") {
    return `Foto de sabor o tamaño asignada: ${of}. ${v.message} Las que faltan, elígelas en la ficha del producto, en «Foto de cada presentación».`;
  }
  if (v.phase === "listo") {
    return v.failed > 0
      ? `Foto de sabor o tamaño asignada: ${of}. ${v.failed} no se pudieron asignar; elígelas en la ficha del producto.`
      : `Foto de sabor o tamaño asignada: ${of}.`;
  }
  return `Foto de sabor o tamaño asignada: ${of}. Las demás siguen optimizándose; cuando estén listas, elígelas en la ficha del producto, en «Foto de cada presentación».`;
}

function productCell(m: FileMatch) {
  if (m.ambiguous) {
    return (
      <span className="text-danger">
        {m.matchedBy === "sku" ? "SKU repetido" : "Nombre repetido"} en varios productos
      </span>
    );
  }
  if (!m.productId) return <span className="text-fg-muted">Sin coincidencia</span>;
  return (
    <>
      {m.productTitle}{" "}
      <span className="text-[13px] text-fg-muted">
        (por {m.matchedVia === "carpeta" ? "carpeta, " : ""}
        {m.matchedBy === "sku" ? "SKU" : "nombre"}
        {m.variantSku ? `; foto del sabor ${m.variantSku}` : ""})
      </span>
    </>
  );
}

/** Las fotos nuevas van después de las que el producto ya tiene. */
function orderLabel(m: FileMatch, targets: BulkTarget[]) {
  const existing = targets.find((t) => t.id === m.productId)?.imageCount ?? 0;
  return existing > 0 ? `${m.order} (después de ${existing})` : String(m.order);
}

function stateCell(m: FileMatch, state: RowState | undefined) {
  if (!m.productId) return <span className="text-fg-muted">No se sube</span>;
  if (!state || state === "lista") return "Lista";
  if (state === "subiendo") return "Subiendo…";
  if (state === "subida") return <span className="text-success">Subida</span>;
  return <span className="text-danger">{state.error}</span>;
}

interface PickedFile {
  file: File;
  /** Ruta relativa dentro de la carpeta elegida, o solo el nombre. */
  path: string;
}

function fromInput(list: FileList | null): PickedFile[] {
  return Array.from(list ?? []).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

/** Archivos y carpetas arrastrados, con su ruta (recorre las subcarpetas). */
async function filesFromDrop(data: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(data.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));
  if (entries.length === 0) return fromInput(data.files);
  const out: PickedFile[] = [];
  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (out.length > MAX_FILES) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      out.push({ file, path: `${prefix}${file.name}` });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries entrega por bloques (100 en Chrome): se lee hasta vaciar.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  }
  for (const entry of entries) await walk(entry, "");
  return out;
}
