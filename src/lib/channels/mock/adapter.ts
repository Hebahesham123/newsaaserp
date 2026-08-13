import 'server-only';

import type {
  ChannelAdapter,
  ChannelContext,
  ChannelInventoryLevel,
  ChannelOrder,
  ChannelProduct,
  FetchOrdersOptions,
  Page,
  WebhookVerification,
} from '../types';
import type { SyncEntity } from '@/lib/supabase/database.types';
import { buildMockOrder, buildMockProduct, MOCK_PRODUCT_SEEDS } from './fixtures';

/**
 * Mock channel adapter.
 *
 * Stands in for a real storefront so Phases 3-6 can be built, demonstrated and
 * regression-tested before Shopify credentials exist. It is deterministic:
 * order and product ids derive from the store id and an index, so re-running a
 * sync produces the same records instead of duplicates.
 *
 * It is not a stub — it implements the full ChannelAdapter contract, which is
 * what makes it useful as the counterpart in adapter contract tests. Anything
 * the mock can do, the Shopify adapter is required to do identically.
 */
export class MockChannelAdapter implements ChannelAdapter {
  readonly id = 'mock' as const;

  readonly supports: ReadonlySet<SyncEntity> = new Set<SyncEntity>([
    'orders',
    'customers',
    'products',
    'variants',
    'prices',
    'inventory',
    'cancellations',
    'payment_status',
    'fulfillment_status',
    'tracking_numbers',
    'addresses',
  ]);

  /** How many orders the mock storefront "has". Enough to exercise pagination. */
  private readonly orderCount = 37;

  async checkConnection(ctx: ChannelContext) {
    return {
      ok: true,
      shopName: `Mock storefront (${ctx.storeId.slice(0, 8)})`,
      message: 'Mock provider — no credentials required.',
    };
  }

  async fetchOrders(ctx: ChannelContext, options: FetchOrdersOptions): Promise<Page<ChannelOrder>> {
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

    const items: ChannelOrder[] = [];
    for (let i = safeOffset; i < Math.min(safeOffset + limit, this.orderCount); i += 1) {
      const order = buildMockOrder(ctx.storeId, i);

      // Honour incremental sync so the scheduled path is exercised too.
      if (options.updatedSince && order.updatedAt < options.updatedSince) continue;

      items.push(order);
    }

    const consumed = safeOffset + limit;
    return { items, nextCursor: consumed < this.orderCount ? String(consumed) : null };
  }

  async fetchOrder(ctx: ChannelContext, externalId: string): Promise<ChannelOrder | null> {
    const index = Number.parseInt(externalId.split('-').pop() ?? '', 10);
    if (!Number.isFinite(index) || index < 0 || index >= this.orderCount) return null;
    return buildMockOrder(ctx.storeId, index);
  }

  async fetchProducts(ctx: ChannelContext, options: FetchOrdersOptions): Promise<Page<ChannelProduct>> {
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

    const total = MOCK_PRODUCT_SEEDS.length;
    const items: ChannelProduct[] = [];
    for (let i = safeOffset; i < Math.min(safeOffset + limit, total); i += 1) {
      items.push(buildMockProduct(ctx.storeId, i));
    }

    const consumed = safeOffset + limit;
    return { items, nextCursor: consumed < total ? String(consumed) : null };
  }

  async fetchInventoryLevels(
    ctx: ChannelContext,
    options: FetchOrdersOptions,
  ): Promise<Page<ChannelInventoryLevel>> {
    const { items } = await this.fetchProducts(ctx, { ...options, limit: 100 });
    const levels = items.flatMap((product) =>
      product.variants.map((variant) => ({
        externalVariantId: variant.externalId,
        sku: variant.sku,
        externalLocationId: 'mock-location-1',
        available: variant.inventoryQuantity ?? 0,
      })),
    );
    return { items: levels, nextCursor: null };
  }

  async pushInventoryLevel(): Promise<void> {
    // No remote to write to. Real adapters call the channel API here.
  }

  async pushFulfillment(): Promise<void> {
    // No remote to write to.
  }

  /**
   * Accepts any payload. The mock has no shared secret, and rejecting here
   * would make the webhook simulator useless. Real adapters must verify.
   */
  verifyWebhook(rawBody: string, headers: Headers): WebhookVerification {
    try {
      return {
        valid: true,
        topic: headers.get('x-mock-topic') ?? 'orders/create',
        payload: JSON.parse(rawBody),
      };
    } catch {
      return { valid: false, reason: 'Body is not valid JSON.' };
    }
  }

  parseOrderWebhook(payload: unknown): ChannelOrder | null {
    if (!payload || typeof payload !== 'object') return null;
    const candidate = payload as Partial<ChannelOrder>;
    if (typeof candidate.externalId !== 'string' || !Array.isArray(candidate.lineItems)) return null;
    return candidate as ChannelOrder;
  }
}
