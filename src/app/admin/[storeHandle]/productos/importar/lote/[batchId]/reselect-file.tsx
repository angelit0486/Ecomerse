"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/ui/primitives/button";

import type { UploadedPart } from "@/lib/imports/split";
import { partsToSend, readImportFile, sendParts, type Progress } from "../batch-upload";

type State =
  | { step: "idle" }
  | { step: "reading" }
  | { step: "uploading"; progress: Progress }
  | { step: "done"; message: string }
  | { step: "error"; message: string };

/**
 * Retomar o corregir un lote (ADR-064 A): el mismo archivo (o su versión
 * corregida) se parte otra vez aquí y solo se suben las partes que faltan, las
 * que fallaron o las que cambiaron. Una parte ya aplicada no se toca.
 */
export function ReselectFile({
  storeHandle,
  batchId,
  partsCount,
  live,
  missing,
}: {
  storeHandle: string;
  batchId: string;
  partsCount: number;
  live: UploadedPart[];
  missing: number;
}) {
  const router = useRouter();
  const id = useId();
  const [state, setState] = useState<State>({ step: "idle" });
  const busy = state.step === "reading" || state.step === "uploading";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const file = (event.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    setState({ step: "reading" });
    const read = await readImportFile(file, true);
    if (read.kind !== "batch") {
      setState({
        step: "error",
        message: read.kind === "error" ? read.message : "No pudimos leer el archivo.",
      });
      return;
    }
    if (read.file.parts.length !== partsCount) {
      setState({
        step: "error",
        message: `Con este archivo salen ${read.file.parts.length} partes y el lote tiene ${partsCount}. Elige el mismo archivo o su versión corregida sin agregar ni quitar productos; si cambió mucho, empieza un lote nuevo.`,
      });
      return;
    }
    const plan = partsToSend(read.file, live);
    if (!plan.ok) {
      setState({ step: "error", message: plan.message });
      return;
    }
    if (plan.parts.length === 0) {
      setState({
        step: "done",
        message: "Este archivo no trae partes nuevas ni corregidas: no se subió nada.",
      });
      return;
    }
    const sent = await sendParts(storeHandle, batchId, read.file, plan.parts, (progress) =>
      setState({ step: "uploading", progress }),
    );
    if (!sent.ok) {
      setState({ step: "error", message: sent.message });
      router.refresh();
      return;
    }
    setState({
      step: "done",
      message:
        plan.parts.length === 1
          ? `Se subió la parte ${plan.parts[0]}.`
          : `Se subieron las partes ${plan.parts.join(", ")}.`,
    });
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-busy={busy}
      aria-labelledby={`${id}-h`}
      className="space-y-2 rounded-md border border-border p-4 text-sm"
    >
      <h2 id={`${id}-h`} className="font-semibold">
        {missing > 0 ? "Subir las partes que faltan" : "Corregir una parte"}
      </h2>
      <p className="text-fg-muted">
        {missing > 0
          ? "Vuelve a elegir el mismo archivo: se suben solo las partes que faltan."
          : "Corrige tu archivo y elígelo aquí: se suben solo las partes que cambiaron o que fallaron. Las partes ya aplicadas no se tocan."}
      </p>
      <label htmlFor={`${id}-file`} className="block font-medium">
        Archivo CSV
      </label>
      <input
        id={`${id}-file`}
        name="file"
        type="file"
        accept=".csv,text/csv"
        required
        className="block w-full max-w-full min-h-11"
      />
      <Button type="submit" variant="secondary" loading={busy}>
        {busy ? "Revisando…" : "Revisar y subir"}
      </Button>
      {state.step === "reading" ? <p role="status">Leyendo el archivo…</p> : null}
      {state.step === "uploading" ? (
        <p role="status">
          Subiendo y revisando la parte {state.progress.part} de {state.progress.total}…
        </p>
      ) : null}
      {state.step === "done" ? <p role="status">{state.message}</p> : null}
      {state.step === "error" ? (
        <p role="alert" className="rounded-md border border-danger p-3">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
