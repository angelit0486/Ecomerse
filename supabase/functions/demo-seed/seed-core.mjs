// =============================================================================
// Núcleo de la siembra de demostración (F9-T05, F9-DESIGN §15 y §16; D-F9-15/17).
//
// Una sola fuente para dos entornos: el stack local (scripts/dev/demo-seed.mjs,
// Node) y la vista previa (la Edge Function demo-seed, Deno, que corre dentro
// de Supabase para que la clave de servicio nunca salga de allí). Este módulo
// no importa nada: recibe la conexión y las operaciones privilegiadas.
//
// Nada se presenta como real: los productos dicen "(ejemplo)", la barra de
// anuncio avisa que son datos de demostración, las marcas son ficticias, las
// imágenes son ilustraciones generadas y las reglas y leyendas sanitarias son
// de prueba ("pendiente de contenido real"). Sin reseñas, testimonios,
// certificaciones ni resultados.
// =============================================================================

// Mismos valores que src/lib/theme/presets.ts (este módulo no importa TypeScript).
export const STYLES = {
  anaquel: {
    colors: {
      primary: "#1d3fd1",
      accent: "#d62d20",
      background: "#ffffff",
      foreground: "#1a1c22",
      muted: "#5b616e",
    },
    typography: { heading: "montserrat", body: "inter" },
    shape: { radius: "md", button_style: "solid" },
  },
  neutral: {
    colors: {
      primary: "#1e3a5f",
      accent: "#b42318",
      background: "#ffffff",
      foreground: "#101828",
      muted: "#475467",
    },
    typography: { heading: "inter", body: "inter" },
    shape: { radius: "md", button_style: "solid" },
  },
};

