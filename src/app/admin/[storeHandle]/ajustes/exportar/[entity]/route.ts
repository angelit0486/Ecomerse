import { NextResponse, type NextRequest } from "next/server";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";
import { EXPORT_ENTITIES, exportCsv, type ExportEntity } from "@/server/exports/csv-export";

import { storeClient } from "../../../_shared/action-state";

/**
 * Descarga CSV (F8-T04a, §26.2). POST desde el formulario del panel: el origen
 * debe ser el del panel (además de SameSite=Lax) y los permisos los decide la
 * base (exports_rows). Sin caché.
 */
type Params = { params: Promise<{ storeHandle: string; entity: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { storeHandle, entity } = await params;
  const back = new URL(
    `/admin/${encodeURIComponent(storeHandle)}/ajustes/exportar`,
    serverEnv().APP_URL,
  );
  if (request.headers.get("origin") !== new URL(serverEnv().APP_URL).origin) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(EXPORT_ENTITIES as readonly string[]).includes(entity)) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const { supabase, storeId, ctx } = await storeClient(storeHandle);
    const data = await callRpc<{
      pii: boolean;
      rows: Record<string, unknown>[];
      regulated?: boolean;
      has_attributes?: boolean;
    }>(supabase, "exports_rows", {
      p_store_id: storeId,
      p_entity: entity,
    });
    const csv = exportCsv(entity as ExportEntity, data.rows, data.pii, {
      regulated: data.regulated ?? false,
      attributes: data.has_attributes ?? false,
    });
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${ctx.store.handle}-${entity}-${date}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const e = reportActionError("exports", error);
    back.searchParams.set("error", e.fields?.too_many_rows ? "muchas" : "permiso");
    return NextResponse.redirect(back, 303);
  }
}
