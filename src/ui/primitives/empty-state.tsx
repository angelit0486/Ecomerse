import { useId, type ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description: string;
  /** Acción principal (y opcionalmente una secundaria). */
  action?: ReactNode;
}

/** Estado vacío: qué es la sección, por qué está vacía y qué hacer (GATE0 §32.3). */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col items-start gap-2 rounded-[var(--radius-container)] border border-border bg-surface p-6"
    >
      <h2 id={titleId} className="text-base font-semibold text-fg">
        {title}
      </h2>
      <p className="max-w-prose text-fg-muted">{description}</p>
      {action ? <div className="mt-2 flex gap-2">{action}</div> : null}
    </section>
  );
}
