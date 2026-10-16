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
  deportivo: {
    colors: {
      primary: "#0b5d4b",
      accent: "#b4500c",
      background: "#fbfaf7",
      foreground: "#14181f",
      muted: "#4a5260",
    },
    typography: { heading: "barlow-condensed", body: "inter" },
    shape: { radius: "sm", button_style: "solid" },
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
// Imágenes de ejemplo: ilustraciones planas de envases (sin personas, sin
// sellos, sin claims), con la palabra EJEMPLO visible.
// -----------------------------------------------------------------------------
function escapeXml(text) {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Hasta 2 renglones de ~16 caracteres para que el nombre quepa en la etiqueta. */
function lines(label) {
  const out = [""];
  for (const word of label.split(" ")) {
    const current = out[out.length - 1];
    if (current && (current + " " + word).length > 16 && out.length < 2) out.push(word);
    else out[out.length - 1] = current ? `${current} ${word}` : word;
  }
  return out;
}

export function packSvg({ label, color, shape }) {
  const body =
    shape === "tub"
      ? `<rect x="230" y="250" width="340" height="400" rx="40" fill="${color}"/>
         <rect x="215" y="210" width="370" height="70" rx="18" fill="#14181f"/>`
      : shape === "bottle"
        ? `<rect x="300" y="200" width="200" height="460" rx="60" fill="${color}"/>
           <rect x="345" y="150" width="110" height="70" rx="14" fill="#14181f"/>`
        : `<rect x="250" y="230" width="300" height="420" rx="24" fill="${color}"/>
           <path d="M250 300 L550 300" stroke="#fbfaf7" stroke-width="6" opacity="0.5"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="#efece4"/>
    <ellipse cx="400" cy="680" rx="230" ry="26" fill="#d9d4c7"/>
    ${body}
    <rect x="262" y="380" width="276" height="150" rx="10" fill="#fbfaf7"/>
    ${lines(label)
      .map(
        (line, i) => `<text x="400" y="${422 + i * 34}" font-family="DejaVu Sans, sans-serif"
          font-size="26" font-weight="700" text-anchor="middle" fill="#14181f">${escapeXml(line)}</text>`,
      )
      .join("")}
    <text x="400" y="510" font-family="DejaVu Sans, sans-serif" font-size="20" letter-spacing="4"
          text-anchor="middle" fill="#4a5260">EJEMPLO</text>
  </svg>`;
}

/**
 * Banner del hero: envases ilustrados (los mismos del catálogo de ejemplo)
 * sobre el verde de la marca, centrados para que el recorte 16:9 de móvil los
 * conserve. Sin personas, sellos ni claims; la etiqueta dice EJEMPLO.
 */
/** Oscurece un color hex (factor 0–1) para el degradado del banner. */
function darken(hex, factor) {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - factor)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function bannerSvg(colors = STYLES.deportivo.colors) {
  const { primary, accent } = colors;
  const pack = (x, w, h, color, cap, capW) => `
    <ellipse cx="${x + w / 2}" cy="560" rx="${w * 0.62}" ry="16" fill="#000" opacity="0.28"/>
    <rect x="${x}" y="${560 - h}" width="${w}" height="${h}" rx="${Math.min(36, w / 5)}" fill="${color}"/>
    <rect x="${x + (w - capW) / 2}" y="${560 - h - 46}" width="${capW}" height="56" rx="12" fill="${cap}"/>
    <rect x="${x + w * 0.12}" y="${560 - h * 0.62}" width="${w * 0.76}" height="${Math.min(110, h * 0.34)}" rx="8" fill="#fbfaf7"/>
    <rect x="${x + w * 0.22}" y="${560 - h * 0.62 + 26}" width="${w * 0.56}" height="12" rx="6" fill="#14181f" opacity="0.85"/>
    <text x="${x + w / 2}" y="${560 - h * 0.62 + 74}" font-family="DejaVu Sans, sans-serif" font-size="18"
          letter-spacing="4" text-anchor="middle" fill="#4a5260">EJEMPLO</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="640" viewBox="0 0 1600 640">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${darken(primary, 0.55)}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.68" cy="0.42" r="0.5">
        <stop offset="0" stop-color="#e9c46a" stop-opacity="0.35"/><stop offset="1" stop-color="#e9c46a" stop-opacity="0"/>
      </radialGradient>
      <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.6" fill="#fbfaf7" opacity="0.07"/>
      </pattern>
    </defs>
    <rect width="1600" height="640" fill="url(#g)"/>
    <rect width="1600" height="640" fill="url(#dots)"/>
    <rect width="1600" height="640" fill="url(#glow)"/>
    <path d="M1600 470 C 1320 400, 1080 520, 760 640 L1600 640 Z" fill="${accent}" opacity="0.9"/>
    <path d="M1600 540 C 1340 490, 1120 580, 940 640 L1600 640 Z" fill="${darken(accent, 0.25)}"/>
    ${pack(740, 200, 300, "#b4500c", "#14181f", 220)}
    ${pack(980, 150, 360, "#14181f", "#2b313b", 90)}
    ${pack(1170, 190, 260, "#0e7490", "#14181f", 210)}
  </svg>`;
}

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
//  porciones, forma, color]
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
    "#0b5d4b",
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
    "#5b3a29",
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
    "tub",
    "#2f3e5c",
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
    "#2f3e5c",
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
    "tub",
    "#b4500c",
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
    "#14181f",
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
    "#6b7d2a",
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
    "#475569",
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
    "sachet",
    "#0e7490",
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
    "#0e7490",
  ],
];

