import { productPlate } from './card-catalog.ts'
import { isCardDesign, ONEPASS_CARD_IMAGES } from './dongi/card-design.ts'

export type CardImageFace = {
  kind: 'image'
  productId: string
  designId: string
  imagePath: string
  width: number
  height: number
}

export type CardPlateFace = {
  kind: 'plate'
  productId: string
  designId: string
  background: string
  color: string
}

export type CardMissingFace = {
  kind: 'missing'
  productId: string
  designId: string | null
  message: string
}

export type CardFace = CardImageFace | CardPlateFace | CardMissingFace

const MISSING_DESIGN_MESSAGE = '이 카드의 디자인 이미지를 찾을 수 없습니다.'

export function resolveRegisteredCardFace(input: {
  productId: string
  onepass: boolean
  onepassDesignId: string | null
}): CardFace {
  if (input.onepass) {
    if (!isCardDesign(input.onepassDesignId)) {
      return {
        kind: 'missing',
        productId: input.productId,
        designId: input.onepassDesignId,
        message: '선택한 원패스 카드 디자인을 찾을 수 없습니다.',
      }
    }
    const image = ONEPASS_CARD_IMAGES[input.onepassDesignId]
    return {
      kind: 'image',
      productId: input.productId,
      designId: input.onepassDesignId,
      imagePath: image.src,
      width: image.width,
      height: image.height,
    }
  }

  const plate = productPlate(input.productId)
  if (!plate) {
    return {
      kind: 'missing',
      productId: input.productId,
      designId: null,
      message: MISSING_DESIGN_MESSAGE,
    }
  }
  return {
    kind: 'plate',
    productId: input.productId,
    designId: plate.plate,
    background: plate.background,
    color: plate.color,
  }
}

export function cardKindLabel(options: { onepass: boolean; cardType: string | null }): string {
  if (options.onepass) return '원패스 카드'
  const type = (options.cardType ?? '').toUpperCase()
  if (type.includes('CREDIT')) return '신용카드'
  if (type.includes('CHECK')) return '체크카드'
  return '카드 종류 확인 불가'
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '등록됨',
  INACTIVE: '등록 해제',
  LOST: '분실',
  FROZEN: '정지',
  EXPIRED: '만료',
}

export function registrationStatusLabel(status: string | null): string {
  if (!status) return '등록 상태 확인 불가'
  return STATUS_LABEL[status.toUpperCase()] ?? status
}
