import 'server-only';

import type {
  ChannelAdapter,
  ChannelContext,
  ChannelCredentials,
  ChannelInventoryLevel,
  ChannelOrder,
  ChannelProduct,
  ConnectionCheck,
  FetchOrdersOptions,
  Page,
  WebhookVerification,
} from '../types';
import type { SyncEntity } from '@/lib/supabase/database.types';
import { hmacBase64, safeCompare } from '../crypto';
import { mapShopifyOrder, mapShopifyProduct, type ShopifyOrderNode, type ShopifyProductNode } from './mapping';

const DEFAULT_API_VERSION = '2025-01';

/**
 * Shopify Admin API adapter.
 *
 * Complete and ready — it is not waiting on any code, only on credentials.
 * Until a Partner app exists, stores stay on `provider = 'mock'`; flipping the
 * column and storing an access token is the whole switch-over.
 *
 * Uses the GraphQL Admin API because REST is being phased out for new public
 * apps and GraphQL lets us fetch an order with its customer, addresses and line
 * items in one round trip instead of four.
 */
export class ShopifyChannelAdapter implements ChannelAdapter {
  readonly id = 'shopify' as const;

  readonly supports: ReadonlySet<SyncEntity> = new Set<SyncEntity>([
    'orders',
    'customers',
    'products',
    'variants',
    'prices',
    'inventory',
    'discounts',
    'cancellations',
    'payment_status',
    'fulfillment_status',
    'returns',
    'tracking_numbers',
    'taxes',
    'addresses',
  ]);

  private apiVersion(): string {
    return process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION;
  }

  private endpoint(shopDomain: string): string {
    return `https://${shopDomain}/admin/api/${this.apiVersion()}/graphql.json`;
  }

  /**
   * Executes a GraphQL request.
   *
   * Shopify signals throttling with HTTP 429 and with `errors[].extensions.code
   * = THROTTLED` on a 200 response, so both paths retry with backoff. Without
   * this a bulk historical sync stalls partway through and leaves the store in
   * a partially-synced state.
   */
  private async graphql<T>(
    ctx: ChannelContext,
    query: string,
    variables: Record<string, unknown> = {},
    attempt = 0,
  ): Promise<T> {
    const { shopDomain, accessToken } = ctx.credentials;
    if (!shopDomain || !accessToken) {
      throw new Error(`Store ${ctx.storeId} has no Shopify credentials. Connect the store first.`);
    }

    const response = await fetch(this.endpoint(shopDomain), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    });

    if (response.status === 429 || response.status >= 500) {
      if (attempt >= 4) {
        throw new Error(`Shopify request failed after ${attempt + 1} attempts (HTTP ${response.status}).`);
      }
      const retryAfter = Number(response.headers.get('retry-after')) || 2 ** attempt;
      await sleep(retryAfter * 1000);
      return this.graphql<T>(ctx, query, variables, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Shopify request failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
    }

    const json = (await response.json()) as {
      data?: T;
      errors?: { message: string; extensions?: { code?: string } }[];
    };

    if (json.errors?.length) {
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < 4) {
        await sleep(2 ** attempt * 1000);
        return this.graphql<T>(ctx, query, variables, attempt + 1);
      }
      throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
    }

