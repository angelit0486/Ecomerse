export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness: el proceso responde. Sin dependencias ni detalles internos. */
export function GET(): Response {
  return Response.json(
    { ok: true, data: { status: "ok" } },
    { headers: { "cache-control": "no-store" } },
  );
}
