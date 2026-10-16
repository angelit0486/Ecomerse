import "server-only";

/**
 * Adaptador de proveedor (ADR-025 §4). Las llamadas de red a un proveedor
 * correrían en jobs (`supplier.sync`, `supplier.order.submit`), nunca dentro de
 * una transacción (§44.10). La v1 solo trae el adaptador `manual`: no hay
 * integración que automatizar, así que no hay jobs encolados y ninguna pantalla
 * dice «sincronizado» o «enviado al proveedor» sin que la dueña lo registre.
 * Una integración real (con sus credenciales) se agrega como otro adaptador.
 */
export type SupplierAdapter = "manual";

export interface SupplierAvailabilityReport {
  supplierSku: string;
  availability: "available" | "limited" | "unavailable" | "unknown";
  quantity: number | null;
}

export interface SupplierOrderSubmission {
  supplierOrderId: string;
  orderNumber: string;
  items: { supplierSku: string | null; sku: string | null; quantity: number }[];
}

export type SupplierCapability = "availability" | "submit_order" | "order_status";

export interface SupplierProvider {
  readonly adapter: SupplierAdapter;
  /** Qué automatiza el adaptador; el panel muestra el paso manual para lo demás. */
  readonly capabilities: readonly SupplierCapability[];
  fetchAvailability(skus: string[]): Promise<SupplierAvailabilityReport[]>;
  submitOrder(order: SupplierOrderSubmission): Promise<{ externalReference: string }>;
  getOrderStatus(externalReference: string): Promise<{
    status: "requested" | "confirmed" | "shipped" | "delivered" | "failed";
    trackingNumber?: string;
    carrier?: string;
  }>;
}

export class ManualStepRequired extends Error {
  constructor(readonly step: SupplierCapability) {
    super(`manual_step_required:${step}`);
    this.name = "ManualStepRequired";
  }
}

/** Captura manual: no automatiza nada y lo dice con un error explícito. */
export const manualSupplierProvider: SupplierProvider = {
  adapter: "manual",
  capabilities: [],
  fetchAvailability: () => Promise.reject(new ManualStepRequired("availability")),
  submitOrder: () => Promise.reject(new ManualStepRequired("submit_order")),
  getOrderStatus: () => Promise.reject(new ManualStepRequired("order_status")),
};

export function getSupplierProvider(adapter: string): SupplierProvider {
  if (adapter === "manual") return manualSupplierProvider;
  throw new Error(`Adaptador de proveedor desconocido: ${adapter}`);
}
