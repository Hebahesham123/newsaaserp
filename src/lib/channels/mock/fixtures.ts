import type { ChannelOrder, ChannelProduct, ChannelLineItem } from '../types';

/**
 * Deterministic fixtures for the mock channel.
 *
 * Everything derives from (storeId, index) through a small hash, so a sync run
 * twice yields identical records rather than duplicates — which is what makes
 * the mock usable for idempotency tests as well as demos.
 */

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(list: readonly T[], seed: string): T {
  return list[hash(seed) % list.length];
}

const GOVERNORATES = [
  'Cairo',
  'Giza',
  'Alexandria',
  'Dakahlia',
  'Sharqia',
  'Qalyubia',
  'Beheira',
  'Gharbia',
] as const;

const CITIES = ['Nasr City', 'Maadi', 'Heliopolis', 'Dokki', 'Zamalek', 'Shubra', 'Smouha'] as const;

const FIRST_NAMES = ['Ahmed', 'Mona', 'Youssef', 'Salma', 'Omar', 'Nour', 'Karim', 'Hana'] as const;
const LAST_NAMES = ['Hassan', 'Ibrahim', 'Mahmoud', 'Fathy', 'Saleh', 'Abdel Aziz', 'Rashad'] as const;

const PAYMENT_METHODS = ['cash_on_delivery', 'card', 'wallet'] as const;

export const MOCK_PRODUCT_SEEDS = [
  { title: 'Classic Cotton T-Shirt', type: 'Apparel', colors: ['Black', 'White', 'Navy'], sizes: ['S', 'M', 'L', 'XL'], price: 349 },
  { title: 'Slim Fit Chinos', type: 'Apparel', colors: ['Beige', 'Olive'], sizes: ['30', '32', '34', '36'], price: 699 },
  { title: 'Leather Crossbody Bag', type: 'Accessories', colors: ['Tan', 'Black'], sizes: ['One Size'], price: 1250 },
  { title: 'Running Sneakers', type: 'Footwear', colors: ['Grey', 'Blue'], sizes: ['40', '41', '42', '43'], price: 1899 },
  { title: 'Vitamin C Serum 30ml', type: 'Beauty', colors: ['—'], sizes: ['30ml'], price: 545 },
  { title: 'Stainless Steel Water Bottle', type: 'Home', colors: ['Silver', 'Matte Black'], sizes: ['750ml'], price: 420 },
  { title: 'Wireless Earbuds', type: 'Electronics', colors: ['White', 'Black'], sizes: ['One Size'], price: 2450 },
  { title: 'Oversized Hoodie', type: 'Apparel', colors: ['Charcoal', 'Cream'], sizes: ['M', 'L', 'XL'], price: 890 },
] as const;

function money(amount: number, currency = 'EGP') {
  return { amount: Math.round(amount * 100) / 100, currency };
}

export function buildMockProduct(storeId: string, index: number): ChannelProduct {
  const seed = MOCK_PRODUCT_SEEDS[index % MOCK_PRODUCT_SEEDS.length];
  const externalId = `mock-product-${storeId.slice(0, 8)}-${index}`;

  const variants = seed.colors.flatMap((color) =>
    seed.sizes.map((size) => {
      const variantSeed = `${externalId}-${color}-${size}`;
      return {
        externalId: `mock-variant-${hash(variantSeed)}`,
        sku: `MCK-${index}-${color.slice(0, 2).toUpperCase()}-${size}`.replace(/\s/g, ''),
        barcode: String(6000000000000 + (hash(variantSeed) % 999999999)),
        title: `${color} / ${size}`,
        price: money(seed.price),
        compareAtPrice: index % 3 === 0 ? money(seed.price * 1.25) : null,
        inventoryQuantity: 10 + (hash(variantSeed) % 90),
        weightGrams: 200 + (hash(variantSeed) % 800),
        options: { Color: color, Size: size },
        imageUrl: null,
      };
    }),
  );

  return {
    externalId,
    title: seed.title,
    description: `${seed.title} — mock catalogue item for pipeline testing.`,
    vendor: 'Mock Vendor',
    productType: seed.type,
    status: 'active',
    tags: [seed.type.toLowerCase()],
    images: [],
    variants,
    createdAt: new Date(Date.UTC(2026, 0, 1 + (index % 28))).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 5, 1 + (index % 28))).toISOString(),
    raw: { provider: 'mock', seedIndex: index },
  };
}

