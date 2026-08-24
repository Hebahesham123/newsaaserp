/**
 * Demo dataset, part 2 — Phases 2 through 7.
 *
 * `seed-demo.ts` builds the tenant: companies, merchants, stores, warehouses,
 * staff. This builds the operation that runs on top of it — a catalog, a week
 * of orders in every lifecycle state, stock, shipments, returns, COD money and
 * a closed set of books.
 *
 * Three rules this file follows, all of them about being able to re-run it:
 *
 *  1. **Every record carries an explicit number or code.** Order numbers,
 *     shipment numbers, ledger transaction numbers — all set by hand rather
 *     than left to the database sequence, so a natural key exists to upsert on.
 *
 *  2. **Stock is seeded as ledger rows, never as levels.** §5.10 makes the
 *     ledger authoritative and `inventory_levels` a trigger-maintained cache.
 *     Ledger inserts use `ignoreDuplicates`, so re-running cannot double the
 *     stock — and cannot fire the append-only guard either.
 *
 *  3. **Lifecycle is walked, not asserted.** An order is inserted early-stage,
 *     given its lines, then advanced. That is the only way the §4.15 triggers
 *     will accept it, and it leaves a real timeline behind.
 *
 * One PostgREST rule to keep in mind when editing this file: **every row in a
 * bulk insert must carry the same keys.** PostgREST builds one multi-row INSERT
 * from the array, so a key present on some rows and absent on others becomes an
 * explicit NULL on the rows that omit it — which fails on any NOT NULL column
 * that was relying on its default. Where a column is NOT NULL, spell it out on
 * every row rather than letting the default cover for you.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The untyped client, deliberately.
 *
 * The seed runs as the service role and writes to tables the generated types
 * mark read-only from a client's perspective — `inventory_ledger` most of all,
 * where the app is supposed to go through `post_inventory_movement`. Typing
 * this against `Database` would fight the very constraint it is seeding around.
 */
type Db = SupabaseClient;
type Row = Record<string, unknown>;

export type SeedContext = {
  db: Db;
  companyId: string;
  merchants: Record<string, string>;
  stores: Record<string, string>;
  warehouses: Record<string, string>;
  staff: Record<string, string>;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const iso = (d: Date) => d.toISOString();
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** Deterministic pseudo-random, so every seed run produces the same demo. */
function rng(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1_103_515_245 + 12_345) % 2_147_483_648;
    return value / 2_147_483_648;
  };
}
const rand = rng(20_260_824);

