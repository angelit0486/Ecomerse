"use client";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { moderateReview } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export function ModerateButtons({
  storeHandle,
  reviewId,
  status,
}: {
  storeHandle: string;
  reviewId: string;
  status: "pending" | "published" | "rejected";
}) {
  const [pubState, publish, publishing] = useSafeActionState<FormState>(
    moderateReview.bind(null, storeHandle, reviewId, "published"),
    {},
  );
  const [rejState, reject, rejecting] = useSafeActionState<FormState>(
    moderateReview.bind(null, storeHandle, reviewId, "rejected"),
    {},
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "published" ? (
        <form action={publish}>
          <Button type="submit" size="sm" loading={publishing}>
            Publicar
          </Button>
        </form>
      ) : null}
      {status !== "rejected" ? (
        <form action={reject}>
          <ConfirmButton
            size="sm"
            loading={rejecting}
            question={
              status === "published"
                ? "¿Retirar esta opinión de la tienda?"
                : "¿Rechazar esta opinión?"
            }
            detail="Puedes volver a publicarla después."
          >
            {status === "published" ? "Retirar" : "Rechazar"}
          </ConfirmButton>
        </form>
      ) : null}
      <FormFeedback state={pubState.error || pubState.ok ? pubState : rejState} />
    </div>
  );
}
