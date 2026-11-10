import { createCatalogHandlers } from "@/server/catalog/handlers";
import { createComplianceHandlers } from "@/server/compliance/handlers";
import { createDomainHandlers } from "@/server/domains/handlers";
import {
  dnsTxtLookup,
  notConfiguredProvider,
  vercelDomainProvider,
} from "@/server/domains/provider";
import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { log } from "@/server/observability/logger";
import { createMediaHandlers } from "@/server/media/handlers";
import { createImportHandlers } from "@/server/imports/handlers";
import { createCartRecoveryHandlers } from "@/server/notifications/cart-recovery";
import { createWeeklySummaryHandlers } from "@/server/notifications/weekly-summary";
import { emailChannel } from "@/server/notifications/channel";
import { createNotificationHandlers } from "@/server/notifications/handlers";
import { createOrderNotificationHandlers } from "@/server/notifications/order-handlers";
import { createOrderHandlers } from "@/server/orders/handlers";
import { createRefundHandlers } from "@/server/orders/refunds";
import { refreshDueAccounts, resealCredentials } from "@/server/payments/mercadopago-credentials";
import {
  mercadoPagoCredentialDeps,
  mercadoPagoProvider,
  stripeProvider,
} from "@/server/payments/registry";
import { createRetentionHandlers } from "@/server/maintenance/retention";
import { createHealthHandlers } from "@/server/platform/health-handlers";
import { createStorageAdmin } from "@/server/privileged/storage-admin";
import { createPurgeHandlers } from "@/server/privacy/purge-anonymized";
import { invalidateStore } from "@/server/storefront/cache";
import { storeOrigin } from "@/server/storefront/seo";

import type { JobHandler, JobRegistry } from "./types";

/**
 * Registro de handlers por tipo de job. Cada módulo registra aquí sus handlers en
 * la fase que los introduce; un tipo sin handler termina en `dead` con
 * `unknown_job_type`. Las dependencias se resuelven al ejecutar, no al importar.
 */
function lazy(type: string, build: () => Array<[string, JobHandler]>): JobHandler {
  return async (job, context) => {
    await new Map(build()).get(type)!(job, context);
  };
}

const notifications = () =>
  createNotificationHandlers({
    db: workerDb(),
    channel: emailChannel(),
    appUrl: serverEnv().APP_URL,
  });
const media = () =>
  createMediaHandlers({
    db: workerDb(),
    storage: createStorageAdmin(),
    onPublished: invalidateStore,
  });

const orderNotifications = () => {
  const env = serverEnv();
  return createOrderNotificationHandlers({
    db: workerDb(),
    channel: emailChannel(),
    linkSecret: env.ORDER_LINK_SECRET,
    storeOrigin: (hostname) => storeOrigin({ primary_hostname: hostname, handle: hostname }),
    mediaUrl: (path) =>
      `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/store-media/${path}`,
    appUrl: env.APP_URL,
  });
};

// ADR-048: recordatorio de carritos dejados.
const cartRecovery = () =>
  createCartRecoveryHandlers({
    db: workerDb(),
    channel: emailChannel(),
    linkSecret: serverEnv().ORDER_LINK_SECRET,
    storeOrigin: ({ hostname, handle }) => storeOrigin({ primary_hostname: hostname, handle }),
    appUrl: serverEnv().APP_URL,
  });

// Auditoría global, paso 19: resumen semanal a la dueña (interruptor weekly_summary).
const weeklySummary = () =>
  createWeeklySummaryHandlers({
    db: workerDb(),
    channel: emailChannel(),
    appUrl: serverEnv().APP_URL,
  });

const orders = () =>
  createOrderHandlers({ db: workerDb(), stripe: stripeProvider, mercadopago: mercadoPagoProvider });
const refunds = () =>
  createRefundHandlers({
    db: workerDb(),
    stripe: stripeProvider,
    mercadopago: mercadoPagoProvider,
  });
const imports = () => createImportHandlers({ db: workerDb(), onCommitted: invalidateStore });
const catalog = () => createCatalogHandlers({ db: workerDb(), onPublished: invalidateStore });
const compliance = () =>
  createComplianceHandlers({ db: workerDb(), onUnpublished: invalidateStore });

const domains = () => {
  const env = serverEnv();
  return createDomainHandlers({
    db: workerDb(),
    provider:
      env.VERCEL_DOMAINS_TOKEN && env.VERCEL_PROJECT_ID
        ? vercelDomainProvider({
            token: env.VERCEL_DOMAINS_TOKEN,
            projectId: env.VERCEL_PROJECT_ID,
            teamId: env.VERCEL_TEAM_ID,
            apiBase: env.VERCEL_API_BASE,
          })
        : notConfiguredProvider,
    txt: dnsTxtLookup,
  });
};

