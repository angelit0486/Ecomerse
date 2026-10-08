export const JOB_STATUS: Record<string, string> = {
  validating: "Validando",
  validated: "Validado, sin confirmar",
  committing: "Importando",
  completed: "Importado",
  failed: "Falló (no se cambió nada)",
  cancelled: "Cancelado",
  blocked: "Bloqueado",
};

export const MODE: Record<string, string> = {
  upsert: "Crear y actualizar",
  create_only: "Solo crear",
  update_existing: "Solo actualizar",
};

const PUBLISH_FAILURE = /^(Fila \d+: )?([Nn])o se puede publicar \(([a-z0-9_:,]+)\)$/;

/**
 * El error guardado por system.import_commit lleva los códigos de publicación
 * (§14.3 y cumplimiento, ADR-021) entre paréntesis: aquí se traducen.
 */
export function importErrorText(error: string, translate: (code: string) => string): string {
  const match = PUBLISH_FAILURE.exec(error);
  if (!match) return error;
  const issues = match[3]!.split(",").filter(Boolean).map(translate);
  return `${match[1] ?? ""}${match[2]}o se puede publicar. ${issues.join(" ")}`;
}
