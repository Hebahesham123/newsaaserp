import type { ChannelOrder, ChannelProduct, ChannelMoney, ChannelAddress } from '../types';

/**
 * Maps Shopify's GraphQL Admin API shapes onto the normalized channel types.
 *
 * Kept apart from the adapter so the mapping can be unit-tested against
 * recorded fixtures without touching the network, and so the webhook (REST)
 * shape and the GraphQL shape stay visibly distinct.
 */

type MoneyBag = { shopMoney: { amount: string; currencyCode: string } } | null | undefined;

type ShopifyAddressNode = {
  name: string | null;
  phone: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  address1: string | null;
  address2: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
} | null;

export type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  note: string | null;
  tags: string[];
  sourceName: string | null;
  landingPageUrl: string | null;
  referrerUrl: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  currentSubtotalPriceSet: MoneyBag;
  currentTotalPriceSet: MoneyBag;
  currentTotalTaxSet: MoneyBag;
  currentTotalDiscountsSet: MoneyBag;
  totalShippingPriceSet: MoneyBag;
  paymentGatewayNames: string[];
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    numberOfOrders: string | null;
    amountSpent: { amount: string; currencyCode: string } | null;
    tags: string[];
  } | null;
  shippingAddress: ShopifyAddressNode;
  billingAddress: ShopifyAddressNode;
  lineItems: {
    nodes: {
      id: string;
      title: string;
      quantity: number;
      sku: string | null;
      variantTitle: string | null;
      requiresShipping: boolean;
      product: { id: string } | null;
      variant: { id: string } | null;
      originalUnitPriceSet: MoneyBag;
      discountedTotalSet: MoneyBag;
      totalDiscountSet: MoneyBag;
    }[];
  };
};

export type ShopifyProductNode = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  status: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  images: { nodes: { url: string }[] };
  variants: {
    nodes: {
      id: string;
      title: string;
      sku: string | null;
      barcode: string | null;
      inventoryQuantity: number | null;
      price: string;
      compareAtPrice: string | null;
      selectedOptions: { name: string; value: string }[];
      inventoryItem: { id: string; measurement: { weight: { value: number; unit: string } | null } | null } | null;
      image: { url: string } | null;
    }[];
  };
};

function money(bag: MoneyBag, fallbackCurrency = 'EGP'): ChannelMoney {
  if (!bag) return { amount: 0, currency: fallbackCurrency };
  return { amount: Number(bag.shopMoney.amount) || 0, currency: bag.shopMoney.currencyCode };
}

function address(node: ShopifyAddressNode): ChannelAddress | null {
  if (!node) return null;
  return {
    name: node.name,
    phone: node.phone,
    country: node.country,
    region: node.province,
    city: node.city,
    address1: node.address1,
    address2: node.address2,
    postalCode: node.zip,
    latitude: node.latitude,
    longitude: node.longitude,
  };
}

function paymentStatus(display: string | null): ChannelOrder['paymentStatus'] {
  switch (display) {
    case 'PAID':
      return 'paid';
    case 'PARTIALLY_PAID':
      return 'partially_paid';
    case 'AUTHORIZED':
      return 'authorized';
    case 'PENDING':
      return 'pending';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'refunded';
    case 'VOIDED':
      return 'voided';
    default:
      return 'unknown';
  }
}

function fulfillmentStatus(display: string | null): ChannelOrder['fulfillmentStatus'] {
  switch (display) {
    case 'FULFILLED':
      return 'fulfilled';
    case 'PARTIALLY_FULFILLED':
      return 'partial';
    case 'RESTOCKED':
      return 'restocked';
    case 'UNFULFILLED':
      return 'unfulfilled';
    default:
      return 'unknown';
  }
}

export function mapShopifyOrder(node: ShopifyOrderNode): ChannelOrder {
  const total = money(node.currentTotalPriceSet);
  const currency = total.currency;

  // Shopify has no first-class COD concept; it surfaces as a gateway name.
  // COD dominates this market (§4.4), so detecting it accurately matters for
  // Phase 5 collections and Phase 6 settlement.
  const gateways = node.paymentGatewayNames ?? [];
  const isCod = gateways.some((g) => /cash on delivery|cod/i.test(g));

  return {
    externalId: node.id,
    externalNumber: node.name,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    cancelledAt: node.cancelledAt,
    currency,

    customer: node.customer
      ? {
          externalId: node.customer.id,
          firstName: node.customer.firstName,
          lastName: node.customer.lastName,
          email: node.customer.email,
          phone: node.customer.phone,
          ordersCount: node.customer.numberOfOrders ? Number(node.customer.numberOfOrders) : null,
          totalSpent: node.customer.amountSpent
            ? {
                amount: Number(node.customer.amountSpent.amount) || 0,
                currency: node.customer.amountSpent.currencyCode,
              }
            : null,
          tags: node.customer.tags ?? [],
        }
      : null,

    shippingAddress: address(node.shippingAddress),
    billingAddress: address(node.billingAddress),

    lineItems: node.lineItems.nodes.map((line) => ({
      externalId: line.id,
      externalProductId: line.product?.id ?? null,
      externalVariantId: line.variant?.id ?? null,
      sku: line.sku,
      title: line.title,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      unitPrice: money(line.originalUnitPriceSet, currency),
      discount: money(line.totalDiscountSet, currency),
      total: money(line.discountedTotalSet, currency),
      requiresShipping: line.requiresShipping,
    })),

    subtotal: money(node.currentSubtotalPriceSet, currency),
    shipping: money(node.totalShippingPriceSet, currency),
    tax: money(node.currentTotalTaxSet, currency),
    discount: money(node.currentTotalDiscountsSet, currency),
    total,

    codAmount: isCod ? total : null,
    paymentMethod: gateways[0] ?? null,
    paymentStatus: paymentStatus(node.displayFinancialStatus),
    fulfillmentStatus: fulfillmentStatus(node.displayFulfillmentStatus),

    tags: node.tags ?? [],
    note: node.note,
    sourceName: node.sourceName,
    landingSite: node.landingPageUrl,
    referringSite: node.referrerUrl,

    raw: node,
  };
}

export function mapShopifyProduct(node: ShopifyProductNode): ChannelProduct {
  return {
    externalId: node.id,
    title: node.title,
    description: node.descriptionHtml,
    vendor: node.vendor,
    productType: node.productType,
    status: node.status === 'ACTIVE' ? 'active' : node.status === 'DRAFT' ? 'draft' : 'archived',
    tags: node.tags ?? [],
    images: node.images.nodes.map((i) => i.url),
    variants: node.variants.nodes.map((variant) => {
      const weight = variant.inventoryItem?.measurement?.weight ?? null;
      return {
        externalId: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        title: variant.title,
        price: { amount: Number(variant.price) || 0, currency: 'EGP' },
        compareAtPrice: variant.compareAtPrice
          ? { amount: Number(variant.compareAtPrice) || 0, currency: 'EGP' }
          : null,
        inventoryQuantity: variant.inventoryQuantity,
        weightGrams: weight ? toGrams(weight.value, weight.unit) : null,
        options: Object.fromEntries(variant.selectedOptions.map((o) => [o.name, o.value])),
        imageUrl: variant.image?.url ?? null,
      };
    }),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    raw: node,
  };
}

function toGrams(value: number, unit: string): number {
  switch (unit) {
    case 'KILOGRAMS':
      return value * 1000;
    case 'POUNDS':
      return value * 453.592;
    case 'OUNCES':
      return value * 28.3495;
    default:
      return value;
  }
}
