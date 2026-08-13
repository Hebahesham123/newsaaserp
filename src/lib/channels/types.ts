import type { ChannelProviderId, SyncEntity } from '@/lib/supabase/database.types';

/**
 * Channel adapter contract.
 *
 * Every sales channel in the spec (§1.6, §2.4.1) — Shopify, WooCommerce,
 * Amazon, Noon, custom stores — implements this one interface. Application
 * code never imports a concrete adapter; it resolves one from the store row.
 *
 * The consequence that matters right now: the `mock` adapter satisfies the same
 * contract as `shopify`, so the entire order pipeline in Phase 3 is built and
 * tested before any Shopify credentials exist. Supplying credentials later is a
 * configuration change, not a code change.
 */

export type ChannelMoney = {
  amount: number;
  currency: string;
};

export type ChannelAddress = {
  name: string | null;
  phone: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  address1: string | null;
  address2: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type ChannelCustomer = {
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ordersCount: number | null;
  totalSpent: ChannelMoney | null;
  tags: string[];
};

export type ChannelLineItem = {
  externalId: string;
  externalProductId: string | null;
  externalVariantId: string | null;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: ChannelMoney;
  discount: ChannelMoney | null;
  total: ChannelMoney;
  requiresShipping: boolean;
};

/** Normalized order. Deliberately channel-agnostic — §4.4 Order Information. */
export type ChannelOrder = {
  externalId: string;
  externalNumber: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  currency: string;

  customer: ChannelCustomer | null;
  shippingAddress: ChannelAddress | null;
  billingAddress: ChannelAddress | null;
  lineItems: ChannelLineItem[];

  subtotal: ChannelMoney;
  shipping: ChannelMoney;
  tax: ChannelMoney;
  discount: ChannelMoney;
  total: ChannelMoney;

  /** Cash on delivery amount; the dominant payment method in this market (§4.4). */
  codAmount: ChannelMoney | null;
  paymentMethod: string | null;
  paymentStatus: 'pending' | 'authorized' | 'paid' | 'partially_paid' | 'refunded' | 'voided' | 'unknown';
  fulfillmentStatus: 'unfulfilled' | 'partial' | 'fulfilled' | 'restocked' | 'unknown';

  tags: string[];
  note: string | null;
  /** Marketing attribution, feeding §7.9 campaign profitability. */
  sourceName: string | null;
  landingSite: string | null;
  referringSite: string | null;

  /** Untouched provider payload, retained for troubleshooting and replay. */
  raw: unknown;
};

export type ChannelVariant = {
  externalId: string;
  sku: string | null;
  barcode: string | null;
  title: string;
  price: ChannelMoney;
  compareAtPrice: ChannelMoney | null;
  inventoryQuantity: number | null;
  weightGrams: number | null;
  options: Record<string, string>;
  imageUrl: string | null;
};

export type ChannelProduct = {
  externalId: string;
  title: string;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  status: 'active' | 'draft' | 'archived';
  tags: string[];
  images: string[];
  variants: ChannelVariant[];
  createdAt: string;
  updatedAt: string;
  raw: unknown;
};

export type ChannelInventoryLevel = {
  externalVariantId: string;
  sku: string | null;
  externalLocationId: string | null;
  available: number;
};

/** Cursor pagination; `null` cursor means "no more pages". */
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type FetchOrdersOptions = {
  updatedSince?: string;
  cursor?: string | null;
  limit?: number;
};

export type WebhookVerification =
  | { valid: true; topic: string; payload: unknown }
  | { valid: false; reason: string };

export type ConnectionCheck = {
  ok: boolean;
  shopName?: string;
  message?: string;
};

/** Credentials handed to an adapter. Decrypted immediately before use, never logged. */
export type ChannelCredentials = {
  shopDomain?: string | null;
  accessToken?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
  webhookSecret?: string | null;
};

export type ChannelContext = {
  storeId: string;
  companyId: string;
  merchantId: string;
  credentials: ChannelCredentials;
};

export interface ChannelAdapter {
  readonly id: ChannelProviderId;

  /** Which entities this adapter can synchronize (§2.4.4). */
  readonly supports: ReadonlySet<SyncEntity>;

  /** Cheap round trip proving the credentials work — used by the Connect screen. */
  checkConnection(ctx: ChannelContext): Promise<ConnectionCheck>;

  fetchOrders(ctx: ChannelContext, options: FetchOrdersOptions): Promise<Page<ChannelOrder>>;
  fetchOrder(ctx: ChannelContext, externalId: string): Promise<ChannelOrder | null>;

  fetchProducts(ctx: ChannelContext, options: FetchOrdersOptions): Promise<Page<ChannelProduct>>;
  fetchInventoryLevels(ctx: ChannelContext, options: FetchOrdersOptions): Promise<Page<ChannelInventoryLevel>>;

  /** Push a stock level back to the channel when this system is the master (§3.10). */
  pushInventoryLevel(ctx: ChannelContext, level: ChannelInventoryLevel): Promise<void>;

  /** Mark an order fulfilled on the channel once it ships (§2.4.4 fulfillment statuses). */
  pushFulfillment(
    ctx: ChannelContext,
    externalOrderId: string,
    trackingNumber: string,
    courierName: string,
  ): Promise<void>;

  /** Verifies a webhook's authenticity before anything is written (§2.4.4 real-time webhooks). */
  verifyWebhook(rawBody: string, headers: Headers, credentials: ChannelCredentials): WebhookVerification;

  /** Maps a verified webhook payload onto the normalized order shape. */
  parseOrderWebhook(payload: unknown): ChannelOrder | null;
}
