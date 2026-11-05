"use client";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { closeReturn, decideReturn, receiveReturn, refundReturn, setReturnWindow } from "./actions";

const inputClass =
  "h-11 md:h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm";
const textareaClass =
  "min-h-20 rounded-[var(--radius-control)] border border-control bg-surface p-2 text-sm";

/** Aprobar (con instrucciones opcionales) o rechazar (con motivo obligatorio). */
export function DecideForms({ storeHandle, returnId }: { storeHandle: string; returnId: string }) {
  const [okState, approve, approving] = useSafeActionState<FormState, FormData>(
    decideReturn.bind(null, storeHandle, returnId, true),
    {},
  );
  const [noState, reject, rejecting] = useSafeActionState<FormState, FormData>(
    decideReturn.bind(null, storeHandle, returnId, false),
    {},
  );
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form action={approve} aria-label="Aprobar la devolución" className="space-y-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Instrucciones para el cliente (opcional)
          <textarea
            name="message"
            maxLength={1000}
            defaultValue={okState.values?.message}
            placeholder="Por ejemplo: envíala a Av. Juárez 10, Puebla, con tu número de pedido."
            className={textareaClass}
          />
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={approving}>
            Aprobar devolución
          </Button>
          <FormFeedback state={okState} />
        </div>
      </form>
      <form action={reject} aria-label="Rechazar la devolución" className="space-y-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Motivo del rechazo (el cliente lo recibe)
          <textarea
            name="message"
            maxLength={1000}
            defaultValue={noState.values?.message}
            aria-invalid={noState.fields?.message ? true : undefined}
            className={textareaClass}
          />
        </label>
        <div className="flex items-center gap-3">
          <ConfirmButton
            size="sm"
            loading={rejecting}
            question="¿Rechazar esta devolución?"
            detail="El cliente recibirá un correo con el motivo."
          >
            Rechazar devolución
          </ConfirmButton>
          <FormFeedback state={noState} />
        </div>
      </form>
    </div>
  );
}

export function ReceiveForm({ storeHandle, returnId }: { storeHandle: string; returnId: string }) {
  const [state, action, pending] = useSafeActionState<FormState>(
    receiveReturn.bind(null, storeHandle, returnId),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Registrar que llegó
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}

export function RefundReturnForm({
  storeHandle,
  returnId,
  idempotencyKey,
  suggested,
  maxLabel,
}: {
  storeHandle: string;
  returnId: string;
  idempotencyKey: string;
  suggested: string;
  maxLabel: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    refundReturn.bind(null, storeHandle, returnId),
    {},
  );
  return (
    <form action={action} aria-label="Reembolsar la devolución" className="space-y-3">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Monto a reembolsar (máximo {maxLabel})
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={state.values?.amount ?? suggested}
          aria-invalid={state.fields?.amount ? true : undefined}
          className={`${inputClass} w-40`}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="restock"
          value="1"
          defaultChecked={state.values ? state.values.restock === "1" : true}
        />
        Regresar las unidades al inventario
      </label>
      <div className="flex items-center gap-3">
        <ConfirmButton
          size="sm"
          loading={pending}
          question={(form) => {
            const amount = form ? String(new FormData(form).get("amount") ?? "").trim() : "";
            return `¿Reembolsar ${amount || "0"} por esta devolución?`;
          }}
          detail="Si se pagó con tarjeta o Mercado Pago, el reembolso se envía al procesador de pagos y no se puede deshacer."
        >
          Reembolsar
        </ConfirmButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function CloseReturnForm({
  storeHandle,
  returnId,
}: {
  storeHandle: string;
  returnId: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    closeReturn.bind(null, storeHandle, returnId),
    {},
  );
  return (
    <form action={action} aria-label="Cerrar sin reembolso" className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Cómo se resolvió</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="resolution"
            value="exchange"
            defaultChecked={(state.values?.resolution ?? "exchange") === "exchange"}
          />
          Cambio por otro producto
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="resolution"
            value="none"
            defaultChecked={state.values?.resolution === "none"}
          />
          Sin devolución de dinero
        </label>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Mensaje para el cliente (opcional)
        <textarea
          name="message"
          maxLength={1000}
          defaultValue={state.values?.message}
          className={textareaClass}
        />
      </label>
      <div className="flex items-center gap-3">
        <ConfirmButton
          size="sm"
          variant="secondary"
          loading={pending}
          question="¿Cerrar la devolución sin reembolso?"
          detail="Queda cerrada; para devolver dinero después usa el reembolso del pedido."
        >
          Cerrar sin reembolso
        </ConfirmButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function WindowForm({ storeHandle, days }: { storeHandle: string; days: number }) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    setReturnWindow.bind(null, storeHandle),
    {},
  );
  return (
    <form
      action={action}
      aria-label="Plazo para devolver"
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Días para pedir una devolución
        <input
          name="days"
          type="number"
          min={1}
          max={365}
          defaultValue={state.values?.days ?? days}
          aria-invalid={state.fields?.days ? true : undefined}
          className={`${inputClass} w-24`}
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Guardar plazo
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
