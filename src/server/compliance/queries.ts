import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SupplementSheet } from "@/server/catalog/regulatory";
import { callRpc } from "@/server/db/rpc";

/**
 * Lecturas del módulo regulatorio para el panel (ADR-021), con la sesión del
 * usuario: las RPC comprueban permisos. Nada se cachea entre requests (§44.7).
 */
export interface ComplianceLegend {
  key: string;
  label: string;
  text: string;
  placements: Array<"product_page" | "cart" | "checkout">;
}

export interface StoreLegendStatus {
  label: string;
  placements: Array<"product_page" | "cart" | "checkout">;
  /** Borrador sugerido por la plataforma (PENDIENTE DE REVISIÓN); nunca se publica. */
  suggested: string | null;
  draft: string | null;
  approved: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  updated_at: string | null;
}

export interface ComplianceCategoryStatus {
  key: string;
  name: string;
  declared: boolean;
  profile: {
    status: "pending" | "active" | "suspended";
    version: number;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_notes: string | null;
  };
  required_fields: string[];
  legends: ComplianceLegend[];
  /** Si las reglas piden la leyenda de la tienda (Fase A): borrador y texto aprobado. */
  store_legend: StoreLegendStatus | null;
  forbidden_terms: Array<{ key: string; label: string; term: string }>;
  products: number;
}

export interface ComplianceStatus {
  country: string;
  categories: ComplianceCategoryStatus[];
  unclassified_active: number;
}

export function getComplianceStatus(
  supabase: SupabaseClient,
  storeId: string,
): Promise<ComplianceStatus> {
  return callRpc<ComplianceStatus>(supabase, "compliance_store_status", { p_store_id: storeId });
}

export interface ComplianceReport {
  /** Productos (no archivados) que no se pueden publicar; `products` trae los primeros 500. */
  total: number;
  checked: number;
  products: Array<{ id: string; title: string; status: string; codes: string[] }>;
}

export function getComplianceReport(
  supabase: SupabaseClient,
  storeId: string,
): Promise<ComplianceReport> {
  return callRpc<ComplianceReport>(supabase, "compliance_store_report", { p_store_id: storeId });
}

export interface RegulatoryInfo {
  category_key: string | null;
  schema_version: number;
  data: SupplementSheet;
  updated_at: string;
}

export function getRegulatoryInfo(
  supabase: SupabaseClient,
  storeId: string,
  productId: string,
): Promise<RegulatoryInfo | null> {
  return callRpc<RegulatoryInfo | null>(supabase, "catalog_get_regulatory_info", {
    p_store_id: storeId,
    p_product_id: productId,
  });
}

export interface PlatformComplianceRule {
  id: string;
  kind: "required_field" | "required_legend" | "forbidden_term" | "store_legend";
  key: string;
  label: string;
  body: string | null;
  field_key: string | null;
  placements: string[];
  position: number;
  status: "active" | "retired";
}

export interface PlatformComplianceProfile {
  id: string;
  country: string;
  category_key: string;
  category_name: string;
  status: "pending" | "active" | "suspended";
  version: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  rules: PlatformComplianceRule[];
}

export function listPlatformCompliance(
  supabase: SupabaseClient,
): Promise<PlatformComplianceProfile[]> {
  return callRpc<PlatformComplianceProfile[]>(supabase, "platform_compliance_list");
}
