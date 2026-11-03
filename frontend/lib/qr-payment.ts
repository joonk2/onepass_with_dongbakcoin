import type { Merchant } from './api'

export const QR_PAY_PATH = '/pay'

export function buildMerchantPayUrl(origin: string, merchantId: string): string {
  const url = new URL(QR_PAY_PATH, origin)
  url.searchParams.set('merchant_id', merchantId)
  return url.toString()
}

export function merchantIdFromSearch(search: string): string | null {
  const merchantId = new URLSearchParams(search).get('merchant_id')?.trim()
  return merchantId ? merchantId : null
}

function merchantIdFromValue(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    try {
      const payload: unknown = JSON.parse(trimmed)
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'merchant_id' in payload &&
        typeof payload.merchant_id === 'string'
      ) {
        return payload.merchant_id
      }
    } catch {
      return null
    }
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'dongbaek:' && url.hostname === 'pay') {
      return url.searchParams.get('merchant_id')
    }
    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.pathname.replace(/\/+$/, '') === QR_PAY_PATH
    ) {
      return merchantIdFromSearch(url.search)
    }
    return null
  } catch {
    return trimmed
  }
}

export function resolveQrMerchant(
  value: string,
  merchants: readonly Merchant[],
): Merchant | null {
  const merchantId = merchantIdFromValue(value)
  if (!merchantId) return null
  return merchants.find((merchant) => merchant.merchant_id === merchantId) ?? null
}