const handlers: Array<[string, JobHandler]> = [
  ["access.invitation_email", lazy("access.invitation_email", notifications)],
  ["access.support_access_notice", lazy("access.support_access_notice", notifications)],
  ["tenant.owner_notice", lazy("tenant.owner_notice", notifications)],
  ["media.process", lazy("media.process", media)],
  ["media.copy", lazy("media.copy", media)],
  ["media.fetch_remote", lazy("media.fetch_remote", media)],
  ["media.purge_orphans", lazy("media.purge_orphans", media)],
  // ADR-046, paso 2: archivos de tiendas anonimizadas (Storage Admin, SR-2). El
  // borrado de cuentas de compradores espera ADR-055 (amplía SR-1): sin deleteAuthUser no corre.
  [
    "privacy.purge_anonymized",
    lazy("privacy.purge_anonymized", () =>
      createPurgeHandlers(() => ({
        db: workerDb(),
        storage: createStorageAdmin(),
      })),
    ),
  ],
  ["media.backfill_variants", lazy("media.backfill_variants", media)],
  ["orders.expire", lazy("orders.expire", orders)],
  ["rate_limits.purge", lazy("rate_limits.purge", orders)],
  // ADR-060: limpieza diaria de datos vencidos (la base decide qué y cuándo).
  ["data.retention", lazy("data.retention", () => createRetentionHandlers({ db: workerDb() }))],
  ["payments.reconcile", lazy("payments.reconcile", orders)],
  [
    "platform.health_check",
    lazy("platform.health_check", () =>
      createHealthHandlers({
        db: workerDb(),
        channel: emailChannel(),
        appUrl: serverEnv().APP_URL,
      }),
    ),
  ],
  [
    "payments.mercadopago_refresh",
    // ADR-041: llaves de los comercios por vencer. Sin la clave de cifrado no hay nada que renovar.
    async () => {
      const deps = mercadoPagoCredentialDeps();
      if (!deps) return;
      // Rotación de la clave en curso: primero todo queda cifrado con la nueva.
      if (deps.previousKey)
        log.info("payments.credentials_resealed", { ...(await resealCredentials(deps)) });
      await refreshDueAccounts(deps);
    },
  ],
  ["payment.failed", lazy("payment.failed", orderNotifications)],
  ["payment.pending", lazy("payment.pending", orderNotifications)],
  ["payment.late_without_stock", lazy("payment.late_without_stock", orderNotifications)],
  ["orders.complete", lazy("orders.complete", orders)],
  ["order.shipped", lazy("order.shipped", orderNotifications)],
  ["order.delivered", lazy("order.delivered", orderNotifications)],
  ["order.cancelled", lazy("order.cancelled", orderNotifications)],
  ["refund.succeeded", lazy("refund.succeeded", orderNotifications)],
  ["refund.execute", lazy("refund.execute", refunds)],
  ["payment.expire_checkout", lazy("payment.expire_checkout", refunds)],
  ["payment.after_cancel", lazy("payment.after_cancel", orderNotifications)],
  ["payment.external_reversal", lazy("payment.external_reversal", orderNotifications)],
  // ADR-061: correos de devoluciones.
  ["return.requested", lazy("return.requested", orderNotifications)],
  ["return.approved", lazy("return.approved", orderNotifications)],
  ["return.rejected", lazy("return.rejected", orderNotifications)],
  ["order.created", lazy("order.created", orderNotifications)],
  ["order.paid", lazy("order.paid", orderNotifications)],
  // ADR-062: enlace nuevo del pedido de invitado.
  ["order.link_renewed", lazy("order.link_renewed", orderNotifications)],
  ["import.commit", lazy("import.commit", imports)],
  ["compliance.recheck", lazy("compliance.recheck", compliance)],
  ["catalog.publish_scheduled", lazy("catalog.publish_scheduled", catalog)],
  ["catalog.apply_sales", lazy("catalog.apply_sales", catalog)],
  ["domains.verify", lazy("domains.verify", domains)],
  // Dirección de la plataforma de una tienda nueva (2026-11-10).
  ["domains.attach_platform", lazy("domains.attach_platform", domains)],
  ["carts.recover", lazy("carts.recover", cartRecovery)],
  ["stores.weekly_summary", lazy("stores.weekly_summary", weeklySummary)],
];

export const jobRegistry: JobRegistry = new Map(handlers);
