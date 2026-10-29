import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { RetryJobButton } from "../console-forms";

export const metadata = { title: "Trabajos fallidos" };

interface DeadJob {
  id: string;
  type: string;
  store_id: string | null;
  store_name: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  finished_at: string;
}

/** Nombres que entiende el equipo; el tipo técnico se muestra debajo. */
const TYPE_LABELS: Record<string, string> = {
  "media.process": "Procesar foto",
  "media.copy": "Copiar fotos",
  "media.fetch_remote": "Traer foto de un enlace",
  "media.backfill_variants": "Fotos en varios tamaños",
  "import.commit": "Importación de productos",
  "orders.expire": "Vencer reservas",
  "orders.complete": "Completar pedidos",
  "carts.recover": "Recordatorios de carrito",
  "payments.reconcile": "Conciliar pagos",
  "refund.execute": "Reembolso",
  "order.created": "Correo: pedido recibido",
  "order.paid": "Correo: pedido pagado",
  "order.shipped": "Correo: pedido enviado",
  "order.delivered": "Correo: pedido entregado",
  "order.cancelled": "Correo: pedido cancelado",
  "refund.succeeded": "Correo: reembolso",
  "payment.failed": "Correo: pago fallido",
  "payment.external_reversal": "Correo: contracargo o reembolso externo",
  "access.invitation_email": "Correo: invitación al equipo",
  "domains.verify": "Verificar dominio",
  "catalog.publish_scheduled": "Publicación programada",
  "catalog.apply_sales": "Ofertas con fecha",
};

// La consola es de la plataforma: horas en la zona de la operación (México).
const when = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});

/**
 * Trabajos de la cola que agotaron sus intentos (paso 17). Soporte los ve;
 * dueño y administración los reintentan. Nunca se muestra el contenido del
 * trabajo, solo su tipo, la tienda y el último error.
 */
export default async function DeadJobsPage() {
  const role = await requirePlatformRole();
  const supabase = await createSupabaseServerClient();
  const jobs = await callRpc<DeadJob[]>(supabase, "platform_list_dead_jobs", { p_limit: 100 });
  const canRetry = canManageTenants(role);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Trabajos fallidos</h1>
        <p className="text-sm text-fg-muted">
          Tareas en segundo plano (correos, fotos, importaciones, pagos) que fallaron todas las
          veces que se intentaron. Corrige la causa y vuelve a intentarlas.
        </p>
      </header>
      {jobs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-sm text-fg-muted">
          No hay trabajos fallidos. Todo lo que entra a la cola se está procesando.
        </p>
      ) : (
        <Table caption="Trabajos fallidos" captionHidden>
          <THead>
            <TR>
              <TH>Trabajo</TH>
              <TH>Tienda</TH>
              <TH>Falló</TH>
              <TH>Último error</TH>
              {canRetry ? <TH>Acción</TH> : null}
            </TR>
          </THead>
          <TBody>
            {jobs.map((job) => (
              <TR key={job.id}>
                <TD>
                  <span className="block font-medium">{TYPE_LABELS[job.type] ?? job.type}</span>
                  <span className="block text-[12px] text-fg-muted">
                    {job.type} · {job.attempts} de {job.max_attempts} intentos
                  </span>
                </TD>
                <TD>{job.store_name ?? "Plataforma"}</TD>
                <TD className="whitespace-nowrap">{when.format(new Date(job.finished_at))}</TD>
                <TD className="max-w-sm break-words text-[13px]">{job.last_error ?? "—"}</TD>
                {canRetry ? (
                  <TD>
                    <RetryJobButton jobId={job.id} />
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
