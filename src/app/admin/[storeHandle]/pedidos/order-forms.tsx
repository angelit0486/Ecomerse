"use client";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import {
  cancelOrder,
  closeUnshipped,
  resolveAttention,
  confirmManualPayment,
  fulfillOrder,
  markDelivered,
  requestRefund,
  saveStaffNote,
} from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export function ConfirmPaymentForm({
  storeHandle,
  orderId,
}: {
  storeHandle: string;
  orderId: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    confirmManualPayment.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Referencia del pago (opcional)
        <input
          name="note"
          maxLength={200}
          className="h-11 md:h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" loading={pending}>
          Confirmar pago recibido
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function StaffNoteForm({
  storeHandle,
  orderId,
  note,
}: {
  storeHandle: string;
  orderId: string;
  note: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveStaffNote.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nota interna
        <textarea
          name="staff_note"
          defaultValue={note}
          maxLength={4000}
          rows={3}
          className="rounded-[var(--radius-control)] border border-control bg-surface p-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Guardar nota
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

const inputClass =
  "h-11 md:h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm";

export interface FulfillLine {
  id: string;
  label: string;
  pending: number;
}

/** Sugerencias para escribir menos en el celular (C1); se puede escribir otra. */
const MX_CARRIERS = [
  "Estafeta",
  "DHL",
  "FedEx",
  "Paquetexpress",
  "Redpack",
  "J&T Express",
  "99minutos",
  "Correos de México",
  "Entrega local",
] as const;

export function FulfillForm({
  storeHandle,
  orderId,
  lines,
  idempotencyKey,
}: {
  storeHandle: string;
  orderId: string;
  lines: FulfillLine[];
  idempotencyKey: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    fulfillOrder.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Unidades que envías</legend>
        {lines.map((l) => (
          <label key={l.id} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {l.label} <span className="text-fg-muted">(pendientes: {l.pending})</span>
            </span>
            <input
              name={`qty_${l.id}`}
              type="number"
              min={0}
              max={l.pending}
              defaultValue={state.values?.[`qty_${l.id}`] ?? l.pending}
              aria-label={`Unidades de ${l.label}`}
              className={`${inputClass} w-20`}
            />
          </label>
        ))}
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Paquetería (opcional)
          <input
            name="carrier"
            maxLength={80}
            list={`carriers-${orderId}`}
            autoComplete="off"
            defaultValue={state.values?.carrier}
            className={inputClass}
          />
          <datalist id={`carriers-${orderId}`}>
            {MX_CARRIERS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Número de guía (opcional)
          <input
            name="tracking_number"
            maxLength={60}
            defaultValue={state.values?.tracking_number}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Enlace de rastreo (opcional)
          <input
            name="tracking_url"
            type="url"
            maxLength={500}
            defaultValue={state.values?.tracking_url}
            aria-invalid={state.fields?.tracking_url ? true : undefined}
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" loading={pending}>
          Registrar envío
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function DeliveredButton({
  storeHandle,
  orderId,
  shipmentId,
}: {
  storeHandle: string;
  orderId: string;
  shipmentId: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState>(
    markDelivered.bind(null, storeHandle, orderId, shipmentId),
    {},
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Marcar entregado
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}

export function CancelForm({
  storeHandle,
  orderId,
  idempotencyKey,
  willRefund,
}: {
  storeHandle: string;
  orderId: string;
  idempotencyKey: string;
  willRefund: boolean;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    cancelOrder.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo
        <select
          name="reason"
          defaultValue={state.values?.reason ?? "customer"}
          className={inputClass}
        >
          <option value="customer">Lo pidió el cliente</option>
          <option value="out_of_stock">Sin existencias</option>
          <option value="fraud">Sospecha de fraude</option>
          <option value="staff">Decisión de la tienda</option>
          <option value="other">Otro</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nota (opcional)
        <input
          name="note"
          maxLength={500}
          defaultValue={state.values?.note}
          className={inputClass}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="confirm"
          value="1"
          defaultChecked={state.values?.confirm === "1"}
        />
        {willRefund
          ? "Entiendo que se cancelará y se reembolsará todo lo cobrado"
          : "Entiendo que el pedido se cancelará"}
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="danger" loading={pending}>
          Cancelar pedido
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export interface ReturnLine {
  id: string;
  label: string;
  shipped: number;
}

export function RefundForm({
  storeHandle,
  orderId,
  idempotencyKey,
  maxAmount,
  maxLabel,
  lines,
}: {
  storeHandle: string;
  orderId: string;
  idempotencyKey: string;
  maxAmount: string;
  maxLabel: string;
  lines: ReturnLine[];
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    requestRefund.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Monto a reembolsar (máximo {maxLabel})
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={state.values?.amount ?? maxAmount}
          aria-invalid={state.fields?.amount ? true : undefined}
          className={`${inputClass} w-40`}
        />
      </label>
      {lines.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Unidades devueltas (opcional)</legend>
          {lines.map((l) => (
            <label key={l.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {l.label} <span className="text-fg-muted">(enviadas: {l.shipped})</span>
              </span>
              <input
                name={`ret_${l.id}`}
                type="number"
                min={0}
                max={l.shipped}
                defaultValue={state.values?.[`ret_${l.id}`] ?? 0}
                aria-label={`Unidades devueltas de ${l.label}`}
                className={`${inputClass} w-20`}
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="restock"
              value="1"
              defaultChecked={state.values?.restock === "1"}
            />
            Regresar las unidades devueltas al inventario
          </label>
        </fieldset>
      ) : null}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Motivo (opcional)
        <input
          name="reason"
          maxLength={500}
          defaultValue={state.values?.reason}
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-3">
        <ConfirmButton
          size="sm"
          loading={pending}
          question="¿Solicitar el reembolso por el monto indicado?"
          detail="Si se pagó con tarjeta o Mercado Pago, el reembolso se envía al procesador de pagos y no se puede deshacer."
        >
          Solicitar reembolso
        </ConfirmButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function CloseUnshippedForm({
  storeHandle,
  orderId,
  idempotencyKey,
  canRefund,
}: {
  storeHandle: string;
  orderId: string;
  idempotencyKey: string;
  canRefund: boolean;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    closeUnshipped.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nota (opcional)
        <input
          name="note"
          maxLength={500}
          defaultValue={state.values?.note}
          className={inputClass}
        />
      </label>
      {canRefund ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="refund"
            value="1"
            defaultChecked={state.values ? state.values.refund === "1" : true}
          />
          Reembolsar el importe de esas unidades (sin el envío)
        </label>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="confirm"
          value="1"
          defaultChecked={state.values?.confirm === "1"}
        />
        Entiendo que las unidades pendientes ya no se enviarán
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Cerrar unidades no enviadas
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function ResolveAttentionForm({
  storeHandle,
  orderId,
}: {
  storeHandle: string;
  orderId: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    resolveAttention.bind(null, storeHandle, orderId),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Qué hiciste para resolverlo
        <input
          name="note"
          maxLength={1000}
          defaultValue={state.values?.note}
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Marcar como resuelto
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
