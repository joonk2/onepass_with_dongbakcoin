export type CatalogProduct = {
  product_id: string
  product_name: string
  issuer: string | null
  card_type: string | null
}

export type CardKind = 'CREDIT' | 'CHECK'

// DB의 card_product 중 등록 화면에 보여줄 상품 ID. 이름·유형은 API 응답만 사용한다.
export const ALLOWED_CARD_PRODUCT_IDS: ReadonlySet<string> = new Set([
  'BNK_CK_P19',
  'BNK_CK_P23',
  'BNK_CR_P07',
  'BNK_CR_P09',
  'BNK_CR_P10',
  'BNK_CR_P16',
])

export function registrableProducts<T extends { product_id: string }>(products: readonly T[]): T[] {
  return products.filter((product) => ALLOWED_CARD_PRODUCT_IDS.has(product.product_id))
}

export const CARD_KIND_LABEL: Record<CardKind, string> = {
  CREDIT: '신용카드',
  CHECK: '체크카드',
}

const ISSUER_LABEL: Record<string, string> = {
  BNK_BUSAN: 'BNK부산은행',
  DONGBAEKJEON: '동백전',
  SHINHAN: '신한카드',
  SAMSUNG: '삼성카드',
  HYUNDAI: '현대카드',
  KB_KOOKMIN: 'KB국민카드',
  WOORI: '우리카드',
  HANA: '하나카드',
  LOTTE: '롯데카드',
  NH_NONGHYUP: 'NH농협카드',
}

export type IssuerTheme = { from: string; to: string; ink: string }

export type ProductPlate = { plate: string; background: string; color: string }

// 실물 플레이트 색과 구성을 카드마다 다르게 맞춘다. 로고 이미지는 쓰지 않는다.
const PRODUCT_PLATES: Record<string, ProductPlate> = {
  BNK_CK_P19: {
    plate: 'bbang',
    background: 'linear-gradient(155deg, #fff8ee 0%, #f6e2c4 58%, #e8c39a 100%)',
    color: '#5c3714',
  },
  BNK_CK_P23: {
    plate: 'green',
    background: 'linear-gradient(150deg, #2f9a55 0%, #146b38 62%, #0c4a28 100%)',
    color: '#f3fff6',
  },
  BNK_CR_P07: {
    plate: 'ding',
    background: 'linear-gradient(160deg, #ffe56b 0%, #f0c400 100%)',
    color: '#1c1c1c',
  },
  BNK_CR_P09: {
    plate: 'pod',
    background: 'linear-gradient(180deg, #fbf8f3 0%, #efeae3 100%)',
    color: '#2a2826',
  },
  BNK_CR_P10: {
    plate: 'oil',
    background: 'linear-gradient(90deg, #1c1c1c 0 76%, #e85d04 76% 88%, #ffb703 88%)',
    color: '#fff8f2',
  },
  BNK_CR_P16: {
    plate: 'zipl',
    background: 'linear-gradient(180deg, #f7fafb 0%, #d7e4e8 100%)',
    color: '#16343c',
  },
}

export function productPlate(productId: string): ProductPlate | null {
  return PRODUCT_PLATES[productId] ?? null
}

// 카드사 로고·실제 카드 이미지는 쓰지 않고 브랜드 계열 색만 사용한다.
const ISSUER_THEME: Record<string, IssuerTheme> = {
  BNK_BUSAN: { from: '#c92e48', to: '#e0637a', ink: '#ffffff' },
  SHINHAN: { from: '#0046ff', to: '#5b8cff', ink: '#ffffff' },
  SAMSUNG: { from: '#1428a0', to: '#4a5fd0', ink: '#ffffff' },
  HYUNDAI: { from: '#111111', to: '#4a4a4a', ink: '#ffffff' },
  KB_KOOKMIN: { from: '#ffbc00', to: '#ffd75e', ink: '#3b2f00' },
  WOORI: { from: '#0067ac', to: '#4aa3dd', ink: '#ffffff' },
  HANA: { from: '#009490', to: '#4cc4bf', ink: '#ffffff' },
  LOTTE: { from: '#ed1c24', to: '#f6767b', ink: '#ffffff' },
  NH_NONGHYUP: { from: '#00a651', to: '#5cd08e', ink: '#ffffff' },
}

const DEFAULT_THEME: IssuerTheme = { from: '#5f6368', to: '#9aa0a6', ink: '#ffffff' }

export const issuerTheme = (issuer: string | null): IssuerTheme =>
  (issuer && ISSUER_THEME[issuer]) || DEFAULT_THEME

export type CardArt = { pattern: number; shade: number }

export const CARD_ART_PATTERNS = 5
export const CARD_ART_SHADES = 3

// product_id로 고정되는 무늬·명암 — 같은 카드사 안에서도 카드마다 다르게 보이도록 한다.
export function cardArtOf(productId: string): CardArt {
  let hash = 0
  for (const char of productId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return {
    pattern: hash % CARD_ART_PATTERNS,
    shade: Math.floor(hash / CARD_ART_PATTERNS) % CARD_ART_SHADES,
  }
}

export const issuerLabel = (issuer: string | null): string =>
  issuer ? ISSUER_LABEL[issuer] ?? issuer : '카드사 정보 없음'

export function cardKindOf(product: CatalogProduct): CardKind | null {
  const type = (product.card_type ?? '').toUpperCase()
  if (type.includes('DONGBAEK')) return null
  if (type.includes('CREDIT')) return 'CREDIT'
  if (type.includes('CHECK')) return 'CHECK'
  return null
}

export function productsOfKind<T extends CatalogProduct>(products: readonly T[], kind: CardKind): T[] {
  return products.filter((product) => cardKindOf(product) === kind)
}

export type IssuerGroup<T extends CatalogProduct> = {
  issuer: string | null
  label: string
  products: T[]
}

export function groupByIssuer<T extends CatalogProduct>(products: readonly T[]): IssuerGroup<T>[] {
  const groups = new Map<string, IssuerGroup<T>>()
  for (const product of products) {
    const key = product.issuer ?? ''
    const group = groups.get(key) ?? { issuer: product.issuer, label: issuerLabel(product.issuer), products: [] }
    group.products.push(product)
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, 'ko'))
}