function fail(label: string, error: { message: string } | null): void {
  if (error) {
    console.error(`\n✗ ${label}: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Find-then-write, for tables guarded by a BEFORE INSERT trigger.
 *
 * `products` and `product_variants` carry the §3.13 rule 5 barcode check. On
 * `INSERT ... ON CONFLICT DO UPDATE` that trigger fires before the conflict is
 * resolved, so it sees a freshly generated `new.id`, mistakes the row for a
 * different item, and rejects a product for clashing with itself. Migration
 * 0022 fixes the trigger; this avoids the upsert path entirely so the seed
 * works whether or not that migration has been applied yet.
 */
async function writeByNaturalKey(
  db: Db,
  table: string,
  match: Record<string, string>,
  row: Row,
  label: string,
): Promise<string> {
  let query = db.from(table).select('id');
  for (const [column, value] of Object.entries(match)) query = query.eq(column, value);

  const { data: existing } = await query.maybeSingle();

  if (existing) {
    const id = String((existing as Row).id);
    const { error } = await db.from(table).update(row).eq('id', id);
    fail(label, error);
    return id;
  }

  const { data, error } = await db.from(table).insert({ ...row, ...match }).select('id').single();
  fail(label, error);
  return String((data as Row).id);
}

/** Upsert helper that returns an id map keyed by the natural code. */
async function upsertMany(
  db: Db,
  table: string,
  rows: Row[],
  conflict: string,
  keyField = 'code',
): Promise<Record<string, string>> {
  if (rows.length === 0) return {};

  const { data, error } = await db
    .from(table)
    .upsert(rows, { onConflict: conflict })
    .select(`id, ${keyField}`);

  fail(table, error);

  // `keyField` is interpolated, so Supabase's select-string parser cannot infer
  // the row shape and resolves it to a parser-error type. The cast goes through
  // `unknown` because the two types genuinely do not overlap.
  const ids: Record<string, string> = {};
  for (const row of ((data ?? []) as unknown) as Row[]) {
    ids[String(row[keyField])] = String(row.id);
  }
  return ids;
}

/* ========================================================================== */
/* Phase 2 — Catalog (§3)                                                     */
/* ========================================================================== */

async function seedCatalog(ctx: SeedContext) {
  const { db, companyId, merchants } = ctx;

  const brands = await upsertMany(
    db,
    'brands',
    [
      { company_id: companyId, merchant_id: merchants.NRA, code: 'NARA', name_en: 'Nara', name_ar: 'نارا' },
      { company_id: companyId, merchant_id: merchants.ATL, code: 'ATLAS', name_en: 'Atlas', name_ar: 'أطلس' },
      { company_id: companyId, merchant_id: merchants.DTL, code: 'DATES', name_en: 'Dates & Tea', name_ar: 'تمر وشاي' },
      { company_id: companyId, merchant_id: merchants.HLM, code: 'HALIM', name_en: 'Halim Home', name_ar: 'حليم هوم' },
      { company_id: companyId, code: 'GENERIC', name_en: 'Unbranded', name_ar: 'بدون علامة' },
    ],
    'company_id,code',
  );

  const categories = await upsertMany(
    db,
    'categories',
    [
      { company_id: companyId, code: 'BEAUTY', name_en: 'Beauty', name_ar: 'الجمال', sort_order: 1 },
      { company_id: companyId, code: 'APPAREL', name_en: 'Apparel', name_ar: 'الملابس', sort_order: 2 },
      { company_id: companyId, code: 'FOOD', name_en: 'Food & Beverage', name_ar: 'أطعمة ومشروبات', sort_order: 3 },
      { company_id: companyId, code: 'HOME', name_en: 'Home', name_ar: 'المنزل', sort_order: 4 },
    ],
    'company_id,code',
  );

  // Sub-categories, so the self-referencing hierarchy is actually exercised.
  const subCategories = await upsertMany(
    db,
    'categories',
    [
      { company_id: companyId, code: 'SKINCARE', name_en: 'Skincare', name_ar: 'العناية بالبشرة', parent_id: categories.BEAUTY, sort_order: 11 },
      { company_id: companyId, code: 'MAKEUP', name_en: 'Makeup', name_ar: 'مكياج', parent_id: categories.BEAUTY, sort_order: 12 },
      { company_id: companyId, code: 'ACTIVEWEAR', name_en: 'Activewear', name_ar: 'ملابس رياضية', parent_id: categories.APPAREL, sort_order: 21 },
      { company_id: companyId, code: 'TEA', name_en: 'Tea & Infusions', name_ar: 'شاي وأعشاب', parent_id: categories.FOOD, sort_order: 31 },
    ],
    'company_id,code',
  );

  const units = await upsertMany(
    db,
    'units_of_measure',
    [
      { company_id: companyId, code: 'PCS', name_en: 'Piece', name_ar: 'قطعة', allows_fractions: false },
      { company_id: companyId, code: 'BOX', name_en: 'Box', name_ar: 'علبة', allows_fractions: false },
      { company_id: companyId, code: 'KG', name_en: 'Kilogram', name_ar: 'كيلوجرام', allows_fractions: true },
    ],
    'company_id,code',
  );

  await upsertMany(
    db,
    'product_attributes',
    [
      { company_id: companyId, code: 'colour', name_en: 'Colour', name_ar: 'اللون', values: ['Black', 'White', 'Rose', 'Navy'], is_variant_axis: true, sort_order: 1 },
      { company_id: companyId, code: 'size', name_en: 'Size', name_ar: 'المقاس', values: ['S', 'M', 'L', 'XL'], is_variant_axis: true, sort_order: 2 },
      { company_id: companyId, code: 'shade', name_en: 'Shade', name_ar: 'الدرجة', values: ['Light', 'Medium', 'Deep'], is_variant_axis: true, sort_order: 3 },
      { company_id: companyId, code: 'weight', name_en: 'Net weight', name_ar: 'الوزن الصافي', values: ['100g', '250g', '500g'], is_variant_axis: true, sort_order: 4 },
    ],
    'company_id,code',
  );

  const suppliers = await upsertMany(
    db,
    'suppliers',
    [
      { company_id: companyId, code: 'SUP-COS', name: 'Levant Cosmetics Supply', contact_person: 'Rami Haddad', email: 'rami@levantsupply.example', phone: '+20 122 445 9080', country: 'Egypt', payment_terms: 'Net 30', lead_time_days: 21 },
      { company_id: companyId, code: 'SUP-TEX', name: 'Delta Textiles', contact_person: 'Mona Adel', email: 'mona@deltatex.example', phone: '+20 100 337 2211', country: 'Egypt', payment_terms: 'Net 45', lead_time_days: 30 },
      { company_id: companyId, code: 'SUP-AGR', name: 'Siwa Agri Exports', contact_person: 'Khaled Nour', email: 'khaled@siwaagri.example', country: 'Egypt', payment_terms: 'Net 15', lead_time_days: 10 },
    ],
    'company_id,code',
  );

  const collections = await upsertMany(
    db,
    'collections',
    [
      // `is_seasonal` is NOT NULL, so both rows state it — see the header note
      // on PostgREST bulk inserts.
      { company_id: companyId, merchant_id: merchants.NRA, code: 'SUMMER26', name_en: 'Summer 2026', name_ar: 'صيف ٢٠٢٦', is_seasonal: true, season_start: dateOnly(daysAgo(60)), season_end: dateOnly(daysAgo(-40)) },
      { company_id: companyId, merchant_id: null, code: 'BESTSELLERS', name_en: 'Bestsellers', name_ar: 'الأكثر مبيعًا', is_seasonal: false, season_start: null, season_end: null },
    ],
    'company_id,code',
  );

  /* ---- Products -------------------------------------------------------- */

  type ProductSeed = {
    merchant: string;
    sku: string;
    name_en: string;
    name_ar: string;
    type: string;
    status: string;
    brand?: string;
    category?: string;
    supplier?: string;
    price: number;
    cost: number;
    barcode?: string;
    variants?: { sku: string; name: string; options: Record<string, string>; price?: number; cost?: number }[];
  };

  const PRODUCTS: ProductSeed[] = [
    {
      merchant: 'NRA', sku: 'NRA-SER-01', name_en: 'Vitamin C Serum 30ml', name_ar: 'سيروم فيتامين سي ٣٠ مل',
      type: 'simple', status: 'active', brand: 'NARA', category: 'SKINCARE', supplier: 'SUP-COS',
      price: 640, cost: 235, barcode: '6221031001017',
    },
    {
      merchant: 'NRA', sku: 'NRA-CRM-02', name_en: 'Hydrating Day Cream', name_ar: 'كريم النهار المرطب',
      type: 'simple', status: 'active', brand: 'NARA', category: 'SKINCARE', supplier: 'SUP-COS',
      price: 480, cost: 168, barcode: '6221031001024',
    },
    {
      merchant: 'NRA', sku: 'NRA-FND-03', name_en: 'Matte Foundation', name_ar: 'كريم أساس مط',
      type: 'variant', status: 'active', brand: 'NARA', category: 'MAKEUP', supplier: 'SUP-COS',
      price: 520, cost: 190, barcode: '6221031001031',
      variants: [
        { sku: 'NRA-FND-03-L', name: 'Light', options: { shade: 'Light' }, price: 520, cost: 190 },
        { sku: 'NRA-FND-03-M', name: 'Medium', options: { shade: 'Medium' }, price: 520, cost: 190 },
        { sku: 'NRA-FND-03-D', name: 'Deep', options: { shade: 'Deep' }, price: 545, cost: 205 },
      ],
    },
    {
      merchant: 'NRA', sku: 'NRA-SET-04', name_en: 'Glow Starter Set', name_ar: 'طقم الإشراقة',
      type: 'bundle', status: 'active', brand: 'NARA', category: 'BEAUTY',
      price: 990, cost: 380,
    },
    {
      merchant: 'NRA', sku: 'NRA-MSK-05', name_en: 'Clay Mask 100ml', name_ar: 'ماسك الطين ١٠٠ مل',
      type: 'simple', status: 'draft', brand: 'NARA', category: 'SKINCARE',
      price: 310, cost: 118,
    },
    {
      merchant: 'ATL', sku: 'ATL-TEE-01', name_en: 'Performance Tee', name_ar: 'تي شيرت رياضي',
      type: 'variant', status: 'active', brand: 'ATLAS', category: 'ACTIVEWEAR', supplier: 'SUP-TEX',
      price: 420, cost: 155, barcode: '6221044002011',
      variants: [
        { sku: 'ATL-TEE-01-BS', name: 'Black / S', options: { colour: 'Black', size: 'S' } },
        { sku: 'ATL-TEE-01-BM', name: 'Black / M', options: { colour: 'Black', size: 'M' } },
        { sku: 'ATL-TEE-01-BL', name: 'Black / L', options: { colour: 'Black', size: 'L' } },
        { sku: 'ATL-TEE-01-NM', name: 'Navy / M', options: { colour: 'Navy', size: 'M' } },
      ],
    },
    {
      merchant: 'ATL', sku: 'ATL-LEG-02', name_en: 'Compression Leggings', name_ar: 'ليجنز ضاغط',
      type: 'variant', status: 'active', brand: 'ATLAS', category: 'ACTIVEWEAR', supplier: 'SUP-TEX',
      price: 760, cost: 290,
      variants: [
        { sku: 'ATL-LEG-02-BM', name: 'Black / M', options: { colour: 'Black', size: 'M' } },
        { sku: 'ATL-LEG-02-BL', name: 'Black / L', options: { colour: 'Black', size: 'L' } },
      ],
    },
    {
      merchant: 'ATL', sku: 'ATL-BTL-03', name_en: 'Insulated Bottle 750ml', name_ar: 'زجاجة حرارية ٧٥٠ مل',
      type: 'simple', status: 'out_of_stock', brand: 'ATLAS', category: 'ACTIVEWEAR',
      price: 350, cost: 130,
    },
    {
      merchant: 'DTL', sku: 'DTL-TEA-01', name_en: 'Hibiscus Tea 250g', name_ar: 'شاي الكركديه ٢٥٠ جم',
      type: 'simple', status: 'active', brand: 'DATES', category: 'TEA', supplier: 'SUP-AGR',
      price: 180, cost: 62, barcode: '6221055003015',
    },
    {
      merchant: 'DTL', sku: 'DTL-DAT-02', name_en: 'Medjool Dates 1kg', name_ar: 'تمر مجدول ١ كجم',
      type: 'batch_controlled', status: 'active', brand: 'DATES', category: 'FOOD', supplier: 'SUP-AGR',
      price: 420, cost: 165,
    },
    {
      merchant: 'HLM', sku: 'HLM-CAN-01', name_en: 'Soy Candle — Oud', name_ar: 'شمعة صويا — عود',
      type: 'simple', status: 'active', brand: 'HALIM', category: 'HOME',
      price: 290, cost: 96,
    },
    {
      merchant: 'HLM', sku: 'HLM-TWL-02', name_en: 'Egyptian Cotton Towel', name_ar: 'منشفة قطن مصري',
      type: 'simple', status: 'unmapped', brand: 'HALIM', category: 'HOME',
      price: 260, cost: 88,
    },
  ];

  const productIds: Record<string, string> = {};
  const variantIds: Record<string, string> = {};

  for (const product of PRODUCTS) {
    const merchantId = merchants[product.merchant];
    if (!merchantId) continue;

    // §3.13 rule 11 — a product cannot be activated without a price, so the
    // price goes in on the same write as the status.
    const productId = await writeByNaturalKey(
      db,
      'products',
      { merchant_id: merchantId, sku: product.sku },
      {
        company_id: companyId,
        barcode: product.barcode ?? null,
        name_en: product.name_en,
        name_ar: product.name_ar,
        product_type: product.type,
        status: product.status,
        brand_id: product.brand ? brands[product.brand] : null,
        category_id: product.category
          ? (categories[product.category] ?? subCategories[product.category] ?? null)
          : null,
        supplier_id: product.supplier ? suppliers[product.supplier] : null,
        uom_id: units.PCS,
        base_price: product.price,
        base_cost: product.cost,
        currency: 'EGP',
        tax_rate: 14,
        weight_grams: 250 + Math.floor(rand() * 600),
        country_of_origin: 'Egypt',
        is_sellable: true,
        is_stock_item: true,
        is_batch_tracked: product.type === 'batch_controlled',
        tags: [product.merchant.toLowerCase(), product.category?.toLowerCase() ?? 'general'],
      },
      `product ${product.sku}`,
    );

    productIds[product.sku] = productId;

    // Every product carries one default variant — the single sellable unit for
    // a simple product, and the fallback listing for a variant product (§3.4).
    variantIds[product.sku] = await writeByNaturalKey(
      db,
      'product_variants',
      { merchant_id: merchantId, sku: product.sku },
      {
        product_id: productId,
        company_id: companyId,
        barcode: product.barcode ?? null,
        price: product.price,
        cost: product.cost,
        is_default: true,
        is_active: true,
        position: 0,
      },
      `default variant ${product.sku}`,
    );

    for (const [index, variant] of (product.variants ?? []).entries()) {
      variantIds[variant.sku] = await writeByNaturalKey(
        db,
        'product_variants',
        { merchant_id: merchantId, sku: variant.sku },
        {
          product_id: productId,
          company_id: companyId,
          name: variant.name,
          options: variant.options,
          price: variant.price ?? product.price,
          cost: variant.cost ?? product.cost,
          is_default: false,
          is_active: true,
          position: index + 1,
        },
        `variant ${variant.sku}`,
      );
    }
  }

  /* ---- Bundle composition (§3.9) --------------------------------------- */

  const bundleId = productIds['NRA-SET-04'];
  if (bundleId) {
    const components = [
      { variant: 'NRA-SER-01', quantity: 1 },
      { variant: 'NRA-CRM-02', quantity: 1 },
      { variant: 'NRA-MSK-05', quantity: 1 },
    ]
      .filter((component) => variantIds[component.variant])
      .map((component, index) => ({
        bundle_product_id: bundleId,
        component_variant_id: variantIds[component.variant],
        quantity: component.quantity,
        is_required: true,
        position: index,
      }));

    const { error } = await db
      .from('bundle_components')
      .upsert(components, { onConflict: 'bundle_product_id,component_variant_id' });
    fail('bundle components', error);
  }

  /* ---- Price matrix and costs (§3.7, §3.8) ----------------------------- */

  const priceRows: Row[] = [];
  const costRows: Row[] = [];

  for (const [sku, productId] of Object.entries(productIds)) {
    const seed = PRODUCTS.find((p) => p.sku === sku);
    if (!seed) continue;

    // A wholesale tier and a promotional price, so the matrix is not just base.
    priceRows.push({
      company_id: companyId, product_id: productId, price_type: 'wholesale',
      amount: Math.round(seed.price * 0.78), currency: 'EGP', min_quantity: 12, priority: 10, is_active: true,
      valid_from: null, valid_to: null, note: 'Wholesale from 12 units',
    });

    if (seed.status === 'active' && rand() > 0.5) {
      priceRows.push({
        company_id: companyId, product_id: productId, price_type: 'promotional',
        amount: Math.round(seed.price * 0.85), currency: 'EGP', min_quantity: null, priority: 20, is_active: true,
        valid_from: iso(daysAgo(14)), valid_to: iso(daysAgo(-14)), note: 'Mid-season promotion',
      });
    }

    // `is_percentage` is NOT NULL, so all three rows state it.
    costRows.push(
      { company_id: companyId, product_id: productId, component: 'purchase', amount: seed.cost, currency: 'EGP', is_percentage: false, effective_from: dateOnly(daysAgo(120)) },
      { company_id: companyId, product_id: productId, component: 'packaging', amount: 6.5, currency: 'EGP', is_percentage: false, effective_from: dateOnly(daysAgo(120)) },
      { company_id: companyId, product_id: productId, component: 'payment_gateway', amount: 2.5, currency: 'EGP', is_percentage: true, effective_from: dateOnly(daysAgo(120)) },
    );
  }

  // No natural key on product_prices, so clear the seeded set before rewriting.
  await db.from('product_prices').delete().eq('company_id', companyId).in('price_type', ['wholesale', 'promotional']);
  fail('product prices', (await db.from('product_prices').insert(priceRows)).error);
  fail('product costs', (await db.from('product_costs').upsert(costRows, { onConflict: 'product_id,variant_id,component,effective_from' })).error);

  /* ---- Channel mapping (§3.5) ------------------------------------------ */

  const mappingRows: Row[] = [];
  const storeForMerchant: Record<string, string> = {
    NRA: ctx.stores['NRA-SHOP'],
    ATL: ctx.stores['ATL-SHOP'],
    DTL: ctx.stores['DTL-WOO'],
    HLM: ctx.stores['HLM-SHOP'],
  };

  for (const product of PRODUCTS) {
    const storeId = storeForMerchant[product.merchant];
    const productId = productIds[product.sku];
    if (!storeId || !productId) continue;

    // HLM-TWL-02 is deliberately left unmapped so the §3.14 queue has an entry.
    if (product.sku === 'HLM-TWL-02') continue;

    const skus = [product.sku, ...(product.variants ?? []).map((v) => v.sku)];
    for (const sku of skus) {
      if (!variantIds[sku]) continue;
      mappingRows.push({
        company_id: companyId,
        product_id: productId,
        variant_id: variantIds[sku],
        store_id: storeId,
        external_variant_id: `gid://shopify/ProductVariant/${40_000_000 + Math.floor(rand() * 9_000_000)}`,
        external_sku: sku,
        master_source: 'system',
        status: 'mapped',
        last_synced_at: iso(hoursAgo(2)),
      });
    }
  }

  fail(
    'channel mappings',
    (await db.from('product_channel_mappings').upsert(mappingRows, { onConflict: 'store_id,product_id,variant_id' })).error,
  );

  /* ---- Collection membership ------------------------------------------ */

  const membership = ['NRA-SER-01', 'NRA-CRM-02', 'NRA-FND-03']
    .filter((sku) => productIds[sku])
    .map((sku, index) => ({ collection_id: collections.SUMMER26, product_id: productIds[sku], position: index }));

  fail('product collections', (await db.from('product_collections').upsert(membership, { onConflict: 'collection_id,product_id' })).error);

  return { productIds, variantIds, brands, categories: { ...categories, ...subCategories }, suppliers };
}

