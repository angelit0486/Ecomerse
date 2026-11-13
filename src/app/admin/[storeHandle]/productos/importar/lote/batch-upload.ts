import {
  decodeCsvBytes,
  MAX_BATCH_FILE_BYTES,
  MAX_PART_ROWS,
  MAX_SINGLE_FILE_BYTES,
  partBody,
  partsToSend as planParts,
  prepareImport,
  sha256Hex,
  type PreparedImport,
  type UploadedPart,
} from "@/lib/imports/split";

import { startImportBatch } from "./actions";

/**
 * Lado del navegador de ADR-064 A: leer el archivo, decidir si sube entero (como
 * siempre) o por partes, y subir las partes una por una. Lo que ya se subió no
 * se vuelve a mandar: la base reconoce cada parte por su huella.
 */
export interface PreparedPart {
  body: string;
  fingerprint: string;
  rows: number;
}

export interface PreparedFile {
  fileName: string;
  fileFingerprint: string;
  rows: number;
  headers: string[];
  parts: PreparedPart[];
}

export type ReadResult =
  { kind: "single" } | { kind: "batch"; file: PreparedFile } | { kind: "error"; message: string };

const FORMAT: Record<string, string> = {
  quote: "hay una comilla dentro de una celda sin comillas",
  unclosed: "unas comillas no se cierran",
  columns: "una fila tiene más de 100 columnas",
  field: "una celda tiene más de 20 000 caracteres",
};

function preparedError(prepared: Exclude<PreparedImport, { ok: true }>): string {
  switch (prepared.code) {
    case "formato": {
      const [line, code] = prepared.detail.split(":");
      return `No pudimos leer el CSV (fila ${line}: ${FORMAT[code ?? ""] ?? "formato inválido"}).`;
    }
    case "vacio":
      return "El archivo no tiene filas debajo del encabezado.";
    case "columnas":
      return "Revisa los encabezados del archivo: necesita la columna «handle» (o «Producto» en la hoja en español).";
    case "filas":
      return "El archivo tiene más de 50,000 filas. Divídelo en varios archivos.";
    case "producto":
      return `El producto que empieza en la fila ${prepared.detail} tiene demasiadas filas para una parte (más de 5,000 o más de 3.5 MB).`;
    case "partes":
      return `El archivo necesitaría ${prepared.detail} partes y el máximo es 10. Divídelo en varios archivos.`;
  }
}

/** Saltos de línea del archivo: con 5,001 o menos, no puede pasar de 5,000 filas. */
function lineBreaks(bytes: Uint8Array): number {
  let count = 0;
  for (const b of bytes) if (b === 0x0a) count += 1;
  return count;
}

/**
 * Archivo → «sube entero» (≤ 4 MB y ≤ 5,000 filas: el camino de siempre, que
 * valida el servidor) o las partes ya listas con sus huellas.
 */
export async function readImportFile(file: File, forceBatch = false): Promise<ReadResult> {
  if (file.size > MAX_BATCH_FILE_BYTES) {
    return { kind: "error", message: "El archivo pesa más de 40 MB. Divídelo en varios archivos." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const small = file.size <= MAX_SINGLE_FILE_BYTES;
  if (!forceBatch && small && lineBreaks(bytes) <= MAX_PART_ROWS + 1) return { kind: "single" };
  const text = decodeCsvBytes(bytes);
  if (text === null) {
    return {
      kind: "error",
      message:
        "El archivo no está en UTF-8. En Excel usa «Guardar como → CSV UTF-8 (delimitado por comas)».",
    };
  }
  const prepared = prepareImport(text);
  if (!prepared.ok) {
    // Un archivo chico con un problema sube entero: el servidor explica el error como siempre.
    if (!forceBatch && small) return { kind: "single" };
    return { kind: "error", message: preparedError(prepared) };
  }
  if (!forceBatch && small && prepared.rows <= MAX_PART_ROWS) return { kind: "single" };
  const bodies = prepared.parts.map(partBody);
  const fingerprints = await Promise.all(bodies.map((body) => sha256Hex(body)));
  return {
    kind: "batch",
    file: {
      fileName: file.name.slice(0, 200) || "archivo.csv",
      fileFingerprint: await sha256Hex(bytes),
      rows: prepared.rows,
      headers: prepared.parts[0]!.headers,
      parts: bodies.map((body, i) => ({
        body,
        fingerprint: fingerprints[i]!,
        rows: prepared.parts[i]!.rows.length,
      })),
    },
  };
}

export type PartUpload = { ok: true; reused: boolean } | { ok: false; message: string };

/** Sube UNA parte (JSON) a su ruta; la respuesta de error ya viene en español. */
export async function uploadPart(
  storeHandle: string,
  batchId: string,
  part: number,
  body: string,
): Promise<PartUpload> {
  let response: Response;
  try {
    response = await fetch(
      `/admin/${encodeURIComponent(storeHandle)}/productos/importar/lote/${batchId}/parte/${part}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        credentials: "same-origin",
      },
    );
  } catch {
    return {
      ok: false,
      message: `Se cortó la conexión al subir la parte ${part}. Vuelve a intentarlo: lo que ya se subió no se repite.`,
    };
  }
  const json = (await response.json().catch(() => null)) as {
    ok?: boolean;
    reused?: boolean;
    error?: { message?: string };
  } | null;
  if (response.ok && json?.ok) return { ok: true, reused: Boolean(json.reused) };
  return {
    ok: false,
    message:
      json?.error?.message ??
      `No pudimos subir la parte ${part} (error ${response.status}). Vuelve a intentarlo: lo que ya se subió no se repite.`,
  };
}

export interface Progress {
  part: number;
  total: number;
  skipped: number;
}

/** Partes del archivo que hay que subir, comparadas con lo que ya tiene el lote. */
export function partsToSend(file: PreparedFile, live: UploadedPart[]) {
  return planParts(
    file.parts.map((p) => p.fingerprint),
    live,
  );
}

/** Sube las partes indicadas en orden; se detiene en la primera que falla. */
export async function sendParts(
  storeHandle: string,
  batchId: string,
  file: PreparedFile,
  parts: number[],
  onProgress: (progress: Progress) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const skipped = file.parts.length - parts.length;
  for (const n of parts) {
    onProgress({ part: n, total: file.parts.length, skipped });
    const result = await uploadPart(storeHandle, batchId, n, file.parts[n - 1]!.body);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** Crea (o retoma) el lote del archivo y sube lo que falta. */
export async function sendBatch(
  storeHandle: string,
  file: PreparedFile,
  mode: string,
  onProgress: (progress: Progress) => void,
): Promise<{ ok: true; batchId: string } | { ok: false; message: string; batchId?: string }> {
  const start = await startImportBatch(storeHandle, {
    fileName: file.fileName,
    mode,
    headers: file.headers,
    partRows: file.parts.map((p) => p.rows),
    partFingerprints: file.parts.map((p) => p.fingerprint),
    fileFingerprint: file.fileFingerprint,
  });
  if (!start.ok) return start;
  const plan = partsToSend(file, start.parts);
  if (!plan.ok) return { ...plan, batchId: start.batchId };
  const sent = await sendParts(storeHandle, start.batchId, file, plan.parts, onProgress);
  return sent.ok ? { ok: true, batchId: start.batchId } : { ...sent, batchId: start.batchId };
}
