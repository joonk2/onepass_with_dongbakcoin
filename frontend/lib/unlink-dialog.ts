export type UnlinkDialogCopy = {
  showSadDongi: boolean
  title: string
  description: string
}

// onepass 여부는 호출부가 카드 상품 판별(isDongbaekProduct)로 넘긴다.
export function unlinkDialogCopy(input: { onepass: boolean; cardName: string }): UnlinkDialogCopy {
  if (input.onepass) {
    return {
      showSadDongi: true,
      title: '정말 원패스 카드를 해제하시겠습니까?',
      description: '원패스 카드 연결을 해제합니다. 동백전 잔액은 지갑에 그대로 남아요.',
    }
  }
  const cardName = input.cardName.trim()
  return {
    showSadDongi: false,
    title: '이 카드의 등록을 해제하시겠습니까?',
    description: cardName
      ? `${cardName} 등록을 해제하면 목록에서 사라져요. 실제 금융카드 계약은 해지되지 않아요.`
      : '등록을 해제하면 목록에서 사라져요. 실제 금융카드 계약은 해지되지 않아요.',
  }
}