/* ========================================================================== */
/* Phase 3 — Customers & orders (§4)                                          */
/* ========================================================================== */

const CUSTOMERS = [
  { phone: '+201002233445', name: 'Mariam Saleh', governorate: 'Cairo', city: 'Nasr City', address: '18 Abbas El Akkad, Nasr City' },
  { phone: '+201115566778', name: 'Omar Farouk', governorate: 'Giza', city: 'Dokki', address: '7 Tahrir Street, Dokki' },
  { phone: '+201227788990', name: 'Nourhan Adel', governorate: 'Alexandria', city: 'Smouha', address: '44 Victor Emanuel, Smouha' },
  { phone: '+201004455667', name: 'Karim Mostafa', governorate: 'Cairo', city: 'Maadi', address: '12 Road 9, Maadi' },
  { phone: '+201559900112', name: 'Salma Hegazy', governorate: 'Cairo', city: 'Heliopolis', address: '3 Baghdad Street, Heliopolis' },
  { phone: '+201093344556', name: 'Youssef Nabil', governorate: 'Giza', city: '6th of October', address: 'District 4, 6th of October' },
  { phone: '+201286677889', name: 'Hana Rashad', governorate: 'Dakahlia', city: 'Mansoura', address: '9 Gomhoreya Street, Mansoura' },
  { phone: '+201017788221', name: 'Tarek Selim', governorate: 'Cairo', city: 'Shubra', address: '55 Shubra Street' },
  { phone: '+201121234567', name: 'Dina Wahba', governorate: 'Alexandria', city: 'Gleem', address: '2 Mostafa Kamel, Gleem' },
  { phone: '+201555512345', name: 'Ahmed Ghanem', governorate: 'Sharqia', city: 'Zagazig', address: '17 El Qawmeya, Zagazig' },
];

async function seedCustomers(ctx: SeedContext) {
  const { db, companyId } = ctx;

  const rows = CUSTOMERS.map((customer) => ({
    company_id: companyId,
    phone: customer.phone,
    name: customer.name,
    email: `${customer.name.split(' ')[0].toLowerCase()}@example.com`,
    governorate: customer.governorate,
    city: customer.city,
    address: customer.address,
    preferred_language: 'ar',
  }));

  return upsertMany(db, 'customers', rows, 'company_id,phone', 'phone');
}

type OrderPlan = {
  number: string;
  merchant: string;
  store: string;
  source: string;
  customer: string;
  /** The state to finish in. The seed walks the lifecycle to reach it. */
  finalStatus: string;
  daysOld: number;
  agent?: string;
  lines: { sku: string; qty: number }[];
  calls?: { outcome: string; minutesAgo: number; duration?: number; notes?: string }[];
  messages?: number;
  cancelReason?: string;
};

const ORDER_PLANS: OrderPlan[] = [
  { number: 'DEMO-0001', merchant: 'NRA', store: 'NRA-SHOP', source: 'shopify', customer: '+201002233445', finalStatus: 'ready_for_warehouse', daysOld: 7, agent: 'EMP-004', lines: [{ sku: 'NRA-SER-01', qty: 2 }, { sku: 'NRA-CRM-02', qty: 1 }], calls: [{ outcome: 'confirmed', minutesAgo: 9_000, duration: 96 }] },
  { number: 'DEMO-0002', merchant: 'NRA', store: 'NRA-SHOP', source: 'shopify', customer: '+201115566778', finalStatus: 'ready_for_warehouse', daysOld: 6, agent: 'EMP-005', lines: [{ sku: 'NRA-FND-03-M', qty: 1 }], calls: [{ outcome: 'no_answer', minutesAgo: 8_600, duration: 0 }, { outcome: 'confirmed', minutesAgo: 8_400, duration: 71 }] },
  { number: 'DEMO-0003', merchant: 'ATL', store: 'ATL-SHOP', source: 'shopify', customer: '+201227788990', finalStatus: 'ready_for_warehouse', daysOld: 6, agent: 'EMP-004', lines: [{ sku: 'ATL-TEE-01-BM', qty: 2 }, { sku: 'ATL-LEG-02-BM', qty: 1 }], calls: [{ outcome: 'confirmed', minutesAgo: 8_200, duration: 120 }] },
  { number: 'DEMO-0004', merchant: 'DTL', store: 'DTL-WOO', source: 'woocommerce', customer: '+201004455667', finalStatus: 'ready_for_warehouse', daysOld: 5, agent: 'EMP-006', lines: [{ sku: 'DTL-TEA-01', qty: 3 }, { sku: 'DTL-DAT-02', qty: 1 }], calls: [{ outcome: 'confirmed', minutesAgo: 7_000, duration: 64 }] },
  { number: 'DEMO-0005', merchant: 'NRA', store: 'NRA-APP', source: 'mobile_app', customer: '+201559900112', finalStatus: 'confirmed', daysOld: 4, agent: 'EMP-005', lines: [{ sku: 'NRA-SET-04', qty: 1 }], calls: [{ outcome: 'confirmed', minutesAgo: 5_400, duration: 143 }], messages: 1 },
  { number: 'DEMO-0006', merchant: 'ATL', store: 'ATL-SHOP', source: 'shopify', customer: '+201093344556', finalStatus: 'confirmed', daysOld: 3, agent: 'EMP-004', lines: [{ sku: 'ATL-TEE-01-BL', qty: 1 }], calls: [{ outcome: 'confirmed', minutesAgo: 4_100, duration: 55 }] },
  { number: 'DEMO-0007', merchant: 'HLM', store: 'HLM-SHOP', source: 'shopify', customer: '+201286677889', finalStatus: 'confirmed', daysOld: 3, agent: 'EMP-006', lines: [{ sku: 'HLM-CAN-01', qty: 4 }], calls: [{ outcome: 'confirmed', minutesAgo: 3_900, duration: 88 }] },
  { number: 'DEMO-0008', merchant: 'NRA', store: 'NRA-SHOP', source: 'shopify', customer: '+201017788221', finalStatus: 'cancelled', daysOld: 5, agent: 'EMP-005', lines: [{ sku: 'NRA-CRM-02', qty: 1 }], calls: [{ outcome: 'no_answer', minutesAgo: 6_800 }, { outcome: 'no_answer', minutesAgo: 6_200 }, { outcome: 'no_answer', minutesAgo: 5_900 }], cancelReason: 'no_answer' },
  { number: 'DEMO-0009', merchant: 'ATL', store: 'ATL-SHOP', source: 'shopify', customer: '+201121234567', finalStatus: 'cancelled', daysOld: 4, agent: 'EMP-004', lines: [{ sku: 'ATL-BTL-03', qty: 2 }], calls: [{ outcome: 'cancelled', minutesAgo: 5_100, duration: 47, notes: 'Customer found it cheaper elsewhere' }], cancelReason: 'price' },
  { number: 'DEMO-0010', merchant: 'DTL', store: 'DTL-WOO', source: 'woocommerce', customer: '+201555512345', finalStatus: 'cancelled', daysOld: 2, agent: 'EMP-006', lines: [{ sku: 'DTL-TEA-01', qty: 1 }], cancelReason: 'out_of_coverage' },
  { number: 'DEMO-0011', merchant: 'NRA', store: 'NRA-SHOP', source: 'shopify', customer: '+201002233445', finalStatus: 'callback', daysOld: 2, agent: 'EMP-004', lines: [{ sku: 'NRA-SER-01', qty: 1 }], calls: [{ outcome: 'callback_requested', minutesAgo: 2_600, duration: 38, notes: 'Asked to be called after 6pm' }] },
  { number: 'DEMO-0012', merchant: 'ATL', store: 'ATL-SHOP', source: 'shopify', customer: '+201227788990', finalStatus: 'second_call', daysOld: 2, agent: 'EMP-005', lines: [{ sku: 'ATL-LEG-02-BL', qty: 1 }], calls: [{ outcome: 'busy', minutesAgo: 2_400 }, { outcome: 'no_answer', minutesAgo: 2_100 }] },
  { number: 'DEMO-0013', merchant: 'NRA', store: 'NRA-NOON', source: 'noon', customer: '+201004455667', finalStatus: 'assigned', daysOld: 1, agent: 'EMP-006', lines: [{ sku: 'NRA-FND-03-D', qty: 1 }, { sku: 'NRA-MSK-05', qty: 2 }] },
  { number: 'DEMO-0014', merchant: 'HLM', store: 'HLM-AMZ', source: 'amazon', customer: '+201559900112', finalStatus: 'assigned', daysOld: 1, agent: 'EMP-004', lines: [{ sku: 'HLM-CAN-01', qty: 2 }] },
  { number: 'DEMO-0015', merchant: 'ATL', store: 'ATL-POS', source: 'pos', customer: '+201093344556', finalStatus: 'pending_assignment', daysOld: 1, lines: [{ sku: 'ATL-TEE-01-BS', qty: 1 }] },
  { number: 'DEMO-0016', merchant: 'DTL', store: 'DTL-SOC', source: 'social_commerce', customer: '+201286677889', finalStatus: 'pending_assignment', daysOld: 1, lines: [{ sku: 'DTL-DAT-02', qty: 2 }] },
  { number: 'DEMO-0017', merchant: 'NRA', store: 'NRA-SHOP', source: 'shopify', customer: '+201017788221', finalStatus: 'pending_review', daysOld: 0, lines: [{ sku: 'NRA-SER-01', qty: 1 }, { sku: 'NRA-CRM-02', qty: 2 }] },
  { number: 'DEMO-0018', merchant: 'ATL', store: 'ATL-SHOP', source: 'shopify', customer: '+201121234567', finalStatus: 'pending_review', daysOld: 0, lines: [{ sku: 'ATL-TEE-01-NM', qty: 3 }] },
  { number: 'DEMO-0019', merchant: 'NRA', store: 'NRA-SHOP', source: 'manual', customer: '+201555512345', finalStatus: 'new', daysOld: 0, lines: [{ sku: 'NRA-CRM-02', qty: 1 }] },
  // §4.12 — same customer, same day, same product as 0017. The intake trigger
  // should flag this pair as a possible duplicate.
  { number: 'DEMO-0020', merchant: 'NRA', store: 'NRA-SHOP', source: 'shopify', customer: '+201017788221', finalStatus: 'duplicate_check', daysOld: 0, lines: [{ sku: 'NRA-SER-01', qty: 1 }] },
];

