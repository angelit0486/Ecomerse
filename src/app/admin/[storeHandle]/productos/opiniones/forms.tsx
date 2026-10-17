"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { moderateReview } from "./actions";

export function ModerateButtons({
  storeHandle,
  reviewId,
  status,
}: {
  storeHandle: string;
  reviewId: string;
  status: "pending" | "published" | "rejected";
}) {
  const [pubState, publish, publishing] = useActionState<FormState>(
    moderateReview.bind(null, storeHandle, reviewId, "published"),
    {},
  );
  const [rejState, reject, rejecting] = useActionState<FormState>(
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
          <Button type="submit" size="sm" variant="secondary" loading={rejecting}>
            {status === "published" ? "Retirar" : "Rechazar"}
          </Button>
        </form>
      ) : null}
      <FormFeedback state={pubState.error || pubState.ok ? pubState : rejState} />
    </div>
  );
}
