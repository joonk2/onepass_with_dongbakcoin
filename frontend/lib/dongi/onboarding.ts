export type OnboardingInput = {
  authenticated: boolean
  cardsLoaded: boolean
  cardsError: boolean
  activeCardCount: number
  dismissed: boolean
  qrPaymentFlow: boolean
}

export type OnboardingStatus = 'hidden' | 'loading' | 'error' | 'dashboard' | 'onboarding'

// 카드 조회 실패를 "카드 없음"으로 단정하지 않는다: 오류는 별도 상태다.
export function resolveOnboardingStatus(input: OnboardingInput): OnboardingStatus {
  if (!input.authenticated || input.qrPaymentFlow) return 'hidden'
  if (input.cardsError) return 'error'
  if (!input.cardsLoaded) return 'loading'
  if (input.activeCardCount > 0) return 'dashboard'
  return input.dismissed ? 'dashboard' : 'onboarding'
}

export function dismissKey(userId: string): string {
  return `onepass:card-onboarding-dismissed:${userId}`
}
