"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../_shared/action-state";
import { bulkFulfillOrders } from "./actions";

export interface OrderRow {
  id: string;
  number: string;
  href: string;
  placedAt: string;
  status: string;
  total: string;
}

/**
 * Listado de pedidos. En «Por surtir» se pueden elegir varios y surtirlos de una
 * vez (misión panel, F3); la base valida cada uno con su propia clave.
 */
export function OrdersTable({
  storeHandle,
  rows,
  selectable,
}: {
  storeHandle: string;
  rows: OrderRow[];
  selectable: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  // Una clave por intento: repetir el mismo clic no surte dos veces.
  const [batchKey, setBatchKey] = useState(() => crypto.randomUUID());
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function fulfill() {
    startTransition(async () => {
      const result = await bulkFulfillOrders(storeHandle, [...selected], batchKey).catch(() => ({
        error: "Se perdió la conexión. Inténtalo de nuevo.",
      }));
      setState(result);
      setConfirming(false);
      if ("ok" in result && result.ok) {
        setSelected(new Set());
        setBatchKey(crypto.randomUUID());
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {selectable && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
          <span>
            {selected.size === 1 ? "1 pedido elegido" : `${selected.size} pedidos elegidos`}
          </span>
          {confirming ? (
            <>
              <span className="text-fg-muted">
                Se marcan como enviadas todas sus unidades, sin número de guía. Si el correo de tu
                tienda está configurado, cada cliente recibe el aviso de envío.
              </span>
              <Button type="button" className="h-11" loading={pending} onClick={fulfill}>
                Sí, surtir {selected.size}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </Button>
            </>
          ) : (
            <Button type="button" className="h-11" onClick={() => setConfirming(true)}>
              Surtir los elegidos
            </Button>
          )}
        </div>
      ) : null}
      <div aria-live="polite">
        {state.ok ? (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
      </div>
      <div role="region" aria-label="Pedidos" tabIndex={0} className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Pedidos de la tienda</caption>
          <thead>
            <tr className="border-b border-border text-left">
              {selectable ? (
                <th scope="col" className="w-12 py-2 pr-2">
                  <input
                    type="checkbox"
                    aria-label="Elegir todos los pedidos de esta página"
                    checked={allSelected}
                    onChange={() => {
                      setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
                      setConfirming(false);
                    }}
                    className="size-5"
                  />
                </th>
              ) : null}
              <th scope="col" className="py-2 pr-3 font-medium">
                Pedido
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Fecha
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Estado
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-border">
                {selectable ? (
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`Elegir el pedido ${o.number}`}
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="size-5"
                    />
                  </td>
                ) : null}
                <td className="py-2 pr-3">
                  <Link href={o.href} className="inline-flex min-h-11 items-center underline">
                    {o.number}
                  </Link>
                </td>
                <td className="py-2 pr-3 tabular-nums">{o.placedAt}</td>
                <td className="py-2 pr-3">{o.status}</td>
                <td className="py-2 text-right">{o.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
