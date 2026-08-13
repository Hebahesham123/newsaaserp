import 'server-only';

import type { ChannelAdapter, ChannelContext, ChannelCredentials } from './types';
import type { ChannelProviderId } from '@/lib/supabase/database.types';
import { MockChannelAdapter } from './mock/adapter';
import { ShopifyChannelAdapter } from './shopify/adapter';
import { createAdminSupabase } from '@/lib/supabase/server';
import { tryDecryptCredential } from './crypto';
import { isShopifyConfigured } from '@/lib/env';

const ADAPTERS: Partial<Record<ChannelProviderId, ChannelAdapter>> = {
  mock: new MockChannelAdapter(),
  shopify: new ShopifyChannelAdapter(),
};

export class ChannelNotSupportedError extends Error {
  constructor(provider: string) {
    super(`No channel adapter is registered for provider '${provider}'.`);
    this.name = 'ChannelNotSupportedError';
  }
}

export function getAdapter(provider: ChannelProviderId): ChannelAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new ChannelNotSupportedError(provider);
  return adapter;
}

/**
 * Resolves the adapter and decrypted credentials for a store.
 *
 * Reads `store_credentials` with the service role — that table has no RLS
 * policy for client roles by design, so this is the only path to it.
 *
 * If a store is configured for Shopify but the app-level Shopify credentials
 * are absent, this falls back to the mock adapter rather than throwing. That
 * keeps a half-configured environment usable instead of breaking every screen
 * that touches the store, and the fallback is reported so it is never silent.
 */
export async function resolveChannel(storeId: string): Promise<{
  adapter: ChannelAdapter;
  context: ChannelContext;
  fellBackToMock: boolean;
}> {
  const admin = createAdminSupabase();

  const { data: store, error } = await admin
    .from('stores')
    .select('id, company_id, merchant_id, provider')
    .eq('id', storeId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load store ${storeId}: ${error.message}`);
  if (!store) throw new Error(`Store ${storeId} not found.`);

  const { data: credentialRow } = await admin
    .from('store_credentials')
    .select('*')
    .eq('store_id', storeId)
    .maybeSingle();

  const credentials: ChannelCredentials = {
    shopDomain: credentialRow?.shop_domain ?? null,
    accessToken: tryDecryptCredential(credentialRow?.access_token_enc),
    apiKey: tryDecryptCredential(credentialRow?.api_key_enc),
    apiSecret: tryDecryptCredential(credentialRow?.api_secret_enc),
    webhookSecret: tryDecryptCredential(credentialRow?.webhook_secret_enc),
  };

  let provider = store.provider;
  let fellBackToMock = false;

  if (provider === 'shopify' && (!isShopifyConfigured() || !credentials.accessToken)) {
    provider = 'mock';
    fellBackToMock = true;
  }

  return {
    adapter: getAdapter(provider),
    context: {
      storeId: store.id,
      companyId: store.company_id,
      merchantId: store.merchant_id,
      credentials,
    },
    fellBackToMock,
  };
}
