export const ONEPASS_CARD_IMAGES = {
  big: { src: '/big-dongi.png', width: 1582, height: 994 },
  classic: { src: '/dongi-classic.png', width: 994, height: 1582 },
  daray: { src: '/dongi-daray.png', width: 1582, height: 994 },
  rope: { src: '/dongi-rope.png', width: 995, height: 1581 },
} as const

export type DongiImageVariant = keyof typeof ONEPASS_CARD_IMAGES

export type CardDesign = {
  variant: DongiImageVariant
  title: string
  description: string
}

export const CARD_DESIGNS: readonly CardDesign[] = [
  { variant: 'big', title: 'OnePass 동백전', description: '동이와 함께하는 대표 디자인' },
  { variant: 'classic', title: 'OnePass 카드', description: '깔끔한 동백 레드' },
  { variant: 'daray', title: 'OnePass 혜택 카드', description: '다라이 동이 디자인' },
  { variant: 'rope', title: '동이 캐릭터 카드', description: '어리둥절 동이 디자인' },
]

export const DEFAULT_CARD_DESIGN: DongiImageVariant = 'big'

export function cardDesignStorageKey(userId: string): string {
  return `onepass:card-design:${userId}`
}

export function isCardDesign(value: unknown): value is DongiImageVariant {
  return CARD_DESIGNS.some((design) => design.variant === value)
}

export function readCardDesign(userId: string): DongiImageVariant {
  try {
    const stored = window.localStorage.getItem(cardDesignStorageKey(userId))
    return isCardDesign(stored) ? stored : DEFAULT_CARD_DESIGN
  } catch {
    return DEFAULT_CARD_DESIGN
  }
}

export function writeCardDesign(userId: string, variant: DongiImageVariant): void {
  try {
    window.localStorage.setItem(cardDesignStorageKey(userId), variant)
  } catch {
    // 저장소를 쓸 수 없어도 발급 자체는 계속 진행한다.
  }
}

// 카드 상품 등록 전에 원패스 카드부터 발급해야 하는지 판단한다.
export function needsOnepassFirst(options: {
  hasOnepassCard: boolean
  targetIsOnepassCard: boolean
}): boolean {
  return !options.hasOnepassCard && !options.targetIsOnepassCard
}
