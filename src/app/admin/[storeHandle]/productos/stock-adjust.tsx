"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";

import { adjustInventory, type InventoryActionState } from "../inventario/actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export interface StockRow {
  id: string;
  label: string;
  /** En mano en la ubicación principal (lo que fija el ajuste). */
  onHand: number;
  available: number;
  /** Historial de movimientos de la presentación (Inventario). */
  movementsHref: string;
}

/**
 * Ajuste rápido de existencias desde la ficha del producto: se escribe la
 * cantidad contada y el motivo. Pasa por inventory_adjust (movimiento con
 * motivo, permiso inventory.adjust e idempotencia), igual que en Inventario.
 */
export function StockAdjust({ storeHandle, rows }: { storeHandle: string; rows: StockRow[] }) {
  return (
    <section id="existencias" aria-labelledby="existencias-titulo" className="space-y-3">
      <h2 id="existencias-titulo" className="text-base font-semibold">
        Existencias
      </h2>
      <p className="text-sm text-fg-muted">
        Escribe cuántas piezas tienes en la ubicación principal. Queda registrado como un ajuste con
        su motivo.
      </p>
      <ul className="grid gap-3">
        {rows.map((row) => (
          <li key={row.id}>
            <StockRowForm storeHandle={storeHandle} row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StockRowForm({ storeHandle, row }: { storeHandle: string; row: StockRow }) {
  const router = useRouter();
  // Una clave por intento: un doble clic no ajusta dos veces.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useSafeActionState<InventoryActionState, FormData>(
    async (previous, formData) => {
      const result = await adjustInventory(storeHandle, previous, formData);
      if (result.ok) {
        setKey(crypto.randomUUID());
        router.refresh();
      }
      return result;
    },
    {},
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      aria-label={`Existencias de ${row.label}`}
      className="flex flex-wrap items-end gap-3 rounded border border-control p-3"
    >
      <input type="hidden" name="variant_id" value={row.id} />
      <input type="hidden" name="type" value="adjustment" />
      <input type="hidden" name="mode" value="set" />
      <input type="hidden" name="idempotency_key" value={key} />
      <div className="min-w-32">
        <p className="text-sm font-medium">{row.label}</p>
        <p className="text-[13px] text-fg-muted">
          {row.available} disponible{row.available === 1 ? "" : "s"}
        </p>
        <a href={row.movementsHref} className="text-[13px] underline">
          Ver movimientos<span className="sr-only"> de {row.label}</span>
        </a>
      </div>
      <label className="grid gap-0.5 text-[12px]">
        En mano
        <Input
          name="quantity"
          type="number"
          required
          min={0}
          max={1000000}
          defaultValue={state.values?.quantity ?? row.onHand}
          aria-label={`En mano de ${row.label}`}
          aria-invalid={state.fields?.quantity ? true : undefined}
          className="w-24"
        />
      </label>
      <label className="grid gap-0.5 text-[12px]">
        Motivo
        <Input
          name="reason"
          defaultValue={state.values?.reason ?? "Conteo físico"}
          aria-label={`Motivo del ajuste de ${row.label}`}
          aria-invalid={state.fields?.reason ? true : undefined}
          className="w-44"
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        {/* No «Guardar»: la ficha ya tiene ese botón para el producto. */}
        Fijar
        <span className="sr-only"> existencias de {row.label}</span>
      </Button>
      <span aria-live="polite" className="basis-full text-[13px]">
        {state.error ? (
          <span role="alert" className="text-danger">
            {state.error} {Object.values(state.fields ?? {}).join(" ")}
          </span>
        ) : state.ok ? (
          <span role="status" className="text-success">
            {state.message}
          </span>
        ) : null}
      </span>
    </form>
  );
}
