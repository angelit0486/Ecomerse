// T05 (Orden 06): diez tiendas desiguales (una de N productos y nueve chicas)
// trabajando a la vez. Por tienda: una persona del panel (roles distintos, RLS
// activo) y la tienda en línea (rol storefront_gateway). Mide latencias por
// tienda, compara a las chicas con y sin la grande trabajando (vecino ruidoso)
// y verifica que nada cruza de una tienda a otra. SOLO LOCAL.
// Uso: node scripts/capacity/t05.mjs <base> <segundos por fase>
import { createHash } from "node:crypto";
import postgres from "postgres";

const db = process.argv[2] ?? "pruva_cap_t05";
const seconds = Number(process.argv[3] ?? 20);
if (!db.startsWith("pruva_cap")) throw new Error("Solo bases pruva_cap…");
const url = (user, pass) => `postgres://${user}:${pass}@localhost:5432/${db}`;
const admin = postgres(url("postgres", process.env.PGPASSWORD ?? "postgres"), {
  max: 2,
  onnotice: () => {},
});
const panel = postgres(url("postgres", process.env.PGPASSWORD ?? "postgres"), {
  max: 12,
  onnotice: () => {},
});
const gw = postgres(url("storefront_gateway", "storefront_gateway_dev_password"), {
  max: 12,
  prepare: false,
  onnotice: () => {},
});
const uuid = (key) => {
  const h = createHash("md5").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const ROLES = ["owner", "store_admin", "catalog_manager", "order_manager", "viewer"];
const CAN_EDIT = new Set(["owner", "store_admin", "catalog_manager"]);
const stores = Array.from({ length: 10 }, (_, i) => {
  const idx = i + 1;
  const role = ROLES[i % ROLES.length];
  return {
    idx,
    role,
    id: uuid(`pruva:${idx}:store`),
    user: uuid(role === "owner" ? `pruva:${idx}:owner` : `pruva:${idx}:user:${role}`),
    product: uuid(`pruva:${idx}:p:1`),
    seen: new Set(),
    lat: {},
  };
});
const sizes = Object.fromEntries(
  (await admin`select store_id, count(*)::int as n from public.products group by 1`).map((r) => [
    r.store_id,
    r.n,
  ]),
);
const counters = { ops: 0, denied_ok: 0, leaks: 0, errors: {} };

function asUser(user, fn) {
  return panel.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated", aal: "aal2" })}, true),
                     set_config('role', 'authenticated', true)`;
    return fn(sql);
  });
}
async function timed(store, op, fn) {
  const t0 = performance.now();
  try {
    const out = await fn();
    (store.lat[op] ??= []).push(performance.now() - t0);
    counters.ops += 1;
    return out;
  } catch (error) {
    const key = `${op}:${error.message}`;
    counters.errors[key] = (counters.errors[key] ?? 0) + 1;
    return null;
  }
}

async function panelLoop(store, other, until) {
  let i = 0;
  while (Date.now() < until) {
    i += 1;
    const rows = await timed(store, "panel.lista", () =>
      asUser(
        store.user,
        (sql) =>
          sql`select id from public.catalog_search_products(${store.id}, null, null, null, false, null, 26)`,
      ),
    );
    rows?.forEach((r) => store.seen.add(r.id));
    const found = await timed(store, "panel.buscar", () =>
      asUser(
        store.user,
        (sql) =>
          sql`select id from public.catalog_search_products(${store.id}, 'playera', null, null, false, null, 26)`,
      ),
    );
    found?.forEach((r) => store.seen.add(r.id));
    await timed(store, "panel.pedidos", () =>
      asUser(
        store.user,
        (sql) =>
          sql`select id from public.orders where store_id = ${store.id} order by placed_at desc, id desc limit 26`,
      ),
    );
    // Editar: quien puede, etiqueta un producto; quien no, debe recibir «forbidden».
    try {
      const t0 = performance.now();
      await asUser(
        store.user,
        (sql) =>
          sql`select public.catalog_bulk_tags(${store.id}, ${[store.product]}::uuid[], ${`t${i % 5}`}, 'add')`,
      );
      if (CAN_EDIT.has(store.role)) (store.lat["panel.editar"] ??= []).push(performance.now() - t0);
      else counters.leaks += 1; // un rol sin permiso logró editar
      counters.ops += 1;
    } catch (error) {
      if (!CAN_EDIT.has(store.role) && error.message === "forbidden") counters.denied_ok += 1;
      else
        counters.errors[`panel.editar:${error.message}`] =
          (counters.errors[`panel.editar:${error.message}`] ?? 0) + 1;
    }
    // Cruce: la misma persona pide el catálogo de OTRA tienda → siempre «forbidden».
    try {
      const got = await asUser(
        store.user,
        (sql) =>
          sql`select id from public.catalog_search_products(${other.id}, null, null, null, false, null, 5)`,
      );
      counters.leaks += got.length > 0 ? 1 : 0;
    } catch (error) {
      if (error.message === "forbidden") counters.denied_ok += 1;
      else
        counters.errors[`cruce:${error.message}`] =
          (counters.errors[`cruce:${error.message}`] ?? 0) + 1;
    }
    // Y lee las tablas sin filtro: RLS solo debe devolver lo suyo.
    const mine = await timed(store, "panel.tabla", () =>
      asUser(
        store.user,
        (sql) =>
          sql`select count(*)::int as n, count(distinct store_id)::int as s from public.products`,
      ),
    );
    if (mine && (mine[0].s > 1 || mine[0].n !== sizes[store.id])) counters.leaks += 1;
  }
}

async function shopLoop(store, until) {
  while (Date.now() < until) {
    const list = await timed(
      store,
      "tienda.lista",
      () => gw`select storefront.list_products(${store.id}) as r`,
    );
    list?.[0].r.items.forEach((x) => store.seen.add(x.id));
    const search = await timed(
      store,
      "tienda.buscar",
      () => gw`select storefront.list_products(${store.id}, null, null, 'mochila azul') as r`,
    );
    search?.[0].r.items.forEach((x) => store.seen.add(x.id));
    await timed(
      store,
      "tienda.disponibles",
      () => gw`select storefront.list_products(${store.id}, p_available => true) as r`,
    );
    await timed(
      store,
      "tienda.sugerencias",
      () => gw`select storefront.search_suggestions(${store.id}, 'ten') as r`,
    );
    await timed(
      store,
      "tienda.producto",
      () => gw`select storefront.get_product(${store.id}, 'p-1') as r`,
    );
  }
}

const pct = (xs, p) => {
  if (!xs?.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
};
async function phase(name, active) {
  for (const s of stores) s.lat = {};
  const until = Date.now() + seconds * 1000;
  await Promise.all(
    active.flatMap((s) => [panelLoop(s, stores[s.idx % stores.length], until), shopLoop(s, until)]),
  );
  const rows = active.map((s) => ({
    tienda: s.idx,
    productos: sizes[s.id],
    rol: s.role,
    ...Object.fromEntries(
      Object.entries(s.lat).flatMap(([op, xs]) => [
        [`${op} p50`, pct(xs, 0.5)],
        [`${op} p95`, pct(xs, 0.95)],
      ]),
    ),
    ops: Object.values(s.lat).reduce((a, xs) => a + xs.length, 0),
  }));
  console.log(`\n== ${name} (${seconds} s, ${active.length} tiendas)`);
  console.log(JSON.stringify(rows));
  return rows;
}

const small = stores.slice(1);
const a = await phase("A: solo las nueve chicas", small);
const b = await phase("B: las diez a la vez", stores);
const mean = (rows, key) => {
  const xs = rows
    .filter((r) => r.tienda !== 1)
    .map((r) => r[key])
    .filter((x) => x != null);
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
};
console.log("\n== Vecino ruidoso (tiendas chicas, promedio de p95 en ms): sola → con la grande");
for (const op of [
  "panel.lista",
  "panel.buscar",
  "panel.editar",
  "tienda.lista",
  "tienda.buscar",
  "tienda.disponibles",
  "tienda.sugerencias",
]) {
  console.log(`${op}: ${mean(a, `${op} p95`)} → ${mean(b, `${op} p95`)}`);
}
// Todo lo que cada tienda vio debe ser suyo.
let foreign = 0;
for (const s of stores) {
  const [row] =
    await admin`select count(*)::int as n from public.products where id = any(${[...s.seen]}::uuid[]) and store_id <> ${s.id}`;
  foreign += row.n;
}
console.log(
  `\n== Aislamiento: operaciones=${counters.ops} negadas_como_se_esperaba=${counters.denied_ok} fugas=${counters.leaks} ids_ajenos_vistos=${foreign}`,
);
console.log(`errores=${JSON.stringify(counters.errors)}`);
await Promise.all([admin.end(), panel.end(), gw.end()]);
process.exit(counters.leaks + foreign > 0 ? 1 : 0);