export function buildMockOrder(storeId: string, index: number): ChannelOrder {
  const externalId = `mock-order-${storeId.slice(0, 8)}-${index}`;
  const seed = `${storeId}:${index}`;

  const product = buildMockProduct(storeId, index % MOCK_PRODUCT_SEEDS.length);
  const lineCount = 1 + (hash(`${seed}:lines`) % 3);

  const lineItems: ChannelLineItem[] = [];
  for (let i = 0; i < lineCount; i += 1) {
    const variant = product.variants[hash(`${seed}:v${i}`) % product.variants.length];
    const quantity = 1 + (hash(`${seed}:q${i}`) % 3);
    const lineTotal = variant.price.amount * quantity;

    lineItems.push({
      externalId: `${externalId}-line-${i}`,
      externalProductId: product.externalId,
      externalVariantId: variant.externalId,
      sku: variant.sku,
      title: product.title,
      variantTitle: variant.title,
      quantity,
      unitPrice: variant.price,
      discount: null,
      total: money(lineTotal),
      requiresShipping: true,
    });
  }

  const subtotal = lineItems.reduce((sum, line) => sum + line.total.amount, 0);
  const shipping = 60;
  const discount = index % 5 === 0 ? Math.round(subtotal * 0.1) : 0;
  const total = subtotal + shipping - discount;

  const paymentMethod = pick(PAYMENT_METHODS, `${seed}:pay`);
  const isCod = paymentMethod === 'cash_on_delivery';

  const firstName = pick(FIRST_NAMES, `${seed}:fn`);
  const lastName = pick(LAST_NAMES, `${seed}:ln`);
  const governorate = pick(GOVERNORATES, `${seed}:gov`);
  const city = pick(CITIES, `${seed}:city`);
  const phone = `+2010${String(10000000 + (hash(`${seed}:phone`) % 89999999))}`;

  const createdAt = new Date(Date.UTC(2026, 6, 1 + (index % 28), 8 + (index % 12), 15)).toISOString();

  return {
    externalId,
    externalNumber: `#${1000 + index}`,
    createdAt,
    updatedAt: createdAt,
    cancelledAt: null,
    currency: 'EGP',

    customer: {
      externalId: `mock-customer-${hash(`${seed}:cust`)}`,
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.split(' ')[0].toLowerCase()}@example.com`,
      phone,
      ordersCount: 1 + (hash(`${seed}:oc`) % 8),
      totalSpent: money(total * (1 + (hash(`${seed}:ts`) % 5))),
      tags: [],
    },

    shippingAddress: {
      name: `${firstName} ${lastName}`,
      phone,
      country: 'Egypt',
      region: governorate,
      city,
      address1: `${1 + (hash(`${seed}:st`) % 200)} Mock Street`,
      address2: `Apartment ${1 + (hash(`${seed}:apt`) % 30)}`,
      postalCode: null,
      latitude: null,
      longitude: null,
    },
    billingAddress: null,

    lineItems,

    subtotal: money(subtotal),
    shipping: money(shipping),
    tax: money(0),
    discount: money(discount),
    total: money(total),

    codAmount: isCod ? money(total) : null,
    paymentMethod,
    paymentStatus: isCod ? 'pending' : 'paid',
    fulfillmentStatus: 'unfulfilled',

    tags: [],
    note: null,
    sourceName: 'web',
    landingSite: null,
    referringSite: null,

    raw: { provider: 'mock', seedIndex: index },
  };
}
