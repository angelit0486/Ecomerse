"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { matchFiles, uploadOrder, type FileMatch } from "@/lib/media/bulk-match";
import { ALLOWED_IMAGE_MIME } from "@/lib/media/constants";
import { Button } from "@/ui/primitives/button";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { uploadProductImages, type UploadOutcome } from "../../upload-client";

export interface BulkTarget {
  id: string;
  title: string;
  slug: string;
  skus: string[];
  imageCount: number;
}

/** Más fotos por tanda harían eterna la vista previa en un celular. */
const MAX_FILES = 500;

type RowState = "lista" | "subiendo" | "subida" | { error: string };

export function BulkImages({
  storeHandle,
  targets,
}: {
  storeHandle: string;
  targets: BulkTarget[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [tooMany, setTooMany] = useState(false);
  const [states, setStates] = useState<Map<number, RowState>>(new Map());
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState<{ ok: number; failed: number } | null>(null);

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

  function choose(list: FileList | null) {
    const images = Array.from(list ?? []).filter((f) =>
      (ALLOWED_IMAGE_MIME as readonly string[]).includes(f.type),
    );
    setTooMany(images.length > MAX_FILES);
    setFiles(images.slice(0, MAX_FILES));
    setStates(new Map());
    setFinished(null);
  }

  async function start() {
    if (ready.length === 0) return;
    setRunning(true);
    setFinished(null);
    setStates(new Map(ready.map((m) => [m.index, "subiendo" as RowState])));
    const outcomes = await uploadProductImages(
      storeHandle,
      ready.map((m) => ({ productId: m.productId!, file: files[m.index]! })),
      (position, outcome: UploadOutcome) => {
        const row = ready[position]!.index;
        setStates((prev) =>
          new Map(prev).set(row, outcome.ok ? "subida" : { error: outcome.error }),
        );
      },
    );
    const ok = outcomes.filter((o) => o.ok).length;
    setFinished({ ok, failed: outcomes.length - ok });
    setRunning(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-md border border-border p-4">
        <label htmlFor="bulk-images-input" className="text-sm font-medium">
          Fotos (JPG, PNG, WebP o AVIF; hasta {MAX_FILES} por tanda)
        </label>
        <p id="bulk-images-hint" className="text-[13px] text-fg-muted">
          Las aligeramos en tu dispositivo antes de subirlas, así suben mucho más rápido.
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
                {finished.failed ? `, ${finished.failed} con error (revisa la tabla)` : ""}. Las
                estamos optimizando; en unos segundos aparecen en cada producto.{" "}
                <Link href={`/admin/${storeHandle}/productos`} className="underline">
                  Ver productos
                </Link>
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            onClick={() => void start()}
            disabled={running || ready.length === 0}
          >
            {running
              ? "Subiendo…"
              : `Subir ${ready.length} ${ready.length === 1 ? "foto" : "fotos"}`}
          </Button>

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

function productCell(m: FileMatch) {
  if (m.ambiguous) return <span className="text-danger">SKU repetido en varios productos</span>;
  if (!m.productId) return <span className="text-fg-muted">Sin coincidencia</span>;
  return (
    <>
      {m.productTitle}{" "}
      <span className="text-[13px] text-fg-muted">
        (por {m.matchedBy === "sku" ? "SKU" : "nombre"})
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
