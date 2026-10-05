import { cn } from "@/lib/cn";

/** Marcador de carga con la forma del contenido. Oculto a lectores de pantalla. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-[var(--radius-control)] bg-border motion-safe:animate-pulse",
        className,
      )}
    />
  );
}
