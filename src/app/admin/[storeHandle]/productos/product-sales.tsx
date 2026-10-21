"use client";

import Link from "next/link";
import { startTransition, useState } from "react";

import { formatMoney } from "@/lib/money/format";
import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { cancelSaleAction, scheduleSaleAction, type CatalogActionState } from "./actions";
import { nativeControl } from "./styles";
import { useSafeActionState } from "@/ui/use-safe-action-state";

/** Fila de catalog_list_sales. */
export interface SaleRow {
  id: string;
  product_id: string;
  title: string;
  variant_id: string;
  signature: string;
  sku: string | null;
  current_price: number;
  sale_price: number;
  original_price: number | null;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "active" | "ended" | "cancelled";
  end_reason: string | null;
}

const STATUS: Record<SaleRow["status"], string> = {
  scheduled: "Programada",
  active: "Activa",
  ended: "Terminada",
  cancelled: "Cancelada",
};

/** Por qué terminó (solo los motivos que la dueña necesita saber). */
const END_REASONS: Record<string, string> = {
  price_changed: "Cambiaste el precio durante la oferta: se respetó tu precio.",
  not_lower: "No empezó: el precio ya era menor o igual al de oferta.",
  variant_removed: "La presentación ya no está a la venta.",
  not_started: "No empezó: la tienda no podía vender en esas fechas.",
};

/** «Tamaño=1 kg|Sabor=Vainilla» → «1 kg / Vainilla». */
export function signatureLabel(signature: string): string {
  if (!signature) return "Única";
  return signature
    .split("|")
    .map((kv) => kv.slice(kv.indexOf("=") + 1))
    .join(" / ");
}

function useWhen(timeZone: string) {
  const f = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone });
  return (iso: string) => f.format(new Date(iso));
}

function submitWith(action: (data: FormData) => void) {
  // onSubmit y no `action`: React reinicia el formulario tras cada acción y la
  // vista previa necesita los valores que se escribieron.
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => action(data));
  };
}

