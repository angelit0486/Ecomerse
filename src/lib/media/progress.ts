/**
 * Avance de las fotos de producto de una tienda (Orden 09): cuántas están
 * listas, cuántas esperan a la cola y cuántas se rechazaron. Sin fechas ni
 * tiempos estimados: solo lo que se puede contar.
 */
export interface PhotoCounts {
  pending: number;
  ready: number;
  rejected: number;
}

export interface PhotoProgress {
  total: number;
  /** Fotos que ya no esperan (listas o rechazadas), de 0 a 100. */
  percent: number;
  done: boolean;
  summary: string;
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("es-MX")} ${n === 1 ? one : many}`;

export function photoProgress(counts: PhotoCounts): PhotoProgress {
  const pending = Math.max(0, counts.pending);
  const ready = Math.max(0, counts.ready);
  const rejected = Math.max(0, counts.rejected);
  const total = pending + ready + rejected;
  if (total === 0) {
    return { total, percent: 100, done: true, summary: "Tu tienda todavía no tiene fotos." };
  }
  // Nunca 100 % con fotos en espera: 9,999 de 10,000 es 99 %.
  const percent =
    pending === 0 ? 100 : Math.min(99, Math.floor(((ready + rejected) / total) * 100));
  const parts = [plural(ready, "foto lista", "fotos listas")];
  if (pending > 0) parts.push(plural(pending, "en proceso", "en proceso"));
  if (rejected > 0) parts.push(plural(rejected, "no se pudo usar", "no se pudieron usar"));
  return { total, percent, done: pending === 0, summary: `${parts.join(" · ")}.` };
}
