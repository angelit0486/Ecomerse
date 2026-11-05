"use client";

import { Button } from "@/ui/primitives/button";

/** Abre el diálogo de impresión del navegador (en el celular: imprimir o guardar PDF). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
