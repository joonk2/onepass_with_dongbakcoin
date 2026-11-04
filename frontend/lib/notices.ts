export const NOTICE = {
  cardRegistered: '카드 등록이 완료되었습니다.',
  cardUnlinked: '카드 등록이 해제되었습니다.',
  cardExpired: '유효기간이 지난 카드입니다.',
  cardDuplicate: '이미 등록된 카드입니다.',
  cardRegisterFailed: '카드 등록에 실패했습니다.',
  cardUnlinkFailed: '카드 등록 해제에 실패했습니다.',
  paymentDone: '결제가 완료되었습니다.',
  paymentFailed: '결제에 실패했습니다.',
  cardsLoadFailed: '카드 정보를 불러오지 못했습니다.',
  settingsSaved: '설정이 저장되었습니다.',
} as const

export function cardActionToastTone(message: string): 'info' | 'error' {
  return message.trim() === NOTICE.cardDuplicate ? 'info' : 'error'
}

export function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback
}
