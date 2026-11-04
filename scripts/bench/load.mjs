// Banco de carga del checkout (docs/audit/escalabilidad-2026-11.md). SOLO LOCAL.
// Compradores simultáneos con el rol storefront_gateway contra pruva_bench.
// Uso: node scripts/bench/load.mjs <compradores> <segundos> <distinct|hot>
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const [workers, seconds, mode] = [
  Number(process.argv[2]),
  Number(process.argv[3]),
  process.argv[4],
];
const admin = postgres("postgres://postgres:postgres@localhost:5432/pruva_bench", {
  max: 1,
  onnotice: () => {},
});
const [store] =
  await admin`select id from public.stores s where exists (select 1 from public.product_variants v where v.store_id = s.id and v.sku = 'CARGA-1')`;
const variants = (
  await admin`select id from public.product_variants where sku like 'CARGA-%' order by sku`
).map((r) => r.id);
const [acct] =
  await admin`select id from public.payment_accounts where store_id = ${store.id} and provider = 'manual'`;
await admin.end();
const gw = postgres(
  "postgres://storefront_gateway:storefront_gateway_dev_password@localhost:5432/pruva_bench",
  {
    max: workers,
    prepare: false,
    onnotice: () => {},
  },
);
let ok = 0;
const errors = {};
const lat = [];
const end = Date.now() + seconds * 1000;
async function buyer(w) {
  while (Date.now() < end) {
    const t0 = performance.now();
    const token = randomBytes(32).toString("base64url");
    const variant = mode === "hot" ? variants[0] : variants[w % variants.length];
    const idem = `load-${randomBytes(12).toString("hex")}`;
    try {
      await gw`select storefront.cart_add_item(${store.id}, ${token}, ${variant}, 1)`;
      await gw`select storefront.place_order(${store.id}, ${token}, ${gw.json({ email: `c${w}-${randomBytes(4).toString("hex")}@example.test`, customer_name: "Carga", payment_account_id: acct.id })}, 25000, ${idem}, ${createHash("sha256").update(idem).digest()})`;
      ok += 1;
      lat.push(performance.now() - t0);
    } catch (e) {
      errors[e.message] = (errors[e.message] ?? 0) + 1;
    }
  }
}
await Promise.all(Array.from({ length: workers }, (_, w) => buyer(w)));
await gw.end();
lat.sort((a, b) => a - b);
const pct = (p) =>
  lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))].toFixed(1) : "-";
console.log(
  JSON.stringify({
    modo: mode,
    compradores: workers,
    pedidos: ok,
    por_minuto: Math.round((ok * 60) / seconds),
    p50_ms: pct(0.5),
    p95_ms: pct(0.95),
    errores: errors,
  }),
);
