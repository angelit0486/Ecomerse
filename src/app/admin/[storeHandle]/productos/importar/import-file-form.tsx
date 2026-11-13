"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { linkButton, nativeControl } from "../styles";
import { readImportFile, sendBatch, type Progress } from "./lote/batch-upload";

type State =
  | { step: "idle" }
  | { step: "reading" }
  | { step: "uploading"; progress: Progress }
  | { step: "error"; message: string; batchUrl?: string };

/**
 * Paso 3 del importador. Un archivo de hasta 4 MB y 5,000 filas sube entero, como
 * siempre (el servidor lo lee y lo valida). Uno más grande se parte aquí, en el
 * navegador, en partes de hasta 5,000 filas sin separar las filas de un producto
 * (ADR-064 A); cada parte se valida en el servidor como un archivo más.
 */
export function ImportFileForm({ action, storeHandle }: { action: string; storeHandle: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "idle" });
  const busy = state.step === "reading" || state.step === "uploading";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    const mode = (form.elements.namedItem("mode") as HTMLSelectElement).value;
    if (!file) return;
    setState({ step: "reading" });
    const read = await readImportFile(file);
    if (read.kind === "single") {
      // El camino de siempre: el formulario sube el archivo entero.
      form.submit();
      return;
    }
    if (read.kind === "error") {
      setState({ step: "error", message: read.message });
      return;
    }
    const total = read.file.parts.length;
    setState({ step: "uploading", progress: { part: 1, total, skipped: 0 } });
    const sent = await sendBatch(storeHandle, read.file, mode, (progress) =>
      setState({ step: "uploading", progress }),
    );
    const batchUrl = sent.batchId
      ? `/admin/${storeHandle}/productos/importar/lote/${sent.batchId}`
      : undefined;
    if (!sent.ok) {
      setState({ step: "error", message: sent.message, ...(batchUrl ? { batchUrl } : {}) });
      return;
    }
    router.push(batchUrl!);
  }

  return (
    <form
      method="post"
      action={action}
      encType="multipart/form-data"
      onSubmit={onSubmit}
      className="space-y-4"
      aria-busy={busy}
    >
      <div className="space-y-1">
        <label htmlFor="file" className="text-sm font-medium">
          Archivo CSV de esta plataforma, Shopify, Tiendanube o una hoja simple
        </label>
        <p id="file-limits" className="text-[13px] text-fg-muted">
          Hasta 5,000 filas se revisan de una vez. Un archivo más grande (hasta 50,000 filas) se
          sube por partes de hasta 5,000 filas, sin separar las presentaciones de un producto.
        </p>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          aria-describedby="file-limits"
          className="block w-full max-w-full min-h-11 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="mode" className="text-sm font-medium">
          Qué hacer
        </label>
        <select
          id="mode"
          name="mode"
          defaultValue="upsert"
          className={`${nativeControl} block md:h-11 w-full sm:w-auto`}
        >
          <option value="upsert">Crear los nuevos y actualizar los existentes</option>
          <option value="create_only">Solo crear productos nuevos</option>
          <option value="update_existing">Solo actualizar productos existentes</option>
        </select>
        <p className="text-[13px] text-fg-muted">
          Un producto existente se reconoce por su nombre corto y cada presentación por su SKU o sus
          opciones. Importar nunca borra productos.
        </p>
      </div>
      {state.step === "reading" ? (
        <p role="status" className="text-sm">
          Leyendo el archivo…
        </p>
      ) : null}
      {state.step === "uploading" ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Archivo grande: se sube en {state.progress.total}{" "}
          {state.progress.total === 1 ? "parte" : "partes"}. Subiendo y revisando la parte{" "}
          {state.progress.part} de {state.progress.total}… No cierres esta página hasta que termine;
          si se corta, vuelve a elegir el mismo archivo y se retoma donde se quedó.
        </p>
      ) : null}
      {state.step === "error" ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger p-3 text-sm">
          <p>{state.message}</p>
          {state.batchUrl ? (
            <p>
              <a href={state.batchUrl} className="underline">
                Ver el lote
              </a>{" "}
              (lo que ya se subió está guardado).
            </p>
          ) : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className={`${linkButton} md:h-11 bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-60`}
      >
        {busy ? "Revisando…" : "Validar archivo"}
      </button>
      <p className="text-[13px] text-fg-muted">
        Verás los errores por fila antes de que cambie nada en tu catálogo.
      </p>
    </form>
  );
}