function Feedback({ state }: { state: CatalogActionState }) {
  return (
    <p aria-live="polite" className="text-[13px]">
      {state.error ? (
        <span role="alert" className="text-danger">
          {state.error} {Object.values(state.fields ?? {}).join(" ")}
        </span>
      ) : state.ok ? (
        <span role="status" className="text-success">
          {state.message}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Programar una oferta con fechas (ADR-030): precio fijo o descuento, para una
 * presentación o todas, en uno o varios productos. Primero se ve la vista
 * previa; «Programar» envía exactamente lo que se vio.
 */
export function ScheduleSaleForm({
  storeHandle,
  productIds,
  variants,
  currency,
  timeZone,
  timeZoneLabel,
}: {
  storeHandle: string;
  /** Productos de la oferta (uno en la ficha, la selección en bloque). */
  productIds: string[];
  /** Presentaciones elegibles (solo en la ficha de un producto). */
  variants?: { id: string; label: string }[];
  currency: string;
  timeZone: string;
  timeZoneLabel: string;
}) {
  const single = productIds.length === 1;
  // Controlados: se conservan entre la vista previa y «Programar».
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  // Si se edita el formulario, la vista previa deja de valer.
  const [edited, setEdited] = useState(false);
  const [state, action, pending] = useSafeActionState<CatalogActionState, FormData>(
    async (previous: CatalogActionState, formData: FormData) => {
      const result = await scheduleSaleAction(storeHandle, productIds, previous, formData);
      setEdited(false);
      return result;
    },
    {},
  );
  const preview = !edited ? state.salePreview : undefined;
  const blocked = preview?.rows.some((r) => r.issue) ?? false;
  const money = (cents: number) => formatMoney(cents, currency);
  const when = useWhen(timeZone);

  return (
    <div className="space-y-3">
      <form
        onSubmit={submitWith(action)}
        onChange={() => setEdited(true)}
        className="flex flex-wrap items-end gap-3"
      >
        {variants && variants.length > 1 ? (
          <label className="grid gap-0.5 text-[12px]">
            Presentación
            <select name="variant_id" defaultValue="" className={nativeControl}>
              <option value="">Todas las presentaciones</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <fieldset className="grid gap-0.5 text-[12px]">
          <legend className="mb-0.5">Tipo de oferta</legend>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                value="percent"
                checked={mode === "percent"}
                onChange={() => setMode("percent")}
              />
              Descuento %
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                value="fixed"
                checked={mode === "fixed"}
                onChange={() => setMode("fixed")}
              />
              Precio fijo
            </label>
          </div>
        </fieldset>
        {mode === "percent" ? (
          <>
            <label className="grid gap-0.5 text-[12px]">
              Descuento (%)
              <input
                name="percent"
                inputMode="decimal"
                placeholder="15"
                required
                aria-invalid={state.fields?.percent ? true : undefined}
                className={`${nativeControl} w-24`}
              />
            </label>
            <label className="grid gap-0.5 text-[12px]">
              Redondeo
              <select name="rounding" defaultValue="peso" className={nativeControl}>
                <option value="peso">Al peso</option>
                <option value="centavo">Al centavo</option>
              </select>
            </label>
          </>
        ) : (
          <label className="grid gap-0.5 text-[12px]">
            Precio de oferta
            <input
              name="sale_price"
              inputMode="decimal"
              placeholder="599.00"
              required
              aria-invalid={state.fields?.sale_price ? true : undefined}
              className={`${nativeControl} w-28`}
            />
          </label>
        )}
        <label className="grid gap-0.5 text-[12px]">
          Empieza (vacío = ahora)
          <input
            type="datetime-local"
            name="starts_at"
            aria-invalid={state.fields?.starts_at ? true : undefined}
            className={nativeControl}
          />
        </label>
        <label className="grid gap-0.5 text-[12px]">
          Termina
          <input
            type="datetime-local"
            name="ends_at"
            required
            aria-invalid={state.fields?.ends_at ? true : undefined}
            className={nativeControl}
          />
        </label>
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Ver vista previa
        </Button>
      </form>
      <p className="text-[12px] text-fg-muted">
        Hora de la tienda: {timeZoneLabel}. Máximo 90 días. Al empezar, el precio de antes se
        muestra tachado; al terminar regresa solo, salvo que lo cambies tú durante la oferta.
      </p>
      {preview ? (
        <section
          aria-label="Vista previa de la oferta"
          className="space-y-2 rounded border border-control p-3"
        >
          <p className="text-sm font-medium">
            Del {when(preview.starts_at)} al {when(preview.ends_at)}. Nada cambia hasta que
            programes.
          </p>
          <Table caption="Precios regulares y de oferta" captionHidden>
            <THead>
              <TR>
                <TH>{single ? "Presentación" : "Producto"}</TH>
                <TH>Precio regular</TH>
                <TH>Precio de oferta</TH>
              </TR>
            </THead>
            <TBody>
              {preview.rows.map((r) => (
                <TR key={r.variant_id}>
                  <TD>
                    {single ? signatureLabel(r.signature) : r.title}
                    {!single && r.signature ? (
                      <span className="block text-[13px] text-fg-muted">
                        {signatureLabel(r.signature)}
                      </span>
                    ) : null}
                  </TD>
                  <TD className="tabular-nums">{money(r.price)}</TD>
                  <TD className="tabular-nums">
                    {money(r.sale_price)}
                    {r.issue === "not_lower" ? (
                      <span className="block text-[13px] text-danger">
                        No queda más barato que el precio regular.
                      </span>
                    ) : r.issue === "overlap" ? (
                      <span className="block text-[13px] text-danger">
                        Ya tiene una oferta en esas fechas.
                      </span>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {blocked ? (
            <p className="text-sm text-danger">
              Corrige lo marcado (o elige otra presentación o fechas) y vuelve a ver la vista
              previa.
            </p>
          ) : (
            <form onSubmit={submitWith(action)}>
              {Object.entries(preview.params).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Button type="submit" name="confirm" value="1" size="sm" loading={pending}>
                Programar oferta
              </Button>
            </form>
          )}
        </section>
      ) : null}
      <Feedback state={state} />
    </div>
  );
}

function CancelSale({
  storeHandle,
  sale,
  onResult,
}: {
  storeHandle: string;
  sale: SaleRow;
  /** El aviso vive en la lista: al cancelar, esta fila pierde el botón. */
  onResult: (state: CatalogActionState) => void;
}) {
  const [, action, pending] = useSafeActionState<CatalogActionState, FormData>(
    async (previous: CatalogActionState, formData: FormData) => {
      const result = await cancelSaleAction(storeHandle, previous, formData);
      onResult(result);
      return result;
    },
    {},
  );
  return (
    <form onSubmit={submitWith(action)}>
      <input type="hidden" name="sale_id" value={sale.id} />
      <ConfirmButton
        size="sm"
        loading={pending}
        aria-label={`Cancelar la oferta de ${sale.title}`}
        question={`¿Cancelar la oferta de «${sale.title}»?`}
        confirmLabel="Sí, cancelar la oferta"
        detail="Si ya empezó, el precio regresa al de antes de la oferta."
      >
        Cancelar
      </ConfirmButton>
    </form>
  );
}

/** Ofertas programadas, activas y terminadas, con «Cancelar» en las abiertas. */
export function SalesList({
  storeHandle,
  sales,
  currency,
  timeZone,
  canEdit,
  showProduct,
}: {
  storeHandle: string;
  sales: SaleRow[];
  currency: string;
  timeZone: string;
  canEdit: boolean;
  /** En la página de ofertas de la tienda: el producto con su enlace. */
  showProduct?: boolean;
}) {
  const money = (cents: number) => formatMoney(cents, currency);
  const when = useWhen(timeZone);
  const [result, setResult] = useState<CatalogActionState>({});
  if (sales.length === 0) {
    return (
      <div className="space-y-1">
        <Feedback state={result} />
        <p className="text-sm text-fg-muted">No hay ofertas con fechas.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Feedback state={result} />
      <Table caption="Ofertas con fechas" captionHidden>
        <THead>
          <TR>
            <TH>{showProduct ? "Producto" : "Presentación"}</TH>
            <TH>Precio de oferta</TH>
            <TH>Fechas</TH>
            <TH>Estado</TH>
            {canEdit ? (
              <TH>
                <span className="sr-only">Acciones</span>
              </TH>
            ) : null}
          </TR>
        </THead>
        <TBody>
          {sales.map((s) => (
            <TR key={s.id}>
              <TD>
                {showProduct ? (
                  <Link
                    href={`/admin/${storeHandle}/productos/${s.product_id}`}
                    className="underline"
                  >
                    {s.title}
                  </Link>
                ) : (
                  signatureLabel(s.signature)
                )}
                {showProduct && s.signature ? (
                  <span className="block text-[13px] text-fg-muted">
                    {signatureLabel(s.signature)}
                  </span>
                ) : null}
              </TD>
              <TD className="tabular-nums">
                {money(s.sale_price)}
                <span className="block text-[13px] text-fg-muted">
                  Regular: {money(s.original_price ?? s.current_price)}
                </span>
              </TD>
              <TD className="text-[13px]">
                {when(s.starts_at)} – {when(s.ends_at)}
              </TD>
              <TD>
                {STATUS[s.status]}
                {s.end_reason && END_REASONS[s.end_reason] ? (
                  <span className="block text-[13px] text-fg-muted">
                    {END_REASONS[s.end_reason]}
                  </span>
                ) : null}
              </TD>
              {canEdit ? (
                <TD>
                  {s.status === "scheduled" || s.status === "active" ? (
                    <CancelSale storeHandle={storeHandle} sale={s} onResult={setResult} />
                  ) : null}
                </TD>
              ) : null}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
