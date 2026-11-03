import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { purgeAnonymized } from "@/server/privacy/purge-anonymized";

/**
 * ADR-046, paso 2, contra PostgreSQL real (rol system_worker) con Storage y Auth
 * simulados: tras anonimizar una tienda se borran todos sus archivos (y nada de
 * otra tienda) y solo las cuentas de comprador que nadie más usa.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const run = Math.random().toString(36).slice(2, 8);

/** Storage simulado sobre storage.objects: borrar quita la fila, como Supabase. */
const removed: string[] = [];
const storage = {
  async remove(bucket: string, paths: string[]) {
    removed.push(...paths);
    await admin`delete from storage.objects where bucket_id = ${bucket} and name = any(${paths})`;
  },
};

async function store(tag: string) {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('purge_plan', 'purge_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country)
    values (${`Org ${tag}`}, ${`org-purge-${tag}-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status)
              values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, ${`Tienda ${tag}`}, ${`purge-${tag}-${run}`}, 'MXN', 'MX', 'America/Mexico_City')
    returning id`;
  return s!.id;
}

async function buyer(tag: string) {
  const [u] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), ${`${tag}-${run}@cliente.test`})
    returning id`;
  return u!.id;
}

describe("limpieza de tiendas anonimizadas", () => {
  let closed: string;
  let open: string;
  let onlyClosed: string;
  let both: string;

  beforeAll(async () => {
    closed = await store("cerrada");
    open = await store("abierta");
    onlyClosed = await buyer("solo");
    both = await buyer("ambas");
    await admin`insert into public.customers (store_id, email, user_id) values
      (${closed}, ${`solo-${run}@cliente.test`}, ${onlyClosed}),
      (${closed}, ${`ambas-${run}@cliente.test`}, ${both}),
      (${open}, ${`ambas-${run}@cliente.test`}, ${both})`;
    // 120 archivos: obliga a borrar en tandas de 100.
    for (let i = 0; i < 120; i += 1) {
      await admin`insert into storage.objects (bucket_id, name)
                  values ('store-media', ${`${closed}/products/foto-${i}.webp`})`;
    }
    await admin`insert into storage.objects (bucket_id, name) values
      ('store-uploads', ${`${closed}/uploads/pendiente.jpg`}),
      ('store-media', ${`${open}/products/foto.webp`})`;
    await admin`update public.stores set status = 'closed', closed_at = now() - interval '31 days'
                 where id = ${closed}`;
    await worker`select system.anonymize_closed_stores(50)`;
  });

  afterAll(async () => {
    await admin.end();
    await worker.end();
  });

  it("borra todos los archivos de la tienda anonimizada y ninguno de otra", async () => {
    const r = await purgeAnonymized({ db: worker, storage });
    expect(r.files).toBeGreaterThanOrEqual(121);
    expect(removed.every((p) => !p.startsWith(open))).toBe(true);
    const [left] = await admin<{ closed: number; open: number }[]>`
      select count(*) filter (where name like ${`${closed}/%`})::int as closed,
             count(*) filter (where name like ${`${open}/%`})::int as open
        from storage.objects`;
    expect(left).toEqual({ closed: 0, open: 1 });
    const [s] = await admin<{ purged: Date | null }[]>`
      select files_purged_at as purged from public.stores where id = ${closed}`;
    expect(s!.purged).not.toBeNull();
  });

  it("sin la aprobación de ADR-055 no borra cuentas: quedan en la cola", async () => {
    const [q] = await admin<{ n: number }[]>`
      select count(*)::int as n from system.auth_user_purge_queue where user_id = ${onlyClosed}`;
    expect(q!.n).toBe(1);
  });

  it("con el borrado de cuentas habilitado, solo borra la que nadie más usa", async () => {
    const deleted: string[] = [];
    const r = await purgeAnonymized({
      db: worker,
      storage,
      deleteAuthUser: async (id) => {
        deleted.push(id);
      },
    });
    expect(deleted).toContain(onlyClosed);
    expect(deleted).not.toContain(both);
    expect(r.accountErrors).toBe(0);
    // Repetir no vuelve a borrar nada.
    const again: string[] = [];
    await purgeAnonymized({
      db: worker,
      storage,
      deleteAuthUser: async (id) => {
        again.push(id);
      },
    });
    expect(again).not.toContain(onlyClosed);
  });
});