// -----------------------------------------------------------------------------
// Imágenes de ejemplo: envases ilustrados sobre blanco (sin personas, sin sellos,
// sin claims), con la palabra EJEMPLO visible. Fondo blanco: en la tienda el
// anaquel gris lo absorbe (mix-blend-multiply).
// -----------------------------------------------------------------------------
function escapeXml(text) {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Mezcla un color hex con negro (f < 0) o blanco (f > 0). */
function shade(hex, f) {
  const n = Number.parseInt(hex.slice(1), 16);
  const target = f < 0 ? 0 : 255;
  const k = Math.abs(f);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Tamaño de letra para que `text` quepa en `width` (`em`: ancho medio de un carácter). */
function fit(text, width, max, em) {
  return Math.min(max, Math.floor(width / (Math.max(text.length, 1) * em)));
}

/** Etiqueta del envase: nombre en 1–2 renglones y EJEMPLO, centrada en (cx, top). */
function label({ cx, top, width, ink, line1, line2 }) {
  const size1 = fit(line1, width, 20, 0.78);
  const size2 = line2 ? fit(line2, width, 12, 0.62) : 0;
  return `
    <text x="${cx}" y="${top + size1 + 6}" text-anchor="middle" font-family="DejaVu Sans, sans-serif"
          font-weight="800" font-size="${size1}" fill="${ink}">${escapeXml(line1)}</text>
    ${
      line2
        ? `<text x="${cx}" y="${top + size1 + size2 + 12}" text-anchor="middle" font-family="DejaVu Sans, sans-serif"
          font-weight="600" font-size="${size2}" fill="${ink}" opacity=".85">${escapeXml(line2)}</text>`
        : ""
    }
    <text x="${cx}" y="${top + size1 + size2 + (line2 ? 30 : 22)}" text-anchor="middle" font-family="DejaVu Sans, sans-serif"
          font-weight="600" font-size="8.5" letter-spacing="1.6" fill="${ink}" opacity=".75">EJEMPLO</text>`;
}

function cylinder(id, body) {
  return `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${shade(body, -0.45)}"/><stop offset=".35" stop-color="${shade(body, 0.28)}"/>
      <stop offset=".6" stop-color="${body}"/><stop offset="1" stop-color="${shade(body, -0.45)}"/></linearGradient>`;
}

/** Un envase en el sistema de 200×220 (bote, bote alto, frasco o bolsa). */
function packShape({ shape, body, lid, labelBg, ink, line1, line2 }, id) {
  const shadow = `<ellipse cx="100" cy="206" rx="70" ry="9" fill="#000" opacity=".12"/>`;
  if (shape === "tub") {
    return `<defs>${cylinder(id, body)}</defs>${shadow}
      <rect x="34" y="62" width="132" height="142" rx="14" fill="url(#${id})"/>
      <rect x="30" y="36" width="140" height="34" rx="8" fill="${lid}"/>
      <rect x="30" y="62" width="140" height="6" fill="#000" opacity=".18"/>
      <rect x="34" y="96" width="132" height="80" fill="${labelBg}"/>
      ${label({ cx: 100, top: 100, width: 120, ink, line1, line2 })}`;
  }
  if (shape === "canister") {
    return `<defs>${cylinder(id, body)}</defs>${shadow}
      <rect x="56" y="48" width="88" height="156" rx="12" fill="url(#${id})"/>
      <rect x="52" y="26" width="96" height="28" rx="7" fill="${lid}"/>
      <rect x="52" y="48" width="96" height="5" fill="#000" opacity=".2"/>
      <rect x="56" y="90" width="88" height="80" fill="${labelBg}"/>
      ${label({ cx: 100, top: 94, width: 80, ink, line1, line2 })}`;
  }
  if (shape === "bottle") {
    return `<defs>${cylinder(id, body)}</defs>${shadow}
      <path d="M66 70 Q66 58 78 56 L122 56 Q134 58 134 70 L140 86 L140 196 Q140 204 132 204 L68 204 Q60 204 60 196 L60 86 Z" fill="url(#${id})"/>
      <rect x="74" y="28" width="52" height="30" rx="5" fill="${lid}"/>
      <rect x="60" y="102" width="80" height="76" fill="${labelBg}"/>
      ${label({ cx: 100, top: 106, width: 72, ink, line1, line2 })}`;
  }
  return `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${shade(body, -0.35)}"/>
      <stop offset=".4" stop-color="${shade(body, 0.3)}"/><stop offset="1" stop-color="${body}"/></linearGradient></defs>${shadow}
    <path d="M52 34 L148 34 L152 60 Q160 140 150 198 Q100 208 50 198 Q40 140 48 60 Z" fill="url(#${id})"/>
    <rect x="52" y="34" width="96" height="14" fill="#000" opacity=".14"/>
    <rect x="58" y="94" width="84" height="74" rx="6" fill="${labelBg}"/>
    ${label({ cx: 100, top: 98, width: 76, ink, line1, line2 })}`;
}

/** Renglones de la etiqueta: la primera palabra del nombre y el resto. */
function packLines(title) {
  const [first, ...rest] = title.replace(" (ejemplo)", "").split(" ");
  return { line1: first.toUpperCase(), line2: rest.join(" ") };
}

export function packSvg({ title, shape, pack }) {
  const { line1, line2 } = packLines(title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="#ffffff"/>
    <svg x="55" y="20" width="690" height="759" viewBox="0 0 200 220">
      ${packShape({ shape, ...pack, line1, line2 }, "g")}
    </svg>
  </svg>`;
}

/**
 * Imagen del hero: tres envases de ejemplo sobre fondo transparente, para que se
 * vean sobre el color de compra de cualquier tema. Centrados: el recorte de móvil
 * y el de escritorio los conservan.
 */
export function bannerSvg() {
  const item = (x, y, w, shape, pack, title, id, rotate) => `
    <svg x="${x}" y="${y}" width="${w}" height="${w * 1.1}" viewBox="0 0 200 220">
      <g transform="rotate(${rotate} 100 110)">${packShape({ shape, ...pack, ...packLines(title) }, id)}</g>
    </svg>`;
  // 16:9; los envases ocupan el centro (x 330–1270) para sobrevivir al recorte.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    ${item(330, 170, 600, "tub", PACKS.whey, "Proteína de suero", "b1", -4)}
    ${item(790, 40, 470, "canister", PACKS.crea, "Creatina monohidratada", "b2", 3)}
    ${item(1030, 380, 360, "bottle", PACKS.omega, "Omega 3", "b3", 6)}
  </svg>`;
}

/** Colores de cada envase de ejemplo. */
export const PACKS = {
  whey: { body: "#3a2418", lid: "#1a1a1a", labelBg: "#f4ead9", ink: "#2a1a10" },
  veg: { body: "#4f6b22", lid: "#1a1a1a", labelBg: "#f5f1e6", ink: "#33461a" },
  crea: { body: "#e9e9e6", lid: "#202020", labelBg: "#e3412b", ink: "#ffffff" },
  creaCaps: { body: "#202226", lid: "#e3412b", labelBg: "#ffffff", ink: "#202226" },
  pre: { body: "#6b1fb8", lid: "#111111", labelBg: "#c6f24e", ink: "#2a0a4d" },
  caf: { body: "#1a1c22", lid: "#f5c400", labelBg: "#f5c400", ink: "#1a1c22" },
  multi: { body: "#1e9e6a", lid: "#f7f7f7", labelBg: "#ffffff", ink: "#0f6e48" },
  magn: { body: "#dfe6f2", lid: "#2d6bea", labelBg: "#2d6bea", ink: "#ffffff" },
  elec: { body: "#13a3c9", labelBg: "#ffffff", ink: "#0b6f8a" },
  hidra: { body: "#f4c430", lid: "#ffffff", labelBg: "#ffffff", ink: "#7a5200" },
  omega: { body: "#f4c430", lid: "#ffffff", labelBg: "#ffffff", ink: "#7a5200" },
};

// -----------------------------------------------------------------------------
// Catálogo de ejemplo
// -----------------------------------------------------------------------------
export const BRANDS = ["Marca Ejemplo Norte", "Marca Ejemplo Sur", "Marca Ejemplo Centro"];
export const CATEGORIES = [
  "Proteínas",
  "Creatinas",
  "Pre-entrenos",
  "Vitaminas y minerales",
  "Hidratación",
];
export const GOALS = ["Energía", "Fuerza", "Recuperación", "Bienestar"];
export const FLAVORS = ["Vainilla", "Chocolate", "Limón", "Sin sabor"];

// [título, marca, categoría, objetivos, sabor, precio, precio antes, existencias,
//  porciones, envase, colores del envase (PACKS)]
export const PRODUCTS = [
  [
    "Proteína de suero (ejemplo)",
    0,
    0,
    ["Fuerza", "Recuperación"],
    "Vainilla",
    89900,
    104900,
    30,
    30,
    "tub",
    "whey",
  ],
  [
    "Proteína vegetal (ejemplo)",
    1,
    0,
    ["Recuperación", "Bienestar"],
    "Chocolate",
    79900,
    null,
    25,
    30,
    "tub",
    "veg",
  ],
  [
    "Creatina monohidratada (ejemplo)",
    2,
    1,
    ["Fuerza"],
    "Sin sabor",
    49900,
    59900,
    60,
    60,
    "canister",
    "crea",
  ],
  [
    "Creatina en cápsulas (ejemplo)",
    0,
    1,
    ["Fuerza"],
    "Sin sabor",
    54900,
    null,
    4,
    90,
    "bottle",
    "creaCaps",
  ],
  [
    "Pre-entreno cítrico (ejemplo)",
    1,
    2,
    ["Energía"],
    "Limón",
    69900,
    79900,
    18,
    30,
    "canister",
    "pre",
  ],
  [
    "Cafeína en tabletas (ejemplo)",
    2,
    2,
    ["Energía"],
    "Sin sabor",
    29900,
    null,
    40,
    100,
    "bottle",
    "caf",
  ],
  [
    "Multivitamínico diario (ejemplo)",
    0,
    3,
    ["Bienestar"],
    "Sin sabor",
    39900,
    null,
    50,
    60,
    "bottle",
    "multi",
  ],
  [
    "Magnesio (ejemplo)",
    1,
    3,
    ["Recuperación", "Bienestar"],
    "Sin sabor",
    34900,
    39900,
    22,
    60,
    "bottle",
    "magn",
  ],
  [
    "Electrolitos en polvo (ejemplo)",
    2,
    4,
    ["Energía", "Recuperación"],
    "Limón",
    24900,
    null,
    35,
    20,
    "pouch",
    "elec",
  ],
  [
    "Bebida de hidratación (ejemplo)",
    0,
    4,
    ["Bienestar"],
    "Limón",
    19900,
    null,
    0,
    1,
    "bottle",
    "hidra",
  ],
];

const productSvg = ([title, , , , , , , , , shape, pack]) =>
  packSvg({ title, shape, pack: PACKS[pack] });

/** Todas las ilustraciones de la siembra (para pre-renderizarlas fuera de Node). */
export function demoSvgs() {
  return [bannerSvg(), ...PRODUCTS.map(productSvg)];
}

export const LEGEND_TEXT =
  "Leyenda sanitaria de ejemplo: el texto oficial lo define el asesor regulatorio de la tienda (pendiente de contenido real).";

/** Ficha de ejemplo que cumple los campos que piden las reglas propuestas (Fase A). */
const EXAMPLE_SHEET = {
  ingredients: "Ingredientes de ejemplo (pendiente de contenido real).",
  usage: "Modo de uso de ejemplo (pendiente de contenido real).",
  warnings: "Advertencias de ejemplo (pendiente de contenido real).",
  net_content: "Contenido de ejemplo",
};
const DEMO_REVIEWER = "Demostración (sin revisión real)";

/**
 * Siembra la tienda `demo` (estilo «Anaquel») o `demo2` (`neutral`, estilo
 * «Neutral») publicada en `hostname`. Idempotente: si la tienda existe, solo
 * restaura las reglas de prueba y agrega el host.
 *
 * - `sql`: conexión postgres.js con privilegios de dueño del esquema.
 * - `createOwner(email)`: crea la cuenta de la dueña (Auth Admin) y devuelve su id.
 * - `putImage({ path, svg })`: guarda la ilustración en `store-media/<path>` como
 *   WebP y devuelve `{ bytes, width, height }`.
 */
export async function seedDemo({
  sql,
  neutral,
  hostname,
  createOwner,
  putImage,
  demoCompliance = false,
  log = () => {},
}) {
  const handle = neutral ? "demo2" : "demo";
  const ownerEmail = `${handle}@example.test`;
  const style = neutral ? STYLES.neutral : STYLES.anaquel;
  const productsToImage = [];
  const shared = {};

  async function uploadImage(storeId, ownerType, productId, svg, alt, position) {
    const id = crypto.randomUUID();
    const path = `${storeId}/${ownerType}/${productId ?? storeId}/${id}/original.webp`;
    const { bytes, width, height } = await putImage({ path, svg });
    // Igual que el resultado del pipeline de medios (§25.3): re-codificada y lista.
    await sql`
      insert into public.media (id, store_id, owner_type, product_id, status, storage_path, mime_type,
                                bytes, width, height, alt_text, position)
      values (${id}, ${storeId}, ${ownerType}, ${productId}, 'ready', ${path}, 'image/webp',
              ${bytes}, ${width}, ${height}, ${alt}, ${position})`;
    return id;
  }

  async function asOwner(ownerId, work) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
      await tx`set local role authenticated`;
      return work(tx);
    });
  }

  async function ownerUser() {
    const [existing] = await sql`select id from auth.users where email = ${ownerEmail}`;
    if (existing) return existing.id;
    return createOwner(ownerEmail);
  }

  /**
   * Solo en el stack local (`demoCompliance`): activa el perfil de México con un
   * revisor de DEMOSTRACIÓN para poder ver la tienda con productos publicados.
   * Nunca en la vista previa ni en producción: allí las reglas propuestas quedan
   * PENDIENTES DE REVISIÓN hasta que el asesor regulatorio las apruebe (Fase A).
   * Ya no crea reglas: usa las propuestas de la migración.
   */
  async function ensureDemoCompliance() {
    if (!demoCompliance) return;
    await sql`
      update public.compliance_profiles
         set status = 'active', reviewed_by = ${DEMO_REVIEWER}, reviewed_at = now(),
             review_notes = 'Solo stack local: reglas propuestas activadas para la demostración, sin revisión real.'
       where country = 'MX' and category_key = 'dietary_supplement' and status <> 'active'`;
  }

  /** Leyenda de la tienda de ejemplo, aprobada como demostración (solo local). */
  async function ensureDemoLegend(storeId, ownerId) {
    if (!demoCompliance) return;
    await asOwner(
      ownerId,
      (tx) =>
        tx`select public.compliance_save_store_legend(${storeId}, 'dietary_supplement', ${LEGEND_TEXT}, true, ${DEMO_REVIEWER})`,
    );
  }

  /**
   * Si la ilustración del hero cambió, la sube y la pone en la portada publicada
   * (y en el borrador, si hay). Idempotente: el sha256 del SVG va en la ruta.
   */
  async function refreshBanner(storeId) {
    const svg = bannerSvg();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(svg));
    const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
    const [current] = await sql`
      select m.storage_path from public.store_themes t
        join lateral jsonb_array_elements(t.home_sections) e on e ->> 'type' = 'hero'
        join public.media m on m.store_id = t.store_id and m.id::text = e #>> '{props,image_media_id}'
       where t.store_id = ${storeId} limit 1`;
    if (!current || current.storage_path.includes(`/${key}-`)) return;
    const id = crypto.randomUUID();
    const path = `${storeId}/banner/${storeId}/${key}-${id}/original.webp`;
    const { bytes, width, height } = await putImage({ path, svg });
    await sql`
      insert into public.media (id, store_id, owner_type, status, storage_path, mime_type, bytes, width, height, alt_text, position)
      values (${id}, ${storeId}, 'banner', 'ready', ${path}, 'image/webp', ${bytes}, ${width}, ${height}, '', 0)`;
    const swap = (column) => sql`
      update public.store_themes t
         set ${sql(column)} = (
           select jsonb_agg(case when e ->> 'type' = 'hero'
                                 then jsonb_set(e, '{props,image_media_id}', to_jsonb(${id}::text))
                                 else e end order by n)
             from jsonb_array_elements(t.${sql(column)}) with ordinality x(e, n))
       where t.store_id = ${storeId} and jsonb_typeof(t.${sql(column)}) = 'array'
         and jsonb_array_length(t.${sql(column)}) > 0`;
    await swap("home_sections");
    await swap("draft_home_sections");
    log("✓ Banner del hero actualizado");
  }

  const [already] = await sql`select id from public.stores where handle = ${handle}`;
  if (already) {
    // Local: los E2E de cumplimiento cambian el perfil de México; se reactiva y la
    // ficha de ejemplo se completa con los campos que piden las reglas propuestas.
    await ensureDemoCompliance();
    if (demoCompliance) {
      await sql`
        update public.product_regulatory_info
           set data = ${sql.json(EXAMPLE_SHEET)}::jsonb || data
         where store_id = ${already.id} and category_key = 'dietary_supplement'`;
      await ensureDemoLegend(already.id, await ownerUser());
    }
    await refreshBanner(already.id);
    await sql`insert into public.store_domains (store_id, hostname, type, status, is_primary)
              values (${already.id}, ${hostname}, 'platform_subdomain', 'active', false)
              on conflict do nothing`;
    log(`✓ La tienda de demostración ya existe: ${hostname}`);
    return { storeId: already.id, handle, created: false };
  }
  const ownerId = await ownerUser();

  // Tenant con un plan holgado (solo demostración).
  const [plan] = await sql`
    insert into public.plans (key, name) values ('demo_plan', 'Plan de demostración')
    on conflict (key) do update set name = excluded.name returning id`;
  await sql`insert into public.plan_entitlements (plan_id, key, value_int)
            values (${plan.id}, 'max_stores', 3), (${plan.id}, 'max_staff', 10),
                   (${plan.id}, 'max_products', 1000), (${plan.id}, 'storage_mb', 2000)
            on conflict do nothing`;
  const [org] = await sql`
    insert into public.organizations (name, slug, country)
    values (${`Organización ${handle}`}, ${`org-${handle}`}, 'MX') returning id`;
  await sql`insert into public.subscriptions (organization_id, plan_id, status) values (${org.id}, ${plan.id}, 'active')`;
  await sql`insert into public.organization_members (organization_id, user_id, role) values (${org.id}, ${ownerId}, 'org_owner')`;
  const [store] = await sql`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at)
    values (${org.id}, ${neutral ? "Tienda de demostración 2" : "Tienda de demostración"}, ${handle}, 'MXN', 'MX', 'America/Mexico_City', 'active', now())
    returning id`;
  const storeId = store.id;
  await sql`insert into public.store_domains (store_id, hostname, type, status, is_primary)
            values (${storeId}, ${hostname}, 'platform_subdomain', 'active', true)`;
  await sql`insert into public.store_themes (store_id) values (${storeId})`;

  await ensureDemoCompliance();

  const brandIds = [];
  for (const name of BRANDS) {
    const [b] = await sql`
      insert into public.brands (store_id, name, slug)
      values (${storeId}, ${name}, ${name.toLowerCase().replaceAll(" ", "-")}) returning id`;
    brandIds.push(b.id);
  }

  const banner = await uploadImage(storeId, "banner", null, bannerSvg(), "", 0);
  // (Las siguientes siembras reemplazan el banner con refreshBanner si cambia.)

  await asOwner(
    ownerId,
    (tx) => tx`select public.compliance_set_store_category(${storeId}, 'dietary_supplement', true)`,
  );
  await ensureDemoLegend(storeId, ownerId);

  await asOwner(ownerId, async (tx) => {
    const goal =
      await tx`select public.catalog_save_attribute(${storeId}, ${tx.json({ name: "Objetivo", values: GOALS.map((label) => ({ label })) })}) as id`;
    const flavor =
      await tx`select public.catalog_save_attribute(${storeId}, ${tx.json({ name: "Sabor", values: FLAVORS.map((label) => ({ label })) })}) as id`;
    const valueId = async (attributeId, label) =>
      (
        await tx`select id from public.attribute_values where attribute_id = ${attributeId} and label = ${label}`
      )[0].id;
    const categoryIds = [];
    for (const [i, name] of CATEGORIES.entries()) {
      const [c] =
        await tx`select public.catalog_upsert_category(${storeId}, ${tx.json({ name, position: i })}) as id`;
      categoryIds.push(c.id);
    }

    for (const [i, row] of PRODUCTS.entries()) {
      const [title, brand, category, goals, flavorLabel, price, compareAt, stock, servings, shape] =
        row;
      const sku = `DEMO-${String(i + 1).padStart(3, "0")}`;
      const [p] = await tx`
        select public.catalog_upsert_product(${storeId}, ${tx.json({
          title,
          brand_id: brandIds[brand],
          description_html:
            "<p>Producto de ejemplo para la demostración de la tienda. No está a la venta y sus datos no son reales.</p>",
          categories: [{ id: categoryIds[category], is_primary: true }],
          variants: [{ price, compare_at_price: compareAt, sku }],
        })}) as r`;
      const productId = p.r.id;
      const [v] =
        await tx`select id from public.product_variants where store_id = ${storeId} and sku = ${sku}`;
      if (stock > 0)
        await tx`select public.inventory_adjust(${storeId}, ${v.id}, 'adjustment', ${stock}, 'Inventario de ejemplo')`;
      await tx`select public.inventory_set_threshold(${storeId}, ${v.id}, 5)`;
      await tx`select public.catalog_save_regulatory_info(${storeId}, ${productId}, 'dietary_supplement', ${tx.json(
        {
          form: shape === "bottle" ? "Cápsulas" : "Polvo",
          serving_size: shape === "bottle" ? "2 cápsulas" : "1 medida",
          servings_per_container: servings,
          ...EXAMPLE_SHEET,
        },
      )})`;
      const values = [
        ...goals.map((g) => valueId(goal[0].id, g)),
        valueId(flavor[0].id, flavorLabel),
      ];
      await tx`select public.catalog_set_product_attributes(${storeId}, ${productId}, ${await Promise.all(values)}::uuid[])`;
      // La imagen se sube aparte (como el pipeline); luego se publica.
      productsToImage.push({ productId, title, svg: productSvg(row) });
    }
    shared.goalEnergy = await valueId(goal[0].id, "Energía");
    shared.goalStrength = await valueId(goal[0].id, "Fuerza");
    shared.categoryIds = categoryIds;
  });

  for (const p of productsToImage) {
    await uploadImage(
      storeId,
      "product",
      p.productId,
      p.svg,
      `Ilustración de ejemplo: ${p.title}`,
      0,
    );
  }

  await asOwner(ownerId, async (tx) => {
    for (const p of productsToImage)
      await tx`select public.catalog_publish_product(${storeId}, ${p.productId})`;

    const zone =
      await tx`select public.shipping_upsert_zone(${storeId}, ${tx.json({ name: "México", countries: ["MX"] })}) as id`;
    await tx`select public.shipping_upsert_rate(${storeId}, ${tx.json({ zone_id: zone[0].id, name: "Envío estándar", type: "free_over", price: 9900, free_over_subtotal: 99900, est_days_min: 2, est_days_max: 5 })})`;

    // Tema: estilo «Anaquel» (rediseño A+B) o «Neutral» + aviso de demostración + portada.
    const rev = async () =>
      (await tx`select draft_revision from public.store_themes where store_id = ${storeId}`)[0]
        .draft_revision;
    await tx`select public.appearance_save_theme_draft(${storeId}, ${tx.json({
      ...style,
      header: {
        announcement: {
          text: "Tienda de demostración: los productos son ejemplos y no están a la venta.",
          background: "#1a1c22",
          foreground: "#ffffff",
        },
      },
      footer: {
        payment_methods: ["visa", "mastercard", "oxxo"],
        legal_text: "Datos de demostración. Ningún producto, precio ni texto sanitario es real.",
      },
    })}, ${await rev()})`;
    const section = (n, type, props) => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      type,
      enabled: true,
      props,
    });
    await tx`select public.appearance_save_home_draft(${storeId}, ${tx.json([
      section(1, "hero", {
        heading: "Todo para tu entrenamiento y tu día a día",
        subheading: "Proteínas, creatinas, pre-entrenos y vitaminas. Envío gratis desde $999.",
        image_media_id: banner,
        cta: { label: "Ver productos", link: "/productos" },
        align: "left",
      }),
      section(2, "category_grid", {
        title: "Compra por categoría",
        category_ids: shared.categoryIds,
      }),
      section(3, "featured_products", {
        title: "Para tu energía",
        source: { type: "attribute_value", id: shared.goalEnergy },
        limit: 8,
        show_view_all: true,
      }),
      section(4, "featured_products", {
        title: "Para tu fuerza",
        source: { type: "attribute_value", id: shared.goalStrength },
        limit: 8,
        show_view_all: true,
      }),
      section(5, "featured_products", {
        title: "Novedades",
        source: { type: "newest" },
        limit: 8,
        show_view_all: true,
      }),
    ])}, ${await rev()})`;
    await tx`select public.appearance_publish_theme(${storeId}, ${await rev()})`;

    // Menú principal de 2 niveles: «Objetivos» (enlaces a filtros, F9-T04) y categorías.
    const goalLinks = await tx`
      select av.label, av.key from public.attribute_values av
        join public.attributes a on a.store_id = av.store_id and a.id = av.attribute_id
       where a.store_id = ${storeId} and a.key = 'objetivo' order by av.position`;
    await tx`select public.menu_set_items(${storeId}, 'main', ${tx.json([
      {
        label: "Objetivos",
        link_type: "url",
        target_id: null,
        url: "/productos",
        children: goalLinks.map((g) => ({
          label: g.label,
          link_type: "url",
          target_id: null,
          url: `/productos?objetivo=${g.key}`,
        })),
      },
      {
        label: "Categorías",
        link_type: "url",
        target_id: null,
        url: "/productos",
        children: CATEGORIES.map((label, i) => ({
          label,
          link_type: "category",
          target_id: shared.categoryIds[i],
          url: null,
        })),
      },
    ])})`;
  });

  // Pago de prueba (proveedor fake, solo fuera de producción) para recorrer la compra.
  await sql`insert into public.payment_accounts (store_id, provider, status, display_name)
            values (${storeId}, 'fake', 'active', 'Tarjeta (prueba)')`;
  await sql`insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
            on conflict (key) do nothing`;

  log(`✓ Tienda de demostración lista: ${hostname} (dueña ${ownerEmail})`);
  return { storeId, handle, created: true };
}