async function seedOrders(
  ctx: SeedContext,
  variantIds: Record<string, string>,
  productIds: Record<string, string>,
  customers: Record<string, string>,
) {
  const { db, companyId, merchants, stores, staff } = ctx;

  const { data: reasonRows } = await db
    .from('cancellation_reasons')
    .select('id, code')
    .eq('company_id', companyId);
  const reasons: Record<string, string> = {};
  for (const row of (reasonRows ?? []) as Row[]) reasons[String(row.code)] = String(row.id);

  const orderIds: Record<string, string> = {};

  for (const plan of ORDER_PLANS) {
    const merchantId = merchants[plan.merchant];
    const customer = CUSTOMERS.find((c) => c.phone === plan.customer);
    if (!merchantId || !customer) continue;

    const orderDate = daysAgo(plan.daysOld);

    // Insert at intake. §4.15 rule 1 refuses a warehouse handover on an order
    // that was never confirmed, so the lifecycle has to be walked.
    const { data, error } = await db
      .from('orders')
      .upsert(
        {
          company_id: companyId,
          merchant_id: merchantId,
          store_id: stores[plan.store] ?? null,
          customer_id: customers[plan.customer] ?? null,
          order_number: plan.number,
          external_order_number: plan.source === 'manual' ? null : `#${1000 + Number(plan.number.slice(-4))}`,
          order_date: iso(orderDate),
          source: plan.source,
          status: 'pending_review',
          customer_name: customer.name,
          customer_phone: customer.phone,
          customer_email: `${customer.name.split(' ')[0].toLowerCase()}@example.com`,
          governorate: customer.governorate,
          city: customer.city,
          address: customer.address,
          payment_method: 'cod',
          payment_status: 'pending',
          currency: 'EGP',
          shipping_fees: 45,
          notes: plan.source === 'pos' ? 'Walk-in, asked for delivery' : null,
        },
        { onConflict: 'company_id,order_number' },
      )
      .select('id, order_number');

    fail(`order ${plan.number}`, error);
    const orderId = String((data as Row[])[0].id);
    orderIds[plan.number] = orderId;

    // Lines. Inserted while the order is still pre-warehouse, so the §4.15
    // rule 5 guard does not fire.
    const lineRows = plan.lines
      .map((line, index) => {
        const variantId = variantIds[line.sku];
        if (!variantId) return null;
        const baseSku = line.sku.replace(/-(BS|BM|BL|NM|L|M|D)$/, '');
        const unitPrice = 180 + Math.floor(rand() * 600);
        return {
          order_id: orderId,
          company_id: companyId,
          product_id: productIds[baseSku] ?? null,
          variant_id: variantId,
          sku: line.sku,
          name: line.sku,
          quantity: line.qty,
          unit_price: unitPrice,
          discount: rand() > 0.75 ? 25 : 0,
          position: index,
        };
      })
      .filter(Boolean) as Row[];

    // Replace rather than append, so a re-run does not multiply the basket.
    await db.from('order_items').delete().eq('order_id', orderId);
    if (lineRows.length > 0) {
      fail(`order items ${plan.number}`, (await db.from('order_items').insert(lineRows)).error);
    }

    // Assignment (§4.6).
    if (plan.agent && staff[plan.agent]) {
      await db
        .from('orders')
        .update({
          assigned_to: staff[plan.agent],
          assigned_at: iso(hoursAgo(plan.daysOld * 24 - 2)),
          assignment_method: 'round_robin',
          status: 'assigned',
        })
        .eq('id', orderId);
    }

    // Calls (§4.10). The trigger maintains call_attempts and the timeline.
    await db.from('order_calls').delete().eq('order_id', orderId);
    for (const [index, call] of (plan.calls ?? []).entries()) {
      fail(
        `call ${plan.number}`,
        (
          await db.from('order_calls').insert({
            order_id: orderId,
            company_id: companyId,
            customer_id: customers[plan.customer] ?? null,
            direction: 'outbound',
            attempt_number: index + 1,
            phone: customer.phone,
            started_at: iso(new Date(Date.now() - call.minutesAgo * 60_000)),
            duration_seconds: call.duration ?? 0,
            outcome: call.outcome,
            notes: call.notes ?? null,
            callback_at: call.outcome === 'callback_requested' ? iso(hoursAgo(-6)) : null,
            agent_id: plan.agent ? staff[plan.agent] : null,
          })
        ).error,
      );
    }

    // WhatsApp (§4.9).
    await db.from('order_messages').delete().eq('order_id', orderId);
    if (plan.messages) {
      await db.from('order_messages').insert({
        order_id: orderId,
        company_id: companyId,
        customer_id: customers[plan.customer] ?? null,
        channel: 'whatsapp',
        direction: 'outbound',
        status: 'delivered',
        template_code: 'order_confirmation',
        language: 'ar',
        body: `مرحباً ${customer.name}، نود تأكيد طلبك رقم ${plan.number}.`,
        sent_at: iso(hoursAgo(plan.daysOld * 24)),
        delivered_at: iso(hoursAgo(plan.daysOld * 24 - 1)),
        agent_id: plan.agent ? staff[plan.agent] : null,
      });
    }

    /* ---- Walk to the final state -------------------------------------- */

    if (plan.finalStatus === 'cancelled') {
      await db
        .from('orders')
        .update({
          status: 'cancelled',
          cancellation_reason_id: reasons[plan.cancelReason ?? 'other'] ?? reasons.other,
          cancellation_note: plan.cancelReason === 'other' ? 'Seeded demo cancellation' : null,
          cancelled_by: plan.agent ? staff[plan.agent] : null,
        })
        .eq('id', orderId);
    } else if (plan.finalStatus === 'confirmed' || plan.finalStatus === 'ready_for_warehouse') {
      await db
        .from('orders')
        .update({
          status: 'confirmed',
          confirmed_by: plan.agent ? staff[plan.agent] : null,
          confirmed_at: iso(hoursAgo(plan.daysOld * 24 - 4)),
        })
        .eq('id', orderId);

      if (plan.finalStatus === 'ready_for_warehouse') {
        await db
          .from('orders')
          .update({ status: 'ready_for_warehouse', warehouse_id: ctx.warehouses['WH-CAI-01'] })
          .eq('id', orderId);
      }
    } else if (plan.finalStatus !== 'assigned') {
      await db.from('orders').update({ status: plan.finalStatus }).eq('id', orderId);
    }
  }

  return orderIds;
}

/* ========================================================================== */
/* Phase 4 — Locations, stock and warehouse work (§5)                         */
/* ========================================================================== */

