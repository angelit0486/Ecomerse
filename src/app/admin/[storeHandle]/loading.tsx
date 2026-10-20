import { Skeleton } from "@/ui/primitives/skeleton";

/** Esqueleto mientras carga una pantalla de la tienda (el menú sigue visible). */
export default function StoreLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Cargando…</span>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