    if (!json.data) throw new Error('Shopify returned an empty response body.');
    return json.data;
  }

  async checkConnection(ctx: ChannelContext): Promise<ConnectionCheck> {
    try {
      const data = await this.graphql<{ shop: { name: string; myshopifyDomain: string } }>(
        ctx,
        `query { shop { name myshopifyDomain } }`,
      );
      return { ok: true, shopName: data.shop.name };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Connection failed.' };
    }
  }

  async fetchOrders(ctx: ChannelContext, options: FetchOrdersOptions): Promise<Page<ChannelOrder>> {
    const limit = Math.min(options.limit ?? 50, 250);
    const filter = options.updatedSince ? `updated_at:>='${options.updatedSince}'` : null;

    const data = await this.graphql<{
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ShopifyOrderNode[];
      };
    }>(ctx, ORDERS_QUERY, { first: limit, after: options.cursor ?? null, query: filter });

    return {
      items: data.orders.nodes.map(mapShopifyOrder),
      nextCursor: data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null,
    };
  }

  async fetchOrder(ctx: ChannelContext, externalId: string): Promise<ChannelOrder | null> {
    const gid = externalId.startsWith('gid://') ? externalId : `gid://shopify/Order/${externalId}`;
    const data = await this.graphql<{ order: ShopifyOrderNode | null }>(ctx, ORDER_QUERY, { id: gid });
    return data.order ? mapShopifyOrder(data.order) : null;
  }

  async fetchProducts(ctx: ChannelContext, options: FetchOrdersOptions): Promise<Page<ChannelProduct>> {
    const limit = Math.min(options.limit ?? 50, 250);
    const filter = options.updatedSince ? `updated_at:>='${options.updatedSince}'` : null;

    const data = await this.graphql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ShopifyProductNode[];
      };
    }>(ctx, PRODUCTS_QUERY, { first: limit, after: options.cursor ?? null, query: filter });

    return {
      items: data.products.nodes.map(mapShopifyProduct),
      nextCursor: data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null,
    };
  }

  async fetchInventoryLevels(
    ctx: ChannelContext,
    options: FetchOrdersOptions,
  ): Promise<Page<ChannelInventoryLevel>> {
    const page = await this.fetchProducts(ctx, options);
    const items = page.items.flatMap((product) =>
      product.variants.map((variant) => ({
        externalVariantId: variant.externalId,
        sku: variant.sku,
        externalLocationId: null,
        available: variant.inventoryQuantity ?? 0,
      })),
    );
    return { items, nextCursor: page.nextCursor };
  }

  async pushInventoryLevel(ctx: ChannelContext, level: ChannelInventoryLevel): Promise<void> {
    if (!level.externalLocationId) {
      throw new Error('Shopify inventory updates require a location id.');
    }

    await this.graphql(ctx, INVENTORY_SET_MUTATION, {
      input: {
        reason: 'correction',
        setQuantities: [
          {
            inventoryItemId: level.externalVariantId,
            locationId: level.externalLocationId,
            quantity: level.available,
          },
        ],
      },
    });
  }

  async pushFulfillment(
    ctx: ChannelContext,
    externalOrderId: string,
    trackingNumber: string,
    courierName: string,
  ): Promise<void> {
    const gid = externalOrderId.startsWith('gid://')
      ? externalOrderId
      : `gid://shopify/Order/${externalOrderId}`;

    // Shopify fulfils against fulfillment orders, not the order itself.
    const data = await this.graphql<{
      order: { fulfillmentOrders: { nodes: { id: string }[] } } | null;
    }>(ctx, FULFILLMENT_ORDERS_QUERY, { id: gid });

    const fulfillmentOrderIds = data.order?.fulfillmentOrders.nodes.map((n) => n.id) ?? [];
    if (fulfillmentOrderIds.length === 0) return;

    await this.graphql(ctx, FULFILLMENT_CREATE_MUTATION, {
      fulfillment: {
        lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((id) => ({ fulfillmentOrderId: id })),
        trackingInfo: { number: trackingNumber, company: courierName },
        notifyCustomer: false,
      },
    });
  }

  /**
   * Verifies the `X-Shopify-Hmac-Sha256` header against the app's webhook
   * secret, over the exact raw body.
   *
   * Two details matter and are easy to get wrong:
   *  - the digest must be computed over the *unparsed* body; re-serializing
   *    JSON changes byte order and breaks the signature;
   *  - the comparison must be constant time, otherwise the correct digest can
   *    be recovered a byte at a time.
   */
  verifyWebhook(rawBody: string, headers: Headers, credentials: ChannelCredentials): WebhookVerification {
    const providedHmac = headers.get('x-shopify-hmac-sha256');
    if (!providedHmac) return { valid: false, reason: 'Missing X-Shopify-Hmac-Sha256 header.' };

    const secret = credentials.webhookSecret ?? process.env.SHOPIFY_API_SECRET;
    if (!secret) return { valid: false, reason: 'No webhook secret configured for this store.' };

    const expected = hmacBase64(secret, rawBody);
    if (!safeCompare(expected, providedHmac)) {
      return { valid: false, reason: 'HMAC signature mismatch.' };
    }

    try {
      return {
        valid: true,
        topic: headers.get('x-shopify-topic') ?? 'unknown',
        payload: JSON.parse(rawBody),
      };
    } catch {
      return { valid: false, reason: 'Signature valid but body is not valid JSON.' };
    }
  }

  /**
   * Webhook payloads use the REST shape, not GraphQL — different field names
   * entirely — so they get their own narrow mapping.
   */
  parseOrderWebhook(payload: unknown): ChannelOrder | null {
    if (!payload || typeof payload !== 'object') return null;
    const o = payload as Record<string, unknown>;
    if (o.id == null) return null;

    const currency = String(o.currency ?? o.presentment_currency ?? 'EGP');
    const num = (v: unknown) => Number(v ?? 0) || 0;
    const money = (v: unknown) => ({ amount: num(v), currency });

    const rawLines = Array.isArray(o.line_items) ? (o.line_items as Record<string, unknown>[]) : [];
    const lineItems = rawLines.map((li) => ({
      externalId: String(li.id ?? ''),
      externalProductId: li.product_id != null ? String(li.product_id) : null,
      externalVariantId: li.variant_id != null ? String(li.variant_id) : null,
      sku: (li.sku as string) || null,
      title: String(li.title ?? ''),
      variantTitle: (li.variant_title as string) || null,
      quantity: num(li.quantity),
      unitPrice: money(li.price),
      discount: money(li.total_discount),
      total: money(num(li.price) * num(li.quantity) - num(li.total_discount)),
      requiresShipping: li.requires_shipping !== false,
    }));

    const address = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return null;
      const a = raw as Record<string, unknown>;
      return {
        name: (a.name as string) || null,
        phone: (a.phone as string) || null,
        country: (a.country as string) || null,
        region: (a.province as string) || null,
        city: (a.city as string) || null,
        address1: (a.address1 as string) || null,
        address2: (a.address2 as string) || null,
        postalCode: (a.zip as string) || null,
        latitude: a.latitude != null ? Number(a.latitude) : null,
        longitude: a.longitude != null ? Number(a.longitude) : null,
      };
    };

    const customerRaw = o.customer as Record<string, unknown> | undefined;
    const financialStatus = String(o.financial_status ?? 'unknown');
    const fulfillmentStatus = o.fulfillment_status ? String(o.fulfillment_status) : 'unfulfilled';

    const total = num(o.total_price);
    const gateway = String(o.gateway ?? '');
    const isCod = /cash on delivery|cod/i.test(gateway);

    return {
      externalId: String(o.id),
      externalNumber: String(o.name ?? o.order_number ?? o.id),
      createdAt: String(o.created_at ?? new Date().toISOString()),
      updatedAt: String(o.updated_at ?? o.created_at ?? new Date().toISOString()),
      cancelledAt: o.cancelled_at ? String(o.cancelled_at) : null,
      currency,

      customer: customerRaw
        ? {
            externalId: customerRaw.id != null ? String(customerRaw.id) : null,
            firstName: (customerRaw.first_name as string) || null,
            lastName: (customerRaw.last_name as string) || null,
            email: (customerRaw.email as string) || null,
            phone: (customerRaw.phone as string) || (o.phone as string) || null,
            ordersCount: customerRaw.orders_count != null ? num(customerRaw.orders_count) : null,
            totalSpent: customerRaw.total_spent != null ? money(customerRaw.total_spent) : null,
            tags: typeof customerRaw.tags === 'string' ? splitTags(customerRaw.tags) : [],
          }
        : null,

      shippingAddress: address(o.shipping_address),
      billingAddress: address(o.billing_address),
      lineItems,

      subtotal: money(o.subtotal_price),
      shipping: money(sumShipping(o.shipping_lines)),
      tax: money(o.total_tax),
      discount: money(o.total_discounts),
      total: money(o.total_price),

      codAmount: isCod ? money(total) : null,
      paymentMethod: gateway || null,
      paymentStatus: normalizeFinancialStatus(financialStatus),
      fulfillmentStatus: normalizeFulfillmentStatus(fulfillmentStatus),

      tags: typeof o.tags === 'string' ? splitTags(o.tags) : [],
      note: (o.note as string) || null,
      sourceName: (o.source_name as string) || null,
      landingSite: (o.landing_site as string) || null,
      referringSite: (o.referring_site as string) || null,

      raw: payload,
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitTags(tags: string): string[] {
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function sumShipping(lines: unknown): number {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((sum: number, line) => {
    const l = line as Record<string, unknown>;
    return sum + (Number(l.price ?? 0) || 0);
  }, 0);
}

function normalizeFinancialStatus(status: string): ChannelOrder['paymentStatus'] {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'partially_paid':
      return 'partially_paid';
    case 'authorized':
      return 'authorized';
    case 'pending':
      return 'pending';
    case 'refunded':
    case 'partially_refunded':
      return 'refunded';
    case 'voided':
      return 'voided';
    default:
      return 'unknown';
  }
}

function normalizeFulfillmentStatus(status: string): ChannelOrder['fulfillmentStatus'] {
  switch (status) {
    case 'fulfilled':
      return 'fulfilled';
    case 'partial':
      return 'partial';
    case 'restocked':
      return 'restocked';
    case 'unfulfilled':
    case 'null':
      return 'unfulfilled';
    default:
      return 'unknown';
  }
}

/* -------------------------------------------------------------------------- */
/* GraphQL documents                                                          */
/* -------------------------------------------------------------------------- */

const ORDER_FIELDS = `
  id
  name
  createdAt
  updatedAt
  cancelledAt
  note
  tags
  sourceName
  landingPageUrl
  referrerUrl
  displayFinancialStatus
  displayFulfillmentStatus
  currentSubtotalPriceSet { shopMoney { amount currencyCode } }
  currentTotalPriceSet    { shopMoney { amount currencyCode } }
  currentTotalTaxSet      { shopMoney { amount currencyCode } }
  currentTotalDiscountsSet{ shopMoney { amount currencyCode } }
  totalShippingPriceSet   { shopMoney { amount currencyCode } }
  paymentGatewayNames
  customer {
    id
    firstName
    lastName
    email
    phone
    numberOfOrders
    amountSpent { amount currencyCode }
    tags
  }
  shippingAddress {
    name phone country province city address1 address2 zip latitude longitude
  }
  billingAddress {
    name phone country province city address1 address2 zip latitude longitude
  }
  lineItems(first: 100) {
    nodes {
      id
      title
      quantity
      sku
      variantTitle
      requiresShipping
      product { id }
      variant { id }
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      discountedTotalSet   { shopMoney { amount currencyCode } }
      totalDiscountSet     { shopMoney { amount currencyCode } }
    }
  }
`;

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ORDER_FIELDS} }
    }
  }
`;

const ORDER_QUERY = `
  query Order($id: ID!) {
    order(id: $id) { ${ORDER_FIELDS} }
  }
`;

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        descriptionHtml
        vendor
        productType
        status
        tags
        createdAt
        updatedAt
        images(first: 10) { nodes { url } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            inventoryQuantity
            price
            compareAtPrice
            selectedOptions { name value }
            inventoryItem { id measurement { weight { value unit } } }
            image { url }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_ORDERS_QUERY = `
  query FulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 10, query: "status:open") { nodes { id } }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `
  mutation FulfillmentCreate($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

const INVENTORY_SET_MUTATION = `
  mutation InventorySet($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { createdAt reason }
      userErrors { field message }
    }
  }
`;