async function seedWarehouseOps(
  ctx: SeedContext,
  variantIds: Record<string, string>,
  productIds: Record<string, string>,
  orderIds: Record<string, string>,
  suppliers: Record<string, string>,
) {
  const { db, companyId, merchants, warehouses, staff } = ctx;

  const mainWh = warehouses['WH-CAI-01'];
  const gizaWh = warehouses['WH-GIZ-02'];

  /* ---- Location hierarchy (§5.2) --------------------------------------- */

  const zones = await upsertMany(
    db,
    'warehouse_locations',
    [
      // `is_pickable` is NOT NULL, so every row states it explicitly.
      { company_id: companyId, warehouse_id: mainWh, parent_id: null, level: 'zone', area: 'storage', code: 'A', name: 'Zone A — Fast movers', sort_order: 1, is_pickable: true },
      { company_id: companyId, warehouse_id: mainWh, parent_id: null, level: 'zone', area: 'storage', code: 'B', name: 'Zone B — Bulk', sort_order: 2, is_pickable: true },
      { company_id: companyId, warehouse_id: mainWh, parent_id: null, level: 'zone', area: 'receiving', code: 'RCV', name: 'Receiving dock', sort_order: 0, is_pickable: false },
      { company_id: companyId, warehouse_id: mainWh, parent_id: null, level: 'zone', area: 'qc', code: 'QC', name: 'QC bench', sort_order: 3, is_pickable: false },
      { company_id: companyId, warehouse_id: mainWh, parent_id: null, level: 'zone', area: 'packing', code: 'PACK', name: 'Packing benches', sort_order: 4, is_pickable: false },
      { company_id: companyId, warehouse_id: mainWh, parent_id: null, level: 'zone', area: 'dispatch', code: 'DSP', name: 'Dispatch staging', sort_order: 5, is_pickable: false },
      { company_id: companyId, warehouse_id: mainWh, parent_id: null, level: 'zone', area: 'damaged', code: 'DMG', name: 'Damaged goods cage', sort_order: 6, is_pickable: false },
      { company_id: companyId, warehouse_id: gizaWh, parent_id: null, level: 'zone', area: 'storage', code: 'G-A', name: 'Giza Zone A', sort_order: 1, is_pickable: true },
    ],
    'warehouse_id,code',
  );

  // Two aisles per storage zone, and four bins per aisle — enough depth that
  // the §5.14 pick path has something to order by.
  const aisleRows: Row[] = [];
  for (const zone of ['A', 'B']) {
    for (const aisle of [1, 2]) {
      aisleRows.push({
        company_id: companyId, warehouse_id: mainWh, parent_id: zones[zone],
        level: 'aisle', area: 'storage', code: `${zone}-${aisle}`,
        name: `Aisle ${zone}${aisle}`, sort_order: aisle, is_pickable: true,
      });
    }
  }
  const aisles = await upsertMany(db, 'warehouse_locations', aisleRows, 'warehouse_id,code');

  const binRows: Row[] = [];
  let binOrder = 0;
  for (const aisleCode of Object.keys(aisles)) {
    for (const bin of [1, 2, 3, 4]) {
      binOrder += 1;
      binRows.push({
        company_id: companyId, warehouse_id: mainWh, parent_id: aisles[aisleCode],
        level: 'bin', area: 'storage', code: `${aisleCode}-${String(bin).padStart(2, '0')}`,
        name: `Bin ${aisleCode}-${bin}`, sort_order: binOrder, max_units: 400, is_pickable: true,
      });
    }
  }
  const bins = await upsertMany(db, 'warehouse_locations', binRows, 'warehouse_id,code');
  const binCodes = Object.keys(bins);

  /* ---- Goods receipt (§5.5–5.7) ---------------------------------------- */

  const receiptRows = [
    {
      company_id: companyId, merchant_id: merchants.NRA, warehouse_id: mainWh,
      supplier_id: suppliers['SUP-COS'] ?? null,
      receipt_number: 'DEMO-GRN-001', status: 'completed',
      purchase_order_number: 'PO-2026-0184', invoice_number: 'INV-LCS-9921',
      received_at: iso(daysAgo(21)), received_by: staff['EMP-013'] ?? null,
      qc_result: 'passed', qc_by: staff['EMP-010'] ?? null, qc_at: iso(daysAgo(21)),
    },
    {
      company_id: companyId, merchant_id: merchants.ATL, warehouse_id: mainWh,
      supplier_id: suppliers['SUP-TEX'] ?? null,
      receipt_number: 'DEMO-GRN-002', status: 'quality_check',
      purchase_order_number: 'PO-2026-0190',
      received_at: iso(daysAgo(2)), received_by: staff['EMP-013'] ?? null,
      qc_result: 'partial', qc_notes: '3 units water-damaged in transit',
    },
  ];

  const receipts = await upsertMany(db, 'goods_receipts', receiptRows, 'company_id,receipt_number', 'receipt_number');

  /* ---- Opening stock, as ledger rows (§5.10) ---------------------------- */

  // Never written to inventory_levels directly: the ledger is authoritative and
  // its trigger maintains the buckets. `ignoreDuplicates` makes a re-run a
  // no-op rather than doubling every balance.
  const ledgerRows: Row[] = [];
  let txn = 0;

  const stockedSkus = Object.keys(variantIds).filter((sku) => sku !== 'HLM-TWL-02');

  for (const sku of stockedSkus) {
    const variantId = variantIds[sku];
    const baseSku = sku.replace(/-(BS|BM|BL|NM|L|M|D)$/, '');
    const productId = productIds[baseSku] ?? null;
    const merchantCode = sku.slice(0, 3);
    const merchantId = merchants[merchantCode];
    if (!merchantId) continue;

    txn += 1;
    // ATL-BTL-03 is seeded at zero so the out-of-stock KPI has a subject.
    const quantity = sku === 'ATL-BTL-03' ? 0 : 40 + Math.floor(rand() * 160);
    if (quantity === 0) continue;

    ledgerRows.push({
      company_id: companyId, merchant_id: merchantId, warehouse_id: mainWh,
      location_id: bins[binCodes[txn % binCodes.length]] ?? null,
      variant_id: variantId, product_id: productId,
      txn_number: `DEMO-INV-${String(txn).padStart(4, '0')}`,
      txn_type: 'receiving', bucket: 'available', quantity,
      reference_type: 'goods_receipt', reference_id: receipts['DEMO-GRN-001'] ?? null,
      reason: 'Opening stock', created_by: staff['EMP-010'] ?? null,
      created_at: iso(daysAgo(21)),
    });
  }

  // A little damaged stock, so the damaged bucket is not uniformly zero.
  for (const sku of ['ATL-TEE-01-BM', 'NRA-CRM-02']) {
    if (!variantIds[sku]) continue;
    txn += 1;
    ledgerRows.push({
      company_id: companyId, merchant_id: merchants[sku.slice(0, 3)], warehouse_id: mainWh,
      location_id: null,
      variant_id: variantIds[sku], product_id: productIds[sku.replace(/-(BM)$/, '')] ?? null,
      txn_number: `DEMO-INV-${String(txn).padStart(4, '0')}`,
      txn_type: 'damage', bucket: 'damaged', quantity: 3,
      reference_type: null, reference_id: null,
      reason: 'Water damage found at QC', created_by: staff['EMP-010'] ?? null,
      created_at: iso(daysAgo(2)),
    });
  }

  fail(
    'inventory ledger',
    (await db.from('inventory_ledger').upsert(ledgerRows, { onConflict: 'txn_number', ignoreDuplicates: true })).error,
  );

  // Reorder points, so the low-stock filter has something to find.
  const { data: levelRows } = await db.from('inventory_levels').select('id').eq('company_id', companyId).limit(6);
  for (const level of (levelRows ?? []) as Row[]) {
    await db.from('inventory_levels').update({ reorder_point: 50 }).eq('id', level.id);
  }

  /* ---- Warehouse tasks (§5.11) ----------------------------------------- */

  const readyOrders = ['DEMO-0001', 'DEMO-0002', 'DEMO-0003', 'DEMO-0004'];
  const taskRows: Row[] = [];
  let taskNo = 0;

  for (const [index, orderNumber] of readyOrders.entries()) {
    const orderId = orderIds[orderNumber];
    if (!orderId) continue;

    // `priority` is NOT NULL, and `due_at`/`receipt_id` appear on the overdue
    // task below — so every row carries the full key set.
    taskNo += 1;
    taskRows.push({
      company_id: companyId, warehouse_id: mainWh,
      task_number: `DEMO-TSK-${String(taskNo).padStart(4, '0')}`,
      task_type: 'picking', status: index < 3 ? 'completed' : 'in_progress',
      priority: index === 0 ? 'high' : 'normal',
      order_id: orderId, receipt_id: null, assigned_to: staff['EMP-008'] ?? null,
      sla_minutes: 60, due_at: null,
      started_at: iso(hoursAgo(30 - index * 4)),
      completed_at: index < 3 ? iso(hoursAgo(29 - index * 4)) : null,
      created_at: iso(hoursAgo(31 - index * 4)),
    });

    taskNo += 1;
    taskRows.push({
      company_id: companyId, warehouse_id: mainWh,
      task_number: `DEMO-TSK-${String(taskNo).padStart(4, '0')}`,
      task_type: 'packing', status: index < 2 ? 'completed' : 'pending',
      priority: 'normal',
      order_id: orderId, receipt_id: null, assigned_to: staff['EMP-009'] ?? null,
      sla_minutes: 30, due_at: null,
      started_at: index < 2 ? iso(hoursAgo(28 - index * 4)) : null,
      completed_at: index < 2 ? iso(hoursAgo(27 - index * 4)) : null,
      created_at: iso(hoursAgo(29 - index * 4)),
    });
  }

  // One deliberately overdue receiving task, so the SLA breach badge appears.
  taskNo += 1;
  taskRows.push({
    company_id: companyId, warehouse_id: gizaWh,
    task_number: `DEMO-TSK-${String(taskNo).padStart(4, '0')}`,
    task_type: 'receiving', status: 'assigned', priority: 'urgent',
    order_id: null, receipt_id: receipts['DEMO-GRN-002'] ?? null,
    assigned_to: staff['EMP-013'] ?? null,
    sla_minutes: 120, due_at: iso(hoursAgo(20)),
    started_at: null, completed_at: null,
    created_at: iso(hoursAgo(26)),
  });

  fail('warehouse tasks', (await db.from('warehouse_tasks').upsert(taskRows, { onConflict: 'company_id,task_number' })).error);

  /* ---- Pick list (§5.12, §5.13) ---------------------------------------- */

  const { data: pickListData, error: pickError } = await db
    .from('pick_lists')
    .upsert(
      {
        company_id: companyId, warehouse_id: mainWh,
        pick_number: 'DEMO-PCK-0001', strategy: 'wave', status: 'completed',
        wave_key: 'Cairo / Bosta / morning dispatch',
        assigned_to: staff['EMP-008'] ?? null,
        started_at: iso(hoursAgo(30)), completed_at: iso(hoursAgo(29)),
      },
      { onConflict: 'company_id,pick_number' },
    )
    .select('id');
  fail('pick list', pickError);
  const pickListId = String((pickListData as Row[])[0].id);

  await db.from('pick_list_items').delete().eq('pick_list_id', pickListId);
  const pickItems: Row[] = [];
  let sequence = 0;
  for (const orderNumber of readyOrders) {
    const orderId = orderIds[orderNumber];
    if (!orderId) continue;
    const { data: lines } = await db.from('order_items').select('id, variant_id, quantity').eq('order_id', orderId);
    for (const line of (lines ?? []) as Row[]) {
      if (!line.variant_id) continue;
      sequence += 1;
      pickItems.push({
        pick_list_id: pickListId, company_id: companyId, order_id: orderId,
        order_item_id: line.id, variant_id: line.variant_id,
        location_id: bins[binCodes[sequence % binCodes.length]] ?? null,
        requested_quantity: line.quantity, picked_quantity: line.quantity,
        pick_sequence: sequence, picked_at: iso(hoursAgo(29)), picked_by: staff['EMP-008'] ?? null,
      });
    }
  }
  if (pickItems.length > 0) {
    fail('pick list items', (await db.from('pick_list_items').insert(pickItems)).error);
  }

  return { bins, receipts };
}

