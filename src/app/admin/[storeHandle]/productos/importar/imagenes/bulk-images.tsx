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

/** Más fotos por tanda harían eterna la vista previa en un celular. */
const MAX_FILES = 500;
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
  const [files, setFiles] = useState<File[]>([]);
  const [tooMany, setTooMany] = useState(false);
  const [states, setStates] = useState<Map<number, RowState>>(new Map());
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState<{ ok: number; failed: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [variantPhotos, setVariantPhotos] = useState<VariantPhotos | null>(null);

  const matches = useMemo(
    () =>
      matchFiles(
        files.map((f) => f.name),
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

  function choose(list: FileList | null) {
    const images = Array.from(list ?? []).filter((f) =>
      (ALLOWED_IMAGE_MIME as readonly string[]).includes(f.type),
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
      batch.map((m) => ({ productId: m.productId!, file: files[m.index]! })),
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
          if (!running) choose(e.dataTransfer.files);
        }}
        className={`space-y-1 rounded-md border p-4 ${dragging ? "border-2 border-dashed border-accent bg-surface" : "border-border"}`}
      >
        <label htmlFor="bulk-images-input" className="text-sm font-medium">
          Fotos (JPG, PNG, WebP o AVIF; hasta {MAX_FILES} por tanda)
        </label>
        <p id="bulk-images-hint" className="text-[13px] text-fg-muted">
          Elígelas aquí o arrástralas a este recuadro. Las aligeramos en tu dispositivo antes de
          subirlas, así suben mucho más rápido.
        </p>
        <input
          ref={inputRef}
          id="bulk-images-input"
          type="file"
          accept={ALLOWED_IMAGE_MIME.join(",")}
          multiple
          disabled={running}
          aria-describedby="bulk-images-hint"
          onChange={(e) => choose(e.target.files)}
          className="block text-sm"
        />
        {tooMany ? (
          <p role="alert" className="text-sm text-danger">
            Elegiste más de {MAX_FILES} fotos: tomamos las primeras {MAX_FILES}. Sube el resto en
            otra tanda.
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
              {[...ready, ...unmatched].map((m) => (
                <TR key={m.index}>
                  <TD className="break-all">{m.name}</TD>
                  <TD>{productCell(m)}</TD>
                  <TD className="tabular-nums">{m.productId ? orderLabel(m, targets) : "—"}</TD>
                  <TD>{stateCell(m, states.get(m.index))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
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
  if (m.ambiguous) return <span className="text-danger">SKU repetido en varios productos</span>;
  if (!m.productId) return <span className="text-fg-muted">Sin coincidencia</span>;
  return (
    <>
      {m.productTitle}{" "}
      <span className="text-[13px] text-fg-muted">
        (por {m.matchedBy === "sku" ? "SKU" : "nombre"}
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
