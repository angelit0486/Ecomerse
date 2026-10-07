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