/* ========================================================================== */
/* Phase 5 — Couriers, shipments, returns, COD (§6)                            */
/* ========================================================================== */

async function seedShipping(ctx: SeedContext, orderIds: Record<string, string>, variantIds: Record<string, string>) {
  const { db, companyId, warehouses, staff } = ctx;

  const couriers = await upsertMany(
    db,
    'couriers',
    [
      { company_id: companyId, code: 'BOSTA', name: 'Bosta', provider: 'bosta', phone: '+20 2 3333 1000', tracking_url_template: 'https://bosta.co/tracking/{awb}', cod_fee_percentage: 1.0, cod_fee_flat: 8, settlement_cycle_days: 7, currency: 'EGP' },
      { company_id: companyId, code: 'ARAMEX', name: 'Aramex Egypt', provider: 'aramex', phone: '+20 2 2480 5000', tracking_url_template: 'https://aramex.com/track/{awb}', cod_fee_percentage: 1.5, cod_fee_flat: 6, settlement_cycle_days: 14, currency: 'EGP' },
      { company_id: companyId, code: 'MYLERZ', name: 'Mylerz', provider: 'mylerz', cod_fee_percentage: 0.9, cod_fee_flat: 10, settlement_cycle_days: 7, currency: 'EGP' },
      { company_id: companyId, code: 'INHOUSE', name: 'In-house drivers', provider: 'manual', cod_fee_flat: 0, settlement_cycle_days: 1, currency: 'EGP' },
    ],
    'company_id,code',
  );

  const zoneRows: Row[] = [];
  for (const [code, courierId] of Object.entries(couriers)) {
    for (const gov of ['Cairo', 'Giza', 'Alexandria', 'Dakahlia', 'Sharqia']) {
      zoneRows.push({
        company_id: companyId, courier_id: courierId, governorate: gov, city: null,
        shipping_fee: gov === 'Cairo' || gov === 'Giza' ? 45 : 65,
        return_fee: 25,
        promised_days: gov === 'Cairo' || gov === 'Giza' ? 2 : 4,
        is_active: code !== 'INHOUSE' || gov === 'Cairo',
      });
    }
  }
  fail('courier zones', (await db.from('courier_zones').upsert(zoneRows, { onConflict: 'courier_id,governorate,city' })).error);

  /* ---- Shipments (§6.3) ------------------------------------------------- */

  type ShipmentPlan = {
    number: string;
    order: string;
    courier: string;
    finalStatus: string;
    daysOld: number;
    attempts?: number;
    failure?: string;
  };

  const SHIPMENTS: ShipmentPlan[] = [
    { number: 'DEMO-SHP-0001', order: 'DEMO-0001', courier: 'BOSTA', finalStatus: 'delivered', daysOld: 5 },
    { number: 'DEMO-SHP-0002', order: 'DEMO-0002', courier: 'BOSTA', finalStatus: 'delivered', daysOld: 4 },
    { number: 'DEMO-SHP-0003', order: 'DEMO-0003', courier: 'ARAMEX', finalStatus: 'out_for_delivery', daysOld: 2 },
    { number: 'DEMO-SHP-0004', order: 'DEMO-0004', courier: 'MYLERZ', finalStatus: 'returned_to_warehouse', daysOld: 6, attempts: 3, failure: 'Customer unreachable after three attempts' },
  ];

  const shipmentIds: Record<string, string> = {};

  for (const plan of SHIPMENTS) {
    const orderId = orderIds[plan.order];
    if (!orderId) continue;

    const { data: order } = await db
      .from('orders')
      .select('merchant_id, total, governorate, city')
      .eq('id', orderId)
      .maybeSingle();
    if (!order) continue;

    // Inserted as handed_to_courier first: that is the transition the §6.10
    // trigger watches to open the COD collection. Jumping straight to
    // 'delivered' would silently skip the money.
    const { data, error } = await db
      .from('shipments')
      .upsert(
        {
          company_id: companyId,
          merchant_id: (order as Row).merchant_id,
          order_id: orderId,
          courier_id: couriers[plan.courier],
          warehouse_id: warehouses['WH-CAI-01'],
          shipment_number: plan.number,
          awb: `${plan.courier.slice(0, 3)}${700_000_000 + Math.floor(rand() * 90_000_000)}`,
          status: 'handed_to_courier',
          handed_over_at: iso(daysAgo(plan.daysOld)),
          promised_at: iso(daysAgo(plan.daysOld - 2)),
          governorate: (order as Row).governorate,
          city: (order as Row).city,
          cod_amount: (order as Row).total,
          shipping_fee: 45,
          currency: 'EGP',
          delivery_attempts: plan.attempts ?? 1,
        },
        { onConflict: 'company_id,shipment_number' },
      )
      .select('id, shipment_number');

    fail(`shipment ${plan.number}`, error);
    const shipmentId = String((data as Row[])[0].id);
    shipmentIds[plan.number] = shipmentId;

    if (plan.finalStatus !== 'handed_to_courier') {
      await db
        .from('shipments')
        .update({
          status: plan.finalStatus,
          delivered_at: plan.finalStatus === 'delivered' ? iso(daysAgo(plan.daysOld - 2)) : null,
          returned_at: plan.finalStatus === 'returned_to_warehouse' ? iso(daysAgo(plan.daysOld - 4)) : null,
          failure_reason: plan.failure ?? null,
        })
        .eq('id', shipmentId);
    }
  }

  /* ---- A courier instruction (§6.5) ------------------------------------ */

  if (shipmentIds['DEMO-SHP-0003']) {
    fail(
      'courier instruction',
      (
        await db.from('courier_instructions').upsert(
          {
            company_id: companyId,
            shipment_id: shipmentIds['DEMO-SHP-0003'],
            instruction: 'contact_customer',
            status: 'acknowledged',
            note: 'Customer asked for delivery after 5pm',
            sent_by: staff['EMP-011'] ?? null,
            sent_at: iso(hoursAgo(20)),
            courier_response: 'Noted — assigned to evening route',
          },
          { onConflict: 'id' },
        )
      ).error,
    );
  }

  /* ---- Returns (§6.7, §6.8) -------------------------------------------- */

  const { data: reasonRows } = await db.from('return_reasons').select('id, code').eq('company_id', companyId);
  const returnReasons: Record<string, string> = {};
  for (const row of (reasonRows ?? []) as Row[]) returnReasons[String(row.code)] = String(row.id);

  const returnPlans = [
    { number: 'DEMO-RET-0001', order: 'DEMO-0004', shipment: 'DEMO-SHP-0004', reason: 'customer_absent', isRto: true, status: 'quality_inspection', sku: 'DTL-TEA-01', qty: 3, disposition: 'restock' },
    { number: 'DEMO-RET-0002', order: 'DEMO-0001', shipment: 'DEMO-SHP-0001', reason: 'damaged', isRto: false, status: 'closed', sku: 'NRA-SER-01', qty: 1, disposition: 'destroy' },
  ];

  for (const plan of returnPlans) {
    const orderId = orderIds[plan.order];
    if (!orderId) continue;

    const { data: order } = await db.from('orders').select('merchant_id').eq('id', orderId).maybeSingle();
    if (!order) continue;

    const { data, error } = await db
      .from('returns')
      .upsert(
        {
          company_id: companyId,
          merchant_id: (order as Row).merchant_id,
          order_id: orderId,
          shipment_id: shipmentIds[plan.shipment] ?? null,
          warehouse_id: warehouses['WH-RET-04'] ?? warehouses['WH-CAI-01'],
          return_number: plan.number,
          status: plan.status,
          reason_id: returnReasons[plan.reason] ?? null,
          is_rto: plan.isRto,
          requested_at: iso(daysAgo(3)),
          received_at: iso(daysAgo(2)),
          inspected_at: plan.status === 'closed' ? iso(daysAgo(1)) : null,
          inspected_by: staff['EMP-017'] ?? null,
          inspection_notes: plan.disposition === 'destroy' ? 'Bottle cracked, product leaked' : 'Sealed, resellable',
          currency: 'EGP',
        },
        { onConflict: 'company_id,return_number' },
      )
      .select('id, return_number');

    fail(`return ${plan.number}`, error);
    const returnId = String((data as Row[])[0].id);

    if (variantIds[plan.sku]) {
      await db.from('return_items').delete().eq('return_id', returnId);
      fail(
        `return items ${plan.number}`,
        (
          await db.from('return_items').insert({
            return_id: returnId,
            company_id: companyId,
            variant_id: variantIds[plan.sku],
            quantity: plan.qty,
            condition: plan.disposition === 'destroy' ? 'damaged' : 'sellable',
            packaging_ok: plan.disposition !== 'destroy',
            accessories_ok: true,
            disposition: plan.disposition,
            disposition_at: iso(daysAgo(1)),
            disposition_by: staff['EMP-017'] ?? null,
            // Left unposted on purpose: `apply_return_disposition` is the
            // supported way to move the stock, and running it here would
            // hide that step from anyone exploring the demo.
          })
        ).error,
      );
    }
  }

  /* ---- COD money (§6.10) ------------------------------------------------ */

  // The collections themselves were opened by the shipment trigger; this fills
  // in what actually came back, including one short payment.
  const collectionUpdates: { order: string; collected: number | null; status: string; deductions?: number }[] = [
    { order: 'DEMO-0001', collected: null, status: 'collected' },
    { order: 'DEMO-0002', collected: null, status: 'settled' },
    { order: 'DEMO-0003', collected: null, status: 'pending' },
    { order: 'DEMO-0004', collected: 0, status: 'missing' },
  ];

  for (const update of collectionUpdates) {
    const orderId = orderIds[update.order];
    if (!orderId) continue;

    const { data: collection } = await db
      .from('cod_collections')
      .select('id, expected_amount')
      .eq('order_id', orderId)
      .maybeSingle();
    if (!collection) continue;

    const expected = Number((collection as Row).expected_amount);
    // DEMO-0002 comes back 50 EGP short, so the variance column has a subject.
    const collected =
      update.collected !== null
        ? update.collected
        : update.order === 'DEMO-0002'
          ? expected - 50
          : expected;

    await db
      .from('cod_collections')
      .update({
        status: update.order === 'DEMO-0002' ? 'short' : update.status,
        collected_amount: update.status === 'pending' ? null : collected,
        deductions: update.deductions ?? 0,
        collected_at: update.status === 'pending' ? null : iso(daysAgo(2)),
        transferred_at: update.status === 'settled' ? iso(daysAgo(1)) : null,
        transfer_reference: update.status === 'settled' ? 'BNK-TRF-88213' : null,
      })
      .eq('id', (collection as Row).id);
  }

  /* ---- Courier statement (§6.11) --------------------------------------- */

  const { data: statementData, error: statementError } = await db
    .from('courier_statements')
    .upsert(
      {
        company_id: companyId,
        courier_id: couriers.BOSTA,
        statement_number: 'DEMO-CST-0001',
        status: 'draft',
        period_start: dateOnly(daysAgo(14)),
        period_end: dateOnly(daysAgo(7)),
        declared_total: 0,
        currency: 'EGP',
        notes: 'Weekly Bosta remittance — run Reconcile to match it against our collections.',
      },
      { onConflict: 'company_id,statement_number' },
    )
    .select('id');
  fail('courier statement', statementError);
  const statementId = String((statementData as Row[])[0].id);

  // Statement lines quoting AWBs, including one the system has never seen —
  // that becomes a 'not_found' when reconciliation runs.
  const { data: bostaShipments } = await db
    .from('shipments')
    .select('awb, cod_amount')
    .eq('courier_id', couriers.BOSTA)
    .not('awb', 'is', null);

  await db.from('courier_statement_lines').delete().eq('statement_id', statementId);

  const statementLines: Row[] = ((bostaShipments ?? []) as Row[]).map((shipment) => ({
    statement_id: statementId,
    company_id: companyId,
    awb: shipment.awb,
    declared_amount: shipment.cod_amount,
    declared_fee: 8,
    match_status: 'unmatched',
    note: null,
  }));

  statementLines.push({
    statement_id: statementId,
    company_id: companyId,
    awb: 'BOS999999999',
    declared_amount: 512,
    declared_fee: 8,
    match_status: 'unmatched',
    note: 'AWB we have no shipment for — should reconcile as not_found',
  });

  if (statementLines.length > 0) {
    fail('statement lines', (await db.from('courier_statement_lines').insert(statementLines)).error);
    const declared = statementLines.reduce((sum, line) => sum + Number(line.declared_amount ?? 0), 0);
    await db.from('courier_statements').update({ declared_total: declared }).eq('id', statementId);
  }

  return { couriers, shipmentIds };
}

