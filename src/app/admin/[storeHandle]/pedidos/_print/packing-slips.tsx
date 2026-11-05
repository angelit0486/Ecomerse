import type { PackingSlip } from "./load-slips";

/**
 * Notas de empaque: una por hoja al imprimir (`data-print-slip`), sin precios.
 * Al imprimir solo se ve `data-print-root` (globals.css, @media print).
 */
export function PackingSlips({
  storeName,
  slips,
  timeZone,
}: {
  storeName: string;
  slips: PackingSlip[];
  timeZone: string;
}) {
  const when = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone });
  return (
    <div data-print-root className="space-y-6">
      {slips.map((s) => (
        <article
          key={s.id}
          data-print-slip
          aria-label={`Nota de empaque del pedido ${s.number}`}
          className="space-y-4 rounded-lg border border-border bg-surface p-5 text-sm"
        >
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
            <div>
              <p className="text-base font-semibold">{storeName}</p>
              <p className="text-fg-muted">Nota de empaque</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">Pedido {s.number}</p>
              <p className="text-fg-muted">{when.format(new Date(s.placedAt))}</p>
            </div>
          </header>
          <section aria-label="Enviar a" className="space-y-1">
            <h2 className="font-semibold">Enviar a</h2>
            {s.contact ? (
              <>
                {(s.contact.address.length ? s.contact.address : [s.contact.name]).map((l) => (
                  <p key={l}>{l}</p>
                ))}
                {s.contact.phone ? <p>Tel. {s.contact.phone}</p> : null}
              </>
            ) : (
              <p className="text-fg-muted">
                Tu rol no permite ver los datos del cliente. Pide a la dueña que imprima la
                dirección.
              </p>
            )}
            {s.shippingName ? <p className="text-fg-muted">Envío: {s.shippingName}</p> : null}
          </section>
          <table className="w-full border-collapse">
            <caption className="sr-only">Productos del pedido {s.number}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Producto
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  SKU
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Cantidad
                </th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={`${l.sku ?? l.title}-${i}`} className="border-b border-border align-top">
                  <td className="py-1.5 pr-3">
                    {l.title}
                    {l.variant ? <span className="text-fg-muted"> · {l.variant}</span> : null}
                  </td>
                  <td className="py-1.5 pr-3">{l.sku ?? "—"}</td>
                  <td className="py-1.5 text-right text-base font-semibold">{l.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.lines.length === 0 ? <p>Todo lo de este pedido ya se envió.</p> : null}
          {s.contact?.note ? (
            <p>
              <span className="font-semibold">Nota del cliente:</span> {s.contact.note}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
