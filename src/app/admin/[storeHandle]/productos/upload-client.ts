import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/media/constants";
import { compressImage, runPool } from "@/lib/media/compress";

import { finalizeProductImageUpload, requestProductImageUpload } from "./actions";
import { FIELD_MESSAGES } from "./messages";

/**
 * Subida de fotos de producto desde el navegador (§25.3: reservar → PUT directo
 * a Storage → finalizar), compartida por la ficha y la subida en lote.
 *
 * - Cada foto se aligera antes de subir (compressImage).
 * - Hasta UPLOAD_LANES fotos viajan a la vez.
 * - Las reservas de un mismo producto se piden en orden: la posición de cada
 *   foto la asigna la base al reservar, así se respeta el orden elegido.
 */
export const UPLOAD_LANES = 4;
/** Se aceptan originales más pesados porque se aligeran antes de subir. */
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;
const RETRY_WAIT_MS = 5_000;
const MAX_RETRIES = 12;

export interface UploadItem {
  productId: string;
  file: File;
}

export type UploadOutcome = { ok: true; mediaId: string } | { ok: false; error: string };

/** La foto, ya aligerada, sigue fuera de formato o de tamaño. */
class TooLarge extends Error {}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isAllowed(file: File): boolean {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type);
}

export async function uploadProductImages(
  storeHandle: string,
  items: readonly UploadItem[],
  onProgress?: (index: number, outcome: UploadOutcome) => void,
): Promise<UploadOutcome[]> {
  const reservations = new Map<string, Promise<unknown>>();

  /** Encadena la reserva tras la anterior del mismo producto (orden de posición). */
  function reserveInOrder(productId: string, prepared: Promise<File>) {
    const previous = reservations.get(productId) ?? Promise.resolve();
    const current = previous.then(async () => {
      const file = await prepared;
      for (let attempt = 0; ; attempt++) {
        const ticket = await requestProductImageUpload(storeHandle, {
          productId,
          mimeType: file.type,
          bytes: file.size,
        });
        // Tope de subidas pendientes: se libera en segundos al procesarse.
        if (!ticket.ok && ticket.retry && attempt < MAX_RETRIES) {
          await wait(RETRY_WAIT_MS);
          continue;
        }
        return ticket;
      }
    });
    reservations.set(
      productId,
      current.catch(() => undefined),
    );
    return current;
  }

  return runPool(items, UPLOAD_LANES, async (item, index) => {
    const outcome = await uploadOne(item);
    onProgress?.(index, outcome);
    return outcome;
  });

  async function uploadOne({ productId, file: original }: UploadItem): Promise<UploadOutcome> {
    if (!isAllowed(original) || original.size > MAX_ORIGINAL_BYTES) {
      return { ok: false, error: FIELD_MESSAGES.file! };
    }
    // Se encola la reserva antes de cualquier espera: así el orden de reserva
    // (y de posición) es el de la lista aunque la compresión termine desordenada.
    const prepared = compressImage(original).then((file) =>
      isAllowed(file) && file.size <= MAX_UPLOAD_BYTES ? file : Promise.reject(new TooLarge()),
    );
    const reserved = reserveInOrder(productId, prepared);
    try {
      const [file, ticket] = await Promise.all([prepared, reserved]);
      if (!ticket.ok) return { ok: false, error: ticket.error };
      const response = await fetch(ticket.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      }).catch(() => null);
      if (!response?.ok) {
        return { ok: false, error: "No se pudo subir. Revisa tu conexión e inténtalo de nuevo." };
      }
      const finalized = await finalizeProductImageUpload(storeHandle, ticket.mediaId);
      return finalized.ok
        ? { ok: true, mediaId: ticket.mediaId }
        : { ok: false, error: finalized.error ?? "No se pudo guardar." };
    } catch (error) {
      if (error instanceof TooLarge) return { ok: false, error: FIELD_MESSAGES.file! };
      return { ok: false, error: "Se perdió la conexión. Inténtalo de nuevo." };
    }
  }
}