/* ========================================================================== */
/* Phase 6 — Costs, expenses, settlements, invoices (§7)                      */
/* ========================================================================== */

async function seedFinance(ctx: SeedContext, orderIds: Record<string, string>) {
  const { db, companyId, merchants, warehouses, staff, stores } = ctx;

  /* ---- Order cost lines (§7.3) ----------------------------------------- */

  // The derived lines would normally come from `rebuild_order_costs`; the seed
  // writes an equivalent set directly so profitability has data on first load
  // without needing a permissioned session.
  const costRows: Row[] = [];

  for (const orderId of Object.values(orderIds)) {
    const { data: order } = await db
      .from('orders')
      .select('merchant_id, total, status')
      .eq('id', orderId)
      .maybeSingle();
    if (!order || (order as Row).status === 'cancelled') continue;

    const total = Number((order as Row).total);
    const merchantId = (order as Row).merchant_id;

    costRows.push(
      { company_id: companyId, merchant_id: merchantId, order_id: orderId, category: 'product', cost_type: 'purchase', amount: Math.round(total * 0.38), currency: 'EGP', source: 'catalog', note: 'Rolled up from variant costs' },
      { company_id: companyId, merchant_id: merchantId, order_id: orderId, category: 'operations', cost_type: 'picking', amount: 6, currency: 'EGP', source: 'rate_card' },
      { company_id: companyId, merchant_id: merchantId, order_id: orderId, category: 'operations', cost_type: 'packing', amount: 8, currency: 'EGP', source: 'rate_card' },
      { company_id: companyId, merchant_id: merchantId, order_id: orderId, category: 'operations', cost_type: 'packaging_material', amount: 5, currency: 'EGP', source: 'rate_card' },
      { company_id: companyId, merchant_id: merchantId, order_id: orderId, category: 'shipping', cost_type: 'courier_fee', amount: 45, currency: 'EGP', source: 'courier' },
      { company_id: companyId, merchant_id: merchantId, order_id: orderId, category: 'marketing', cost_type: 'ads_meta', amount: Math.round(total * 0.09), currency: 'EGP', source: 'allocation', note: 'Allocated share of campaign spend' },
      { company_id: companyId, merchant_id: merchantId, order_id: orderId, category: 'other', cost_type: 'payment_gateway', amount: 4, currency: 'EGP', source: 'manual' },
    );
  }

  // No reference_id on these, and the unique constraint treats NULLs as
  // distinct, so clear before writing rather than relying on upsert.
  await db.from('order_costs').delete().eq('company_id', companyId).is('reference_id', null);
  if (costRows.length > 0) {
    fail('order costs', (await db.from('order_costs').insert(costRows)).error);
  }

  /* ---- Marketing spend (§7.4) ------------------------------------------ */

  const marketingRows: Row[] = [];
  const campaigns = [
    { ref: 'SUMMER-GLOW', name: 'Summer Glow — Nara', merchant: 'NRA', store: 'NRA-SHOP', platform: 'meta' },
    { ref: 'ACTIVE-Q3', name: 'Active Q3 — Atlas', merchant: 'ATL', store: 'ATL-SHOP', platform: 'google' },
    { ref: 'RAMADAN-TEA', name: 'Tea Ritual', merchant: 'DTL', store: 'DTL-WOO', platform: 'tiktok' },
  ];

  for (const campaign of campaigns) {
    for (let day = 1; day <= 14; day += 1) {
      marketingRows.push({
        company_id: companyId,
        merchant_id: merchants[campaign.merchant],
        store_id: stores[campaign.store] ?? null,
        platform: campaign.platform,
        campaign_ref: campaign.ref,
        campaign_name: campaign.name,
        spent_on: dateOnly(daysAgo(day)),
        amount: 400 + Math.floor(rand() * 1_800),
        currency: 'EGP',
        external_id: `${campaign.ref}-${dateOnly(daysAgo(day))}`,
      });
    }
  }

  // The unique index on (company_id, platform, external_id) is *partial* —
  // `where external_id is not null` — and ON CONFLICT cannot infer a partial
  // index from a column list. Clear the imported rows and rewrite instead.
  await db.from('marketing_expenses').delete().eq('company_id', companyId).not('external_id', 'is', null);
  fail('marketing expenses', (await db.from('marketing_expenses').insert(marketingRows)).error);

  /* ---- Operating expenses (§7.10) -------------------------------------- */

  // §7.10 categories are normally provisioned by migration 0019. If that
  // migration has not been applied, provision them here rather than failing —
  // §7.12 rule 4 makes category_id NOT NULL, so there is no seeding without it.
  let { data: categoryRows } = await db.from('expense_categories').select('id, code').eq('company_id', companyId);

  if (!categoryRows || categoryRows.length === 0) {
    console.log('  ! expense_categories was empty — provisioning it (migration 0019 has not been applied)');
    await db.from('expense_categories').insert(
      [
        ['warehouse_rent', 'Warehouse rent', 'إيجار المخزن', true, 1],
        ['salaries', 'Salaries', 'رواتب الموظفين', false, 2],
        ['electricity', 'Electricity', 'الكهرباء', false, 3],
        ['internet', 'Internet', 'الإنترنت', false, 4],
        ['packaging', 'Packaging', 'مواد التغليف', true, 5],
        ['maintenance', 'Equipment maintenance', 'صيانة المعدات', false, 6],
        ['fuel', 'Fuel', 'الوقود', true, 7],
        ['internal_transport', 'Internal transport', 'الشحن الداخلي', true, 8],
        ['software', 'Software & subscriptions', 'البرامج والاشتراكات', false, 9],
        ['other', 'Other expense', 'مصروف آخر', false, 10],
      ].map(([code, nameEn, nameAr, isDirect, order]) => ({
        company_id: companyId,
        code,
        name_en: nameEn,
        name_ar: nameAr,
        is_direct: isDirect,
        sort_order: order,
        is_active: true,
      })),
    );

    ({ data: categoryRows } = await db.from('expense_categories').select('id, code').eq('company_id', companyId));
  }

  const expenseCategories: Record<string, string> = {};
  for (const row of (categoryRows ?? []) as Row[]) expenseCategories[String(row.code)] = String(row.id);

  const expensePlans = [
    { number: 'DEMO-EXP-0001', category: 'warehouse_rent', description: 'Cairo DC monthly rent', amount: 185_000, status: 'paid', daysAgo: 25 },
    { number: 'DEMO-EXP-0002', category: 'salaries', description: 'Warehouse payroll — July', amount: 312_000, status: 'approved', daysAgo: 22 },
    { number: 'DEMO-EXP-0003', category: 'electricity', description: 'Utilities — Cairo DC', amount: 24_500, status: 'approved', daysAgo: 20 },
    { number: 'DEMO-EXP-0004', category: 'packaging', description: 'Cartons and mailers restock', amount: 41_200, status: 'submitted', daysAgo: 6 },
    { number: 'DEMO-EXP-0005', category: 'fuel', description: 'In-house van fuel', amount: 9_800, status: 'submitted', daysAgo: 4 },
    { number: 'DEMO-EXP-0006', category: 'software', description: 'SaaS subscriptions', amount: 13_400, status: 'draft', daysAgo: 2 },
    { number: 'DEMO-EXP-0007', category: 'maintenance', description: 'Forklift service', amount: 7_600, status: 'rejected', daysAgo: 12 },
  ];

  const expenseRows = expensePlans.map((plan) => ({
    company_id: companyId,
    warehouse_id: warehouses['WH-CAI-01'],
    category_id: expenseCategories[plan.category] ?? expenseCategories.other,
    expense_number: plan.number,
    status: plan.status,
    description: plan.description,
    incurred_on: dateOnly(daysAgo(plan.daysAgo)),
    amount: plan.amount,
    currency: 'EGP',
    // §2.7.4 — submitter and approver are deliberately different people, or the
    // trigger refuses the row.
    submitted_by: staff['EMP-007'] ?? null,
    submitted_at: iso(daysAgo(plan.daysAgo)),
    approved_by: ['approved', 'paid'].includes(plan.status) ? (staff['EMP-002'] ?? null) : null,
    approved_at: ['approved', 'paid'].includes(plan.status) ? iso(daysAgo(plan.daysAgo - 1)) : null,
    rejection_note: plan.status === 'rejected' ? 'Use the annual maintenance contract instead' : null,
    paid_at: plan.status === 'paid' ? iso(daysAgo(plan.daysAgo - 3)) : null,
    created_by: staff['EMP-007'] ?? null,
  }));

  fail('operating expenses', (await db.from('operating_expenses').upsert(expenseRows, { onConflict: 'company_id,expense_number' })).error);

  /* ---- Merchant settlements (§7.7) ------------------------------------- */

  const settlementRows = [
    {
      company_id: companyId, merchant_id: merchants.NRA,
      settlement_number: 'DEMO-MST-0001', status: 'draft', cycle: 'weekly',
      period_start: dateOnly(daysAgo(14)), period_end: dateOnly(daysAgo(8)),
      currency: 'EGP', created_by: staff['EMP-012'] ?? null,
      notes: 'Run Calculate to build this from the period’s orders.',
    },
    {
      company_id: companyId, merchant_id: merchants.ATL,
      settlement_number: 'DEMO-MST-0002', status: 'draft', cycle: 'monthly',
      period_start: dateOnly(daysAgo(37)), period_end: dateOnly(daysAgo(8)),
      currency: 'EGP', created_by: staff['EMP-012'] ?? null,
    },
  ];

  fail(
    'merchant settlements',
    (await db.from('merchant_settlements').upsert(settlementRows, { onConflict: 'merchant_id,period_start,period_end' })).error,
  );

  /* ---- Invoices (§7.8) -------------------------------------------------- */

  const invoicePlans = [
    { number: 'DEMO-INV-0001', merchant: 'NRA', status: 'paid', daysAgo: 30 },
    { number: 'DEMO-INV-0002', merchant: 'ATL', status: 'approved', daysAgo: 12 },
    { number: 'DEMO-INV-0003', merchant: 'DTL', status: 'draft', daysAgo: 3 },
  ];

  for (const plan of invoicePlans) {
    const { data, error } = await db
      .from('invoices')
      .upsert(
        {
          company_id: companyId,
          merchant_id: merchants[plan.merchant],
          invoice_number: plan.number,
          // Inserted as draft: the trigger locks the amounts once approved, so
          // the lines have to go in first.
          status: 'draft',
          issue_date: dateOnly(daysAgo(plan.daysAgo)),
          due_date: dateOnly(daysAgo(plan.daysAgo - 30)),
          tax_amount: 0,
          currency: 'EGP',
          created_by: staff['EMP-012'] ?? null,
        },
        { onConflict: 'company_id,invoice_number' },
      )
      .select('id');

    fail(`invoice ${plan.number}`, error);
    const invoiceId = String((data as Row[])[0].id);

    await db.from('invoice_lines').delete().eq('invoice_id', invoiceId);
    fail(
      `invoice lines ${plan.number}`,
      (
        await db.from('invoice_lines').insert([
          { invoice_id: invoiceId, company_id: companyId, service: 'storage', description: 'Storage — pallet weeks', quantity: 24, unit_price: 320, position: 0 },
          { invoice_id: invoiceId, company_id: companyId, service: 'picking', description: 'Pick & pack — orders', quantity: 180, unit_price: 14, position: 1 },
          { invoice_id: invoiceId, company_id: companyId, service: 'returns', description: 'Return handling', quantity: 12, unit_price: 22, position: 2 },
        ])
      ).error,
    );

    if (plan.status !== 'draft') {
      await db
        .from('invoices')
        .update({
          status: plan.status,
          approved_by: staff['EMP-002'] ?? null,
          payment_reference: plan.status === 'paid' ? 'BNK-IN-4471' : null,
        })
        .eq('id', invoiceId);
    }
  }

  /* ---- A closed period (§7.12 rule 1) ---------------------------------- */

  // Well before any demo order, so the guard is demonstrable without making
  // the seeded orders uneditable.
  fail(
    'finance period',
    (
      await db.from('finance_periods').upsert(
        {
          company_id: companyId,
          period_start: dateOnly(daysAgo(120)),
          period_end: dateOnly(daysAgo(91)),
          is_closed: true,
          closed_at: iso(daysAgo(88)),
          closed_by: staff['EMP-012'] ?? null,
          notes: 'Closed. Editing costs dated in here needs finance.costs.edit_closed.',
        },
        { onConflict: 'company_id,period_start' },
      )
    ).error,
  );
}