const productSvg = ([title, , , , , , , , , shape, color]) =>
  packSvg({ label: title.replace(" (ejemplo)", ""), color, shape });

/** Todas las ilustraciones de la siembra (para pre-renderizarlas fuera de Node). */
export function demoSvgs() {
  return [
    bannerSvg(STYLES.deportivo.colors),
    bannerSvg(STYLES.neutral.colors),
    ...PRODUCTS.map(productSvg),
  ];
}

export const LEGEND_TEXT =
  "Leyenda sanitaria de ejemplo: el texto oficial lo define el asesor regulatorio de la tienda (pendiente de contenido real).";

/**
 * Siembra la tienda `demo` (estilo «Deportivo») o `demo2` (`neutral`, estilo
 * «Neutral») publicada en `hostname`. Idempotente: si la tienda existe, solo
 * restaura las reglas de prueba y agrega el host.
 *
 * - `sql`: conexión postgres.js con privilegios de dueño del esquema.
 * - `createOwner(email)`: crea la cuenta de la dueña (Auth Admin) y devuelve su id.
 * - `putImage({ path, svg })`: guarda la ilustración en `store-media/<path>` como
 *   WebP y devuelve `{ bytes, width, height }`.
 */
export async function seedDemo({ sql, neutral, hostname, createOwner, putImage, log = () => {} }) {
  const handle = neutral ? "demo2" : "demo";
  const ownerEmail = `${handle}@example.test`;
  const style = neutral ? STYLES.neutral : STYLES.deportivo;
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

  async function ensureDemoCompliance() {
    // Perfil sanitario de MÉXICO con reglas DE PRUEBA (nunca en producción; el
    // real lo define el asesor regulatorio, bloqueo R0).
    const [profile] = await sql`
      update public.compliance_profiles
         set status = 'active', reviewed_by = 'Demostración (sin revisión real)', reviewed_at = now(),
             review_notes = 'Reglas de prueba para la demostración; pendientes de contenido real.'
       where country = 'MX' and category_key = 'dietary_supplement' returning id`;
    await sql`
      insert into public.compliance_rules (profile_id, kind, key, label, body, field_key, placements, position)
      values (${profile.id}, 'required_field', 'demo_ingredientes', 'Ingredientes', null, 'ingredients', '{}', 0),
             (${profile.id}, 'required_legend', 'demo_leyenda', 'Leyenda de ejemplo', ${LEGEND_TEXT},
              null, '{product_page,cart,checkout}', 1),
             (${profile.id}, 'forbidden_term', 'demo_cura', 'Término prohibido de ejemplo', 'cura', null, '{}', 2)
      on conflict (profile_id, key) do nothing`;
  }

  /**
   * Si la ilustración del hero cambió, la sube y la pone en la portada publicada
   * (y en el borrador, si hay). Idempotente: el sha256 del SVG va en la ruta.
   */
  async function refreshBanner(storeId) {
    const svg = bannerSvg(style.colors);
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
    // Los E2E de cumplimiento reinician el perfil de México: se restauran las reglas de prueba.
    await ensureDemoCompliance();
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

  const banner = await uploadImage(storeId, "banner", null, bannerSvg(style.colors), "", 0);
  // (Las siguientes siembras reemplazan el banner con refreshBanner si cambia.)

  await asOwner(ownerId, async (tx) => {
    await tx`select public.compliance_set_store_category(${storeId}, 'dietary_supplement', true)`;
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
          ingredients: "Ingredientes de ejemplo (pendiente de contenido real).",
          usage: "Modo de uso de ejemplo (pendiente de contenido real).",
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

    // Tema: estilo «Deportivo» (F9-DESIGN §15) o «Neutral» + aviso de demostración + portada.
    const rev = async () =>
      (await tx`select draft_revision from public.store_themes where store_id = ${storeId}`)[0]
        .draft_revision;
    await tx`select public.appearance_save_theme_draft(${storeId}, ${tx.json({
      ...style,
      header: {
        announcement: {
          text: "Tienda de demostración: los productos son ejemplos y no están a la venta.",
          background: "#14181f",
          foreground: "#fbfaf7",
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
        heading: "Suplementos para tu entrenamiento y tu día a día",
        subheading: "Elige por objetivo, sabor o marca. Envío gratis en compras desde $999.",
        image_media_id: banner,
        cta: { label: "Ver productos", link: "/productos" },
        align: "left",
      }),
      section(2, "featured_products", {
        title: "Para tu energía",
        source: { type: "attribute_value", id: shared.goalEnergy },
        limit: 4,
        show_view_all: true,
      }),
      section(3, "category_grid", {
        title: "Compra por categoría",
        category_ids: shared.categoryIds,
      }),
      section(4, "featured_products", {
        title: "Para tu fuerza",
        source: { type: "attribute_value", id: shared.goalStrength },
        limit: 4,
        show_view_all: true,
      }),
      section(5, "featured_products", {
        title: "Lo más nuevo",
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
