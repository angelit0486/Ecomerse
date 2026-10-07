"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/ui/primitives/button";

export function CommitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? "Importando…" : label}
    </Button>
  );
}
