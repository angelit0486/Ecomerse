import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * Tabla semántica con caption obligatorio (lo anuncian los lectores de
 * pantalla; puede ocultarse visualmente con `captionHidden`). En móvil se
 * desplaza horizontalmente dentro de su contenedor.
 */
export function Table({
  caption,
  captionHidden = false,
  children,
  className,
}: {
  caption: string;
  captionHidden?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-container)] border border-border">
      <table className={cn("w-full border-collapse text-left text-sm", className)}>
        <caption className={captionHidden ? "sr-only" : "px-4 py-2 text-left text-fg-muted"}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} className={cn("bg-canvas", props.className)} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} className={cn("divide-y divide-border", props.className)} />;
}

export function TR(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}

export function TH({ scope = "col", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      {...props}
      className={cn("px-4 py-2 text-[13px] font-medium text-fg-muted", props.className)}
    />
  );
}

export function TD(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={cn("px-4 py-3 text-fg", props.className)} />;
}