/* ========================================================================== */
/* Phase 7 — Saved filters and export history (§9)                            */
/* ========================================================================== */

async function seedReporting(ctx: SeedContext) {
  const { db, companyId, staff } = ctx;

  const filterRows = [
    { company_id: companyId, user_id: staff['EMP-003'], name: 'Cairo — unconfirmed', scope: 'orders', filters: { governorate: 'Cairo', stage: 'confirmation' }, is_default: true },
    { company_id: companyId, user_id: staff['EMP-002'], name: 'This week, all merchants', scope: 'orders', filters: { range: 'last_7_days' }, is_default: true },
    { company_id: companyId, user_id: staff['EMP-012'], name: 'Unsettled COD', scope: 'collections', filters: { status: 'pending' }, is_default: true },
  ].filter((row) => row.user_id);

  fail('saved filters', (await db.from('saved_filters').upsert(filterRows, { onConflict: 'user_id,scope,name' })).error);

  // A little export history, so §9.19's audit trail is not empty on first look.
  const { data: reports } = await db
    .from('report_definitions')
    .select('id, code')
    .in('code', ['orders_by_day', 'outstanding_cod', 'courier_performance']);

  const runRows = ((reports ?? []) as Row[]).map((report, index) => ({
    company_id: companyId,
    report_id: report.id,
    report_code: report.code,
    format: index === 0 ? 'excel' : index === 1 ? 'csv' : 'pdf',
    filters: { range: 'last_30_days' },
    row_count: 40 + Math.floor(rand() * 400),
    duration_ms: 120 + Math.floor(rand() * 900),
    status: 'success',
    run_by: staff['EMP-016'] ?? staff['EMP-002'] ?? null,
    created_at: iso(hoursAgo(index * 9 + 3)),
  }));

  if (runRows.length > 0) {
    // No natural key; clear the demo history before rewriting it.
    await db.from('report_runs').delete().eq('company_id', companyId);
    fail('report runs', (await db.from('report_runs').insert(runRows)).error);
  }
}

/* ========================================================================== */

export async function seedOperations(ctx: SeedContext) {
  const catalog = await seedCatalog(ctx);
  console.log(`✓ products          ${Object.keys(catalog.productIds).length} (${Object.keys(catalog.variantIds).length} variants)`);

  const customers = await seedCustomers(ctx);
  console.log(`✓ customers         ${Object.keys(customers).length}`);

  const orderIds = await seedOrders(ctx, catalog.variantIds, catalog.productIds, customers);
  console.log(`✓ orders            ${Object.keys(orderIds).length}`);

  await seedWarehouseOps(ctx, catalog.variantIds, catalog.productIds, orderIds, catalog.suppliers);
  console.log('✓ warehouse         locations, receipts, stock, tasks, pick list');

  await seedShipping(ctx, orderIds, catalog.variantIds);
  console.log('✓ shipping          couriers, shipments, returns, COD, statement');

  await seedFinance(ctx, orderIds);
  console.log('✓ finance           costs, marketing, expenses, settlements, invoices');

  await seedReporting(ctx);
  console.log('✓ reporting         saved filters, export history');
}
