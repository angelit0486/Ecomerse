import { pngIcon } from "@/server/storefront/icons";

export function GET(request: Request, ctx: { params: Promise<{ storeId: string }> }) {
  return pngIcon(request, ctx, 512);
}
