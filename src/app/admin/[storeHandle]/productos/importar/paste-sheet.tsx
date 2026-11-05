"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";

import { CsvParseError, parseCsv } from "@/lib/csv-parse";
import { PASTE_MAX_BYTES, PasteError, pastedToCsv } from "@/lib/imports/paste";
import { translatePlatformCsv } from "@/lib/imports/platforms";

import { linkButton, nativeControl } from "../styles";
import { COLUMN_LABELS } from "./labels";

const MAX_ROWS = 5000;

type Summary =
  | { state: "empty" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      csv: string;
      products: number;
      used: string[];
      ignored: string[];
      sheet: boolean;
    };

function summarize(text: string): Summary {
  if (!text.trim()) return { state: "empty" };
  try {
    const csv = pastedToCsv(text);
    if (new TextEncoder().encode(csv).length > PASTE_MAX_BYTES) {
      return { state: "error", message: "Lo pegado pesa más de 4 MB. Pega por partes." };
    }
    const parsed = parseCsv(csv);
    if (parsed.rows.length === 0) {
      return {
        state: "error",
        message: "Pega también las filas de productos, debajo de los títulos de las columnas.",
      };
    }
    if (parsed.rows.length > MAX_ROWS) {
      return { state: "error", message: "Son más de 5 000 filas. Pega por partes." };
    }
    const t = translatePlatformCsv(parsed.headers, parsed.rows, parsed.rowNumbers);
    return {
      state: "ok",
      csv,
      products: t.rows.length,
      used: t.headers.filter((h) => h !== "handle").map((h) => COLUMN_LABELS[h] ?? h),
      ignored: t.ignored,
      sheet: t.platform === "hoja",
    };
  } catch (error) {
    if (error instanceof PasteError || error instanceof CsvParseError) {
      return {
        state: "error",
        message:
          "No pudimos leer lo pegado: revisa que sean celdas copiadas de tu hoja, con los títulos de las columnas arriba.",
      };
    }
    throw error;
  }
}

/**
 * «Lo más rápido: pega tus filas» (plan 2026-11-05, fase C). Lo pegado se
 * convierte a CSV en el navegador y se manda como archivo al MISMO endpoint que
 * la subida normal: misma validación, misma vista previa por fila y nada cambia
 * en el catálogo hasta confirmar.
 */
export function PasteSheet({ action }: { action: string }) {
  const [text, setText] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const id = useId();
  const summary = useMemo(() => summarize(text), [text]);
  const ready = summary.state === "ok" && summary.products > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (summary.state !== "ok" || !file.current || !form.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(new File([summary.csv], "hoja-pegada.csv", { type: "text/csv" }));
    file.current.files = transfer.files;
    form.current.submit();
  }

  return (
    <section
      aria-labelledby={`${id}-h`}
      className="space-y-3 rounded-md border border-accent p-4 text-sm"
    >
      <h2 id={`${id}-h`} className="font-semibold">
        Lo más rápido: pega tus filas
      </h2>
      <p>
        Copia las celdas de tu hoja en Excel o Google Sheets, con los títulos de las columnas en la
        primera fila, y pégalas aquí. Entendemos columnas como <code>Producto</code>,{" "}
        <code>Precio</code>, <code>Precio anterior</code>, <code>Existencias</code>,{" "}
        <code>Categoría</code>, <code>Marca</code>, <code>Fotos</code> (enlaces https),{" "}
        <code>SKU</code>, <code>Descripción</code> y <code>Peso (kg)</code>. No necesitas inventar
        un nombre corto: lo creamos con el nombre de cada producto.
      </p>
      <form
        ref={form}
        method="post"
        action={action}
        encType="multipart/form-data"
        onSubmit={submit}
        className="space-y-3"
      >
        <input ref={file} type="file" name="file" hidden tabIndex={-1} aria-hidden="true" />
        <div className="space-y-1">
          <label htmlFor={`${id}-text`} className="text-sm font-medium">
            Filas copiadas de tu hoja
          </label>
          <textarea
            id={`${id}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            spellCheck={false}
            aria-describedby={`${id}-sum`}
            className="block w-full rounded-[var(--radius-control)] border border-control bg-surface p-2 font-mono text-[13px]"
          />
        </div>
        <div id={`${id}-sum`} role="status" aria-live="polite" className="space-y-1">
          {summary.state === "error" ? <p>{summary.message}</p> : null}
          {summary.state === "ok" ? (
            <>
              <p>
                Entendimos{" "}
                <strong>
                  {summary.products === 1 ? "1 producto" : `${summary.products} productos`}
                </strong>
                {summary.used.length > 0 ? (
                  <> con estas columnas: {summary.used.join(", ")}.</>
                ) : (
                  "."
                )}
              </p>
              {summary.ignored.length > 0 ? (
                <p className="text-fg-muted">
                  No usaremos: {summary.ignored.join(", ")}. Puedes renombrar esas columnas y volver
                  a pegar.
                </p>
              ) : null}
              {summary.sheet ? (
                <p className="text-fg-muted">
                  Las categorías deben existir antes: si escribes una que no existe, la vista previa
                  te lo dirá en esa fila.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-mode`} className="text-sm font-medium">
            Qué hacer
          </label>
          <select
            id={`${id}-mode`}
            name="mode"
            defaultValue="upsert"
            className={`${nativeControl} block w-full sm:w-auto md:h-11`}
          >
            <option value="upsert">Crear los nuevos y actualizar los existentes</option>
            <option value="create_only">Solo crear productos nuevos</option>
            <option value="update_existing">Solo actualizar productos existentes</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={!ready}
          className={`${linkButton} bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-60 md:h-11`}
        >
          Validar filas
        </button>
        <p className="text-[13px] text-fg-muted">
          Verás los errores por fila antes de que cambie nada en tu catálogo.
        </p>
      </form>
    </section>
  );
}
