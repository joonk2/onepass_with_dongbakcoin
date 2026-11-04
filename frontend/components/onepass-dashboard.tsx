'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Grid2X2,
  Heart,
  Home,
  LoaderCircle,
  Map as MapIcon,
  Menu,
  QrCode,
  Receipt,
  Settings2,
  ShoppingBag,
  Sparkles,
  TrainFront,
  WalletCards,
  X,
} from 'lucide-react'
import ApiToolsPanel from '@/components/api-tools-panel'
import DongiImage from '@/components/dongi-image'
import DongiGuide from '@/components/dongi/dongi-guide'
import CardIssueSheet from '@/components/dongi/card-issue-sheet'
import UnlinkConfirm from '@/components/unlink-confirm'
import CardRegistrationPicker from '@/components/card-registration-picker'
import { useToast } from '@/components/toast-provider'
import { NOTICE, cardActionToastTone, failureMessage } from '@/lib/notices'
import { DEFAULT_CARD_DESIGN, ONEPASS_CARD_IMAGES, needsOnepassFirst, readCardDesign, writeCardDesign } from '@/lib/dongi/card-design'
import type { DongiImageVariant } from '@/components/dongi-image'
import { cardKindLabel, registrationStatusLabel, resolveRegisteredCardFace, type CardFace } from '@/lib/card-face'
import { dismissKey, resolveOnboardingStatus } from '@/lib/dongi/onboarding'
import WelcomeScreen from '@/components/welcome-screen'
import {
  api,
  ApiError,
  readAuthSession,
  writeAuthSession,
  type AuthSession,
  type BenefitRule,
  type CardProduct,
  type CardRegistrationDetails,
  type Merchant,
  type PaymentRecord,
  type PaymentRecommendation,
  type PaymentCandidate,
  type UserCard,
  type UserIdentityCard,
  type UserProfile,
  type WalletBalance,
} from '@/lib/api'
import { merchantIdFromSearch, resolveQrMerchant } from '@/lib/qr-payment'
import { CARD_KIND_LABEL, cardKindOf, issuerLabel, registrableProducts } from '@/lib/card-catalog'

type Screen = 'home' | 'card' | 'manage' | 'platform' | 'recharge' | 'report' | 'qr-scan' | 'qr-pay' | 'api-tools'
type EntryScreen = 'welcome' | 'auth' | 'qr'

type PaymentSummary = {
  txId: string
  merchantName: string
  amountWon: number
  productName: string | null
  expectedBenefitWon: number
  awardedBenefitWon: number | null
  balanceBeforeWon: number | null
  balanceAfterPaymentWon: number | null
  balanceAfterWon: number | null
  fundingType: string | null
  fundingBeforeWon: number | null
  fundingAfterWon: number | null
  benefitReason: string | null
  benefitStatus: string | null
  paidAt: string
}

// 혜택 산정 실패/미확정을 0원으로 보이지 않게 구분한다
function candidateBenefitLabel(candidate: PaymentCandidate): string {
  switch (candidate.benefit_status) {
    case 'UNRESOLVED':
    case 'DATA_MISSING':
      return '혜택 산정 불가'
    case 'ERROR':
      return '혜택 계산 오류'
    case 'CONDITION_NOT_MET':
      return '혜택 조건 미충족 (0원)'
    case 'PARTIAL':
      return `예상 혜택 ${formatWon(candidate.expected_benefit_won)} (일부 규칙 확인 필요)`
    case 'NOT_APPLICABLE':
      return '혜택 없음'
    default:
      return `예상 혜택 ${formatWon(candidate.expected_benefit_won)}`
  }
}

const newRequestId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

const quickLinks = [
  { label: '동백+', icon: Sparkles, tone: 'pink' },
  { label: '동백택시', icon: TrainFront, tone: 'gray' },
  { label: '동백드림', icon: Heart, tone: 'rose' },
  { label: '동백몰', icon: ShoppingBag, tone: 'mint' },
]

const formatWon = (amount: number) => `${amount.toLocaleString('ko-KR')}원`

const cardLabel = (name: string): string => (name.includes('동백전') ? '원패스 카드' : name)

const cardMeta = (product: CardProduct | undefined): string => {
  if (!product) return '카드 상품 정보 없음'
  const kind = cardKindOf(product)
  return [issuerLabel(product.issuer), kind ? CARD_KIND_LABEL[kind] : null].filter(Boolean).join(' · ')
}

function benefitNameOf(rules: BenefitRule[] | undefined): string | null {
  const rule = rules?.[0]
  return rule?.benefit_name ?? rule?.benefit_type ?? null
}

function isOnepassUserCard(card: UserCard, product: CardProduct | undefined): boolean {
  if (product) return isDongbaekProduct(product)
  return card.product_id === 'PRD_DB_SYN'
}

function toCardSlide(options: {
  card: UserCard
  product: CardProduct | undefined
  designId: DongiImageVariant
  balanceWon: number | null
  rules: BenefitRule[]
}): CardSlide {
  const onepass = isOnepassUserCard(options.card, options.product)
  const benefitName = benefitNameOf(options.rules)
  return {
    key: options.card.user_card_id,
    title: cardLabel(options.product?.product_name ?? options.card.product_id),
    issuer: onepass ? '부산시민플랫폼' : cardMeta(options.product),
    kindLabel: cardKindLabel({ onepass, cardType: options.product?.card_type ?? null }),
    statusLabel: registrationStatusLabel(options.card.card_status),
    detail: onepass
      ? (options.balanceWon != null ? `잔액 ${formatWon(options.balanceWon)}` : '잔액 확인 불가')
      : (benefitName ? `혜택 ${benefitName}` : null),
    face: resolveRegisteredCardFace({
      productId: options.card.product_id,
      onepass,
      onepassDesignId: onepass ? options.designId : null,
    }),
    isDongi: onepass,
    card: options.card,
    product: options.product,
    rules: options.rules,
  }
}

function slidesForCards(options: {
  cards: UserCard[]
  products: CardProduct[]
  designId: DongiImageVariant
  balanceWon: number | null
  benefits: Record<string, BenefitRule[]>
}): CardSlide[] {
  const entries = options.cards.map((card) => ({
    card,
    product: options.products.find((item) => item.product_id === card.product_id),
  }))
  return [
    ...entries.filter(({ card, product }) => isOnepassUserCard(card, product)),
    ...entries.filter(({ card, product }) => !isOnepassUserCard(card, product)),
  ].map(({ card, product }) => toCardSlide({
    card,
    product,
    designId: options.designId,
    balanceWon: options.balanceWon,
    rules: options.benefits[card.product_id] ?? [],
  }))
}

function isDongbaekProduct(product: CardProduct): boolean {
  const productDetails = [
    product.product_id,
    product.product_name,
    product.card_type,
    product.issuer,
  ].join(' ').toUpperCase()
  return productDetails.includes('DONGBAEK') || product.product_name.includes('동백전')
}

function optionalApiMessage(
  cause: unknown,
  notFoundMessage: string,
  fallbackMessage: string,
): string {
  if (cause instanceof ApiError && cause.status === 404) return notFoundMessage
  return fallbackMessage
}

function DongbaekMark({ small = false }: { small?: boolean }) {
  return (
    <div className={`dongbaek-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <span /><span /><span /><span /><span /><span /><span /><span /><span />
    </div>
  )
}

function Toggle({
  on,
  disabled = false,
  label,
  onChange,
}: {
  on: boolean
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      className={`toggle ${on ? 'on' : ''}`}
      onClick={onChange}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
    >
      <span />
    </button>
  )
}

export default function OnePassDashboard() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [entryScreen, setEntryScreen] = useState<EntryScreen>('welcome')
  const [authMessage, setAuthMessage] = useState('')
  const [screen, setScreen] = useState<Screen>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [products, setProducts] = useState<CardProduct[]>([])
  const [userCards, setUserCards] = useState<UserCard[]>([])
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [benefits, setBenefits] = useState<Record<string, BenefitRule[]>>({})
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [identityCards, setIdentityCards] = useState<UserIdentityCard[]>([])
  const [identityCardError, setIdentityCardError] = useState('')
  const [wallet, setWallet] = useState<WalletBalance | null>(null)
  const [profileFallback, setProfileFallback] = useState(false)
  const [walletFallback, setWalletFallback] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [walletError, setWalletError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingCard, setPendingCard] = useState('')
  const { showToast } = useToast()
  const cardActionsInFlight = useRef(new Set<string>())
  const [qrMerchantId, setQrMerchantId] = useState('')
  const [qrScanError, setQrScanError] = useState('')
  const [lastPayment, setLastPayment] = useState<PaymentSummary | null>(null)
  const [cardsLoaded, setCardsLoaded] = useState(false)
  const [cardsLoadFailed, setCardsLoadFailed] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [cardRegisteredNotice, setCardRegisteredNotice] = useState(false)
  const [issueSheetOpen, setIssueSheetOpen] = useState(false)
  const [issueBusy, setIssueBusy] = useState(false)
  const [issueError, setIssueError] = useState('')
  const [unlinkTarget, setUnlinkTarget] = useState<CardProduct | null>(null)
  const [cardDesign, setCardDesign] = useState<DongiImageVariant>(DEFAULT_CARD_DESIGN)
  const userId = authSession?.user.user_id

  useEffect(() => {
    setCardDesign(userId ? readCardDesign(userId) : DEFAULT_CARD_DESIGN)
    setIssueSheetOpen(false)
    setIssueError('')
  }, [userId])

  useEffect(() => {
    setCardsLoaded(false)
    setCardsLoadFailed(false)
    setCardRegisteredNotice(false)
    setOnboardingDismissed(
      userId ? window.sessionStorage.getItem(dismissKey(userId)) === '1' : false,
    )
  }, [userId])

  useEffect(() => {
    setAuthSession(readAuthSession())
    setAuthReady(true)
    const deepLinkMerchantId = merchantIdFromSearch(window.location.search)
    if (deepLinkMerchantId) {
      setQrMerchantId(deepLinkMerchantId)
      setScreen('qr-pay')
      setEntryScreen('qr')
    }
  }, [])

  useEffect(() => {
    const handleExpiredSession = () => {
      writeAuthSession(null)
      setAuthSession(null)
      setLoading(false)
      setAuthMessage('로그인이 만료되었습니다. 다시 로그인해 주세요.')
      setEntryScreen('auth')
      // 결제 중이던 가맹점 ID(qrMerchantId)와 qr-pay 화면은 유지해 재로그인 후 이어서 결제한다.
    }
    window.addEventListener('onepass:auth-expired', handleExpiredSession)
    return () => window.removeEventListener('onepass:auth-expired', handleExpiredSession)
  }, [])

  const loadData = useCallback(async (signal?: AbortSignal) => {
    if (!userId) return
    try {
      const [loadedProducts, loadedCards, loadedMerchants, history] =
        await Promise.all([
          api.getProducts({ signal }),
          api.getUserCards(userId, { signal }),
          api.getMerchants({ signal }),
          api.getPaymentHistory(userId, { signal }),
        ])
      if (signal?.aborted) return
      const [loadedProfile, loadedIdentityCards, loadedWallet] = await Promise.allSettled([
        api.getProfile(userId, { signal }),
        api.getIdentityCards(userId, { signal }),
        api.getWalletBalance(userId, { signal }),
      ])
      if (signal?.aborted) return
      setProducts(loadedProducts)
      setUserCards(loadedCards)
      setCardsLoaded(true)
      setCardsLoadFailed(false)
      setMerchants(loadedMerchants)
      setPayments(history.payments)
      if (loadedIdentityCards.status === 'fulfilled') {
        setIdentityCards(loadedIdentityCards.value)
        setIdentityCardError('')
      } else {
        setIdentityCards([])
        setIdentityCardError(
          optionalApiMessage(
            loadedIdentityCards.reason,
              '신분증 정보를 확인할 수 없습니다.',
            '신분증 정보를 불러오지 못했습니다.',
          ),
        )
      }
      if (loadedProfile.status === 'fulfilled') {
        setProfile(loadedProfile.value)
        setProfileFallback(false)
        setProfileError('')
      } else {
        setProfile(null)
        setProfileFallback(false)
        setProfileError(
          optionalApiMessage(
            loadedProfile.reason,
            '프로필 정보를 확인할 수 없습니다.',
            '프로필 정보를 불러오지 못했습니다.',
          ),
        )
      }
      if (loadedWallet.status === 'fulfilled') {
        setWallet(loadedWallet.value)
        setWalletFallback(false)
        setWalletError('')
      } else {
        setWallet(null)
        setWalletFallback(false)
        setWalletError(
          optionalApiMessage(
            loadedWallet.reason,
            '잔액 정보를 확인할 수 없습니다.',
            '지갑 잔액을 불러오지 못했습니다.',
          ),
        )
      }
      setError('')
    } catch (cause) {
      if (signal?.aborted) return
      setCardsLoadFailed(true)
      setError(
        cause instanceof Error ? cause.message : '서비스 정보를 불러오지 못했습니다.',
      )
      showToast({ tone: 'error', message: NOTICE.cardsLoadFailed })
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [showToast, userId])

  useEffect(() => {
    if (!authReady) return
    if (!authSession) {
      setLoading(false)
      return
    }
    setLoading(true)
    const controller = new AbortController()
    void loadData(controller.signal)
    return () => controller.abort()
  }, [authReady, authSession, loadData])

  useEffect(() => {
    if (!products.length) return
    const controller = new AbortController()
    Promise.all(
      products.map(async (product) => [
        product.product_id,
        await api.getBenefits(product.product_id, { signal: controller.signal }),
      ] as const),
    )
      .then((entries) => {
        if (!controller.signal.aborted) setBenefits(Object.fromEntries(entries))
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : '카드 혜택 정보를 불러오지 못했습니다.',
          )
        }
      })
    return () => controller.abort()
  }, [products])

  const activeCards = userCards.filter((card) => card.card_status === 'ACTIVE')
  const isWalletCard = (card: UserCard) => {
    const product = products.find((item) => item.product_id === card.product_id)
    return product ? isDongbaekProduct(product) : card.product_id === 'PRD_DB_SYN'
  }
  const bankCardCount = activeCards.filter((card) => !isWalletCard(card)).length
  const onboardingStatus = resolveOnboardingStatus({
    authenticated: Boolean(authSession),
    cardsLoaded,
    cardsError: cardsLoadFailed,
    activeCardCount: bankCardCount,
    dismissed: onboardingDismissed,
    qrPaymentFlow: screen === 'qr-pay' || screen === 'qr-scan',
  })

  useEffect(() => {
    // 카드가 다시 생기면 안내 이력을 지워, 나중에 0장이 되면 다시 안내할 수 있게 한다.
    if (!userId || !cardsLoaded || bankCardCount === 0) return
    window.sessionStorage.removeItem(dismissKey(userId))
    setOnboardingDismissed(false)
  }, [userId, cardsLoaded, bankCardCount])

  const dismissOnboarding = () => {
    if (userId) window.sessionStorage.setItem(dismissKey(userId), '1')
    setOnboardingDismissed(true)
  }
  const dongbaekProduct = activeCards
    .map((card) => products.find((product) => product.product_id === card.product_id))
    .find((product): product is CardProduct => product !== undefined && isDongbaekProduct(product)) ?? null
  const onepassProduct = products.find(isDongbaekProduct) ?? null
  const approvedPayments = useMemo(
    () =>
      payments
        .filter((payment) => payment.approval_status === 'APPROVED')
        .sort((left, right) => Date.parse(right.event_at) - Date.parse(left.event_at)),
    [payments],
  )

  const handleIssueOnepass = async (variant: DongiImageVariant) => {
    if (!userId || issueBusy) return
    setIssueBusy(true)
    setIssueError('')
    try {
      let target = onepassProduct
      if (!target) {
        const freshProducts = await api.getProducts()
        setProducts(freshProducts)
        target = freshProducts.find(isDongbaekProduct) ?? null
      }
      if (!target) {
        setIssueError('발급 가능한 원패스(동백전) 카드 상품이 없습니다. 관리자에게 문의해 주세요.')
        return
      }
      await api.addUserCard(userId, target.product_id)
      writeCardDesign(userId, variant)
      setCardDesign(variant)
      const refreshedCards = await api.getUserCards(userId)
      setUserCards(refreshedCards)
      setIssueSheetOpen(false)
      setCardRegisteredNotice(true)
      setScreen('manage')
      showToast({ tone: 'success', message: NOTICE.cardRegistered })
    } catch (issueFailure) {
      setIssueError(issueFailure instanceof Error ? issueFailure.message : '카드 발급에 실패했습니다.')
    } finally {
      setIssueBusy(false)
    }
  }

  const handleCardToggle = async (product: CardProduct, details?: CardRegistrationDetails, confirmed = false) => {
    if (!userId) return
    if (cardActionsInFlight.current.size > 0) return
    const linked = activeCards.find((card) => card.product_id === product.product_id)
    if (!linked && needsOnepassFirst({
      hasOnepassCard: dongbaekProduct !== null,
      targetIsOnepassCard: isDongbaekProduct(product),
    })) {
      setIssueError('')
      setIssueSheetOpen(true)
      return
    }
    if (linked && !confirmed) {
      setUnlinkTarget(product)
      return
    }
    cardActionsInFlight.current.add(product.product_id)
    setPendingCard(product.product_id)
    let actionCompleted = false
    try {
      if (linked) {
        await api.removeUserCard(userId, linked.user_card_id)
      } else {
        await api.addUserCard(userId, product.product_id, details)
      }
      actionCompleted = true
      const refreshedCards = await api.getUserCards(userId)
      setUserCards(refreshedCards)
      if (!linked && bankCardCount === 0 && !isDongbaekProduct(product)) setCardRegisteredNotice(true)
      showToast({
        tone: 'success',
        message: linked ? NOTICE.cardUnlinked : NOTICE.cardRegistered,
      })
    } catch (cause) {
      const message = actionCompleted
        ? '카드 상태는 변경됐지만 목록을 갱신하지 못했습니다. 다시 시도해 주세요.'
        : failureMessage(cause, linked ? NOTICE.cardUnlinkFailed : NOTICE.cardRegisterFailed)
      showToast({ tone: cardActionToastTone(message), message })
    } finally {
      cardActionsInFlight.current.delete(product.product_id)
      setPendingCard('')
      if (linked) setUnlinkTarget(null)
    }
  }

  const handleProfileUpdate = async (payload: {
    display_name: string
    student_card_id: string | null
    university: string | null
    department: string | null
    phone_number: string | null
    address: string | null
  }) => {
    if (!userId) return
    const updatedProfile = await api.updateProfile(userId, payload)
    setProfile(updatedProfile)
    setProfileFallback(false)
    setProfileError('')
  }

  const handleWalletTopUp = async (payload: {
    request_id: string
    amount_won: number
    wallet_id?: string
  }) => {
    if (!userId) throw new Error('로그인이 필요합니다.')
    const result = await api.createWalletTopUp(userId, payload)
    setWallet((current) => {
      if (!current) return current
      const wallets = current.wallets.map((item) => item.wallet_id === result.wallet_id
        ? {
            ...item,
            charge_won: result.charge_won,
            cashback_won: result.cashback_won,
            policy_support_won: result.policy_support_won,
            balance_won: result.balance_won,
          }
        : item)
      return {
        ...current,
        wallets,
        balance_won: wallets.reduce((total, item) => total + item.balance_won, 0),
      }
    })
    setWalletFallback(false)
    setWalletError('')
    return result
  }

  const leaveQrPay = () => {
    setQrMerchantId('')
    window.history.replaceState(null, '', '/')
    setScreen('home')
  }

  const handleQrPaid = async (summary: PaymentSummary) => {
    setLastPayment(summary)
    // 다른 조회가 실패해도 DB에 반영된 잔액과 결제내역은 항상 다시 읽는다.
    if (userId) {
      const [freshWallet, freshHistory] = await Promise.allSettled([
        api.getWalletBalance(userId),
        api.getPaymentHistory(userId),
      ])
      if (freshWallet.status === 'fulfilled') {
        setWallet(freshWallet.value)
        setWalletError('')
      }
      if (freshHistory.status === 'fulfilled') setPayments(freshHistory.value.payments)
    }
    await loadData()
    leaveQrPay()
  }

  const handleAuthenticated = (session: AuthSession) => {
    window.sessionStorage.removeItem(dismissKey(session.user.user_id))
    setOnboardingDismissed(false)
    setCardRegisteredNotice(false)
    writeAuthSession(session)
    setAuthSession(session)
    setAuthMessage('')
    setError('')
    setLoading(true)
  }

  const handleLogout = async () => {
    try {
      await api.logout()
    } catch (cause) {
      setAuthMessage(
        cause instanceof Error
          ? `로그아웃 요청을 완료하지 못했습니다. 세션은 이 기기에서 종료했습니다. (${cause.message})`
          : '로그아웃 요청을 완료하지 못했습니다. 세션은 이 기기에서 종료했습니다.',
      )
    } finally {
      writeAuthSession(null)
      setAuthSession(null)
      setScreen('home')
      setQrMerchantId('')
      setLastPayment(null)
      setEntryScreen('welcome')
      setLoading(false)
    }
  }

  if (!authReady) {
    return <main className="app-shell auth-loading"><LoaderCircle className="spin" size={24} /></main>
  }
  if (!authSession) {
    if (entryScreen === 'qr' && qrMerchantId) {
      return (
        <GuestQrPayScreen
          merchantId={qrMerchantId}
          onLogin={() => {
            setAuthMessage('로그인하면 이 가맹점에서 결제를 이어갈 수 있습니다.')
            setEntryScreen('auth')
          }}
          onBack={() => {
            setQrMerchantId('')
            setScreen('home')
            window.history.replaceState(null, '', '/')
            setEntryScreen('welcome')
          }}
        />
      )
    }
    if (entryScreen === 'welcome') {
      return <WelcomeScreen notice={authMessage} onLogin={() => {
        setAuthMessage('')
        setEntryScreen('auth')
      }} />
    }
    return (
      <AuthScreen
        notice={authMessage}
        onAuthenticated={handleAuthenticated}
        onBack={() => setEntryScreen(qrMerchantId ? 'qr' : 'welcome')}
      />
    )
  }

  return (
    <main className={`app-shell ${screen === 'report' ? 'report-active' : ''}`}>
      {issueSheetOpen && (
        <CardIssueSheet
          busy={issueBusy}
          error={issueError}
          onIssue={handleIssueOnepass}
          onCancel={() => setIssueSheetOpen(false)}
        />
      )}
      {unlinkTarget && (
        <UnlinkConfirm
          cardName={cardLabel(unlinkTarget.product_name)}
          onepass={isDongbaekProduct(unlinkTarget)}
          busy={pendingCard === unlinkTarget.product_id}
          onCancel={() => {
            if (pendingCard === unlinkTarget.product_id) return
            setUnlinkTarget(null)
          }}
          onConfirm={() => {
            if (pendingCard === unlinkTarget.product_id) return
            void handleCardToggle(unlinkTarget, undefined, true)
          }}
        />
      )}
      {onboardingStatus === 'onboarding' && (
        <DongiGuide
          scenario="no-cards"
          onPrimary={() => {
            if (dongbaekProduct) { dismissOnboarding(); setScreen('manage'); return }
            setIssueError('')
            setIssueSheetOpen(true)
          }}
          onSecondary={dismissOnboarding}
        />
      )}
      {cardRegisteredNotice && bankCardCount > 0 && (
        <DongiGuide
          scenario="card-registered"
          onClose={() => setCardRegisteredNotice(false)}
        />
      )}
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><DongbaekMark small /></div>
          <div><b>원패스 카드</b><span>부산시민플랫폼</span></div>
        </div>
        <div className="header-actions">
          <button aria-label="알림"><Bell size={19} /></button>
          <button aria-label="전체메뉴" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <button className="logout-button" onClick={() => void handleLogout()}>로그아웃</button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="주요 메뉴">
        <button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}><Home size={18} />홈</button>
        <button className={screen === 'platform' ? 'active' : ''} onClick={() => setScreen('platform')}><Grid2X2 size={18} />MY 플랫폼</button>
        <button className={screen === 'manage' ? 'active' : ''} onClick={() => setScreen('manage')}><WalletCards size={18} />내 카드</button>
        <button className={screen === 'report' ? 'active' : ''} onClick={() => setScreen('report')}><BarChart3 size={18} />리포트</button>
      </nav>

      <div className="app-body">
        {error && (
          <div className="api-alert" role="alert">
            <span>{error}</span>
            <button onClick={() => void loadData()}>다시 시도</button>
          </div>
        )}
        {loading ? (
          <div className="api-loading"><LoaderCircle className="spin" size={22} /> 서비스 정보를 불러오는 중입니다.</div>
        ) : (
          <>
            {screen === 'home' && (
              <HomeScreen
                userName={profile?.display_name ?? null}
                wallet={wallet}
                walletError={walletError}
                payments={approvedPayments}
                cardDesign={cardDesign}
                products={products}
                benefits={benefits}
                userCards={activeCards}
                lastPayment={lastPayment}
                onDismissLastPayment={() => setLastPayment(null)}
                onOpenCard={() => setScreen('manage')}
                onOpenQr={() => { setQrScanError(''); setScreen('qr-scan') }}
                onOpenRecharge={() => setScreen('recharge')}
                onOpenReport={() => setScreen('report')}
                onOpenMenu={() => setMenuOpen(true)}
              />
            )}
            {screen === 'card' && (
              <CardDetail
                userId={authSession.user.user_id}
                merchants={merchants}
                userCards={activeCards}
                payments={approvedPayments}
                initialMerchantId={qrMerchantId}
                onBack={() => setScreen('home')}
                onPaymentComplete={loadData}
              />
            )}
            {screen === 'manage' && (
              <CardManager
                products={products}
                userCards={activeCards}
                payments={approvedPayments}
                benefits={benefits}
                wallet={wallet}
                pendingCard={pendingCard}
                cardDesign={cardDesign}
                onBack={() => setScreen('home')}
                onToggle={handleCardToggle}
                onRetry={() => void loadData()}
              />
            )}
            {screen === 'platform' && (
              <MyPlatform
                profile={profile}
                profileFallback={profileFallback}
                profileError={profileError}
                identityCards={identityCards}
                identityCardError={identityCardError}
                hasOnepassCard={dongbaekProduct !== null}
                cardDesign={cardDesign}
                onIssueOnepass={() => { setIssueError(''); setIssueSheetOpen(true) }}
                onSave={handleProfileUpdate}
                onBack={() => setScreen('home')}
              />
            )}
            {screen === 'qr-scan' && (
              <QrScanScreen
                merchants={merchants}
                error={qrScanError}
                onError={setQrScanError}
                onBack={() => setScreen('home')}
                onDetected={(value) => {
                  const merchant = resolveQrMerchant(value, merchants)
                  if (!merchant) {
                    setQrScanError('등록된 가맹점 QR 코드가 아닙니다. 다시 스캔해 주세요.')
                    return
                  }
                  setQrMerchantId(merchant.merchant_id)
                  setQrScanError('')
                  setScreen('qr-pay')
                }}
              />
            )}
            {screen === 'qr-pay' && (
              <QrPayScreen
                userId={authSession.user.user_id}
                merchantId={qrMerchantId}
                merchants={merchants}
                userCards={activeCards}
                wallet={wallet}
                onBack={leaveQrPay}
                onPaid={handleQrPaid}
              />
            )}
            {screen === 'recharge' && (
              <RechargeScreen
                userName={profile?.display_name ?? null}
                wallet={wallet}
                walletFallback={walletFallback}
                walletError={walletError}
                onTopUp={handleWalletTopUp}
                onBack={() => setScreen('home')}
              />
            )}
            {screen === 'report' && (
              <ReportScreen payments={approvedPayments} onBack={() => setScreen('home')} />
            )}
            {screen === 'api-tools' && (
              <ApiToolsPanel
                userId={authSession.user.user_id}
                products={products}
                cards={activeCards}
                merchants={merchants}
                payments={approvedPayments}
                benefits={benefits}
                onBack={() => setScreen('home')}
                onRefresh={async () => { await loadData() }}
              />
            )}
          </>
        )}
      </div>

      <footer className="app-footer">
        <span>부산광역시&nbsp; | &nbsp;BNK부산은행</span>
      </footer>

      {menuOpen && (
        <div className="menu-overlay" role="dialog" aria-modal="true" aria-label="전체 메뉴">
          <div className="menu-sheet">
            <div className="sheet-head"><h2>전체 메뉴</h2><button onClick={() => setMenuOpen(false)} aria-label="닫기"><X /></button></div>
            <button onClick={() => { setScreen('manage'); setMenuOpen(false) }}><CreditCard size={19} /><span><b>내 카드 관리</b><small>연결 카드와 혜택 확인</small></span><ChevronRight /></button>
            <button onClick={() => { setScreen('platform'); setMenuOpen(false) }}><Receipt size={19} /><span><b>내정보 관리</b><small>{profile?.display_name ?? '프로필 정보 미등록'}</small></span><ChevronRight /></button>
            <button onClick={() => { setScreen('recharge'); setMenuOpen(false) }}><CreditCard size={19} /><span><b>충전</b><small>동백전 잔액 충전</small></span><ChevronRight /></button>
            {process.env.NODE_ENV === 'development' && (
              <button onClick={() => { setScreen('api-tools'); setMenuOpen(false) }}><Settings2 size={19} /><span><b>개발 도구</b><small>연동 상태 및 상세 정보</small></span><ChevronRight /></button>
            )}
            <button><MapIcon size={19} /><span><b>15분도시 생활권맵</b><small>내 주변 생활시설 찾기</small></span><ChevronRight /></button>
          </div>
        </div>
      )}
    </main>
  )
}

function GuestQrPayScreen({
  merchantId,
  onLogin,
  onBack,
}: {
  merchantId: string
  onLogin: () => void
  onBack: () => void
}) {
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [merchantError, setMerchantError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api.getMerchant(merchantId, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setMerchant(result)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setMerchantError(
          cause instanceof ApiError && cause.status === 404
            ? '등록되지 않은 가맹점 QR 코드입니다.'
            : '가맹점 정보를 불러오지 못했습니다.',
        )
      })
    return () => controller.abort()
  }, [merchantId])

  return (
    <main className="app-shell">
      <div className="screen-content detail-screen qr-pay-screen">
        <div className="detail-head">
          <button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button>
          <strong>QR 결제</strong>
          <span aria-hidden="true" />
        </div>
        <section className="qr-pay-merchant">
          <span>결제할 가맹점</span>
          <strong>{merchant ? merchant.merchant_name ?? merchant.merchant_id : merchantError || '가맹점 확인 중…'}</strong>
          {merchant && <small>{merchant.merchant_id}</small>}
        </section>
        <section className="pay-section">
          <p className="auth-notice" role="status">결제는 로그인 후 진행할 수 있습니다.</p>
          <button type="button" className="primary-action qr-pay-submit" disabled={!merchant} onClick={onLogin}>
            로그인하고 결제하기
          </button>
        </section>
      </div>
    </main>
  )
}

function AuthScreen({
  notice,
  onAuthenticated,
  onBack,
}: {
  notice: string
  onAuthenticated: (session: AuthSession) => void
  onBack: () => void
}) {
  const [registering, setRegistering] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const credentials = { username: username.trim(), password }
      let session: AuthSession
      if (registering) {
        session = await api.register(credentials)
      } else {
        try {
          session = await api.login(credentials)
        } catch (loginCause) {
          if (!(loginCause instanceof ApiError) || loginCause.status !== 401) throw loginCause
          // 없는 아이디면 가입 후 바로 시작하고, 이미 있는 아이디면 비밀번호 오류로 안내한다
          try {
            session = await api.register(credentials)
          } catch (registerCause) {
            if (registerCause instanceof ApiError && registerCause.status === 409) {
              throw new Error('비밀번호가 올바르지 않습니다.')
            }
            throw registerCause
          }
        }
      }
      onAuthenticated(session)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '요청을 완료하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="app-shell auth-shell">
      <button className="auth-back" type="button" onClick={onBack}><ArrowLeft size={17} /> 처음 화면</button>
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark"><DongbaekMark small /></div>
          <div><b>원패스 카드</b><span>부산시민플랫폼</span></div>
        </div>
        <p className="auth-eyebrow">원패스 카드</p>
        <h1>{registering ? '간편 회원가입' : '로그인'}</h1>
        <p className="auth-description">아이디와 비밀번호로 간편하게 시작하세요.</p>
        <div className="auth-tabs" role="tablist" aria-label="계정 메뉴">
          <button
            type="button"
            role="tab"
            aria-selected={!registering}
            className={!registering ? 'active' : ''}
            onClick={() => { setRegistering(false); setError('') }}
          >
            로그인
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={registering}
            className={registering ? 'active' : ''}
            onClick={() => { setRegistering(true); setError('') }}
          >
            회원가입
          </button>
        </div>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label>
            아이디
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9._\-]+"
              title="영문, 숫자, 점, 밑줄, 하이픈을 사용할 수 있습니다."
              required
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={registering ? 'new-password' : 'current-password'}
              minLength={registering ? 8 : 1}
              maxLength={128}
              required
            />
          </label>
          {registering
            ? <p className="auth-hint">아이디는 영문·숫자·._- 조합 3~32자, 비밀번호는 8자 이상으로 입력해 주세요.</p>
            : <p className="auth-hint">처음 사용하는 아이디로 로그인하면 자동으로 가입됩니다. (비밀번호 8자 이상)</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={pending}>
            {pending ? '확인 중…' : registering ? '가입하고 바로 시작' : '로그인'}
          </button>
        </form>
        <p className="auth-footnote">계정은 안전하게 암호화해 저장합니다.</p>
      </section>
    </main>
  )
}

function HomeScreen({
  userName,
  wallet,
  walletError,
  payments,
  cardDesign,
  products,
  benefits,
  userCards,
  lastPayment,
  onDismissLastPayment,
  onOpenCard,
  onOpenQr,
  onOpenRecharge,
  onOpenReport,
  onOpenMenu,
}: {
  userName: string | null
  wallet: WalletBalance | null
  walletError: string
  payments: PaymentRecord[]
  cardDesign: DongiImageVariant
  products: CardProduct[]
  benefits: Record<string, BenefitRule[]>
  userCards: UserCard[]
  lastPayment: PaymentSummary | null
  onDismissLastPayment: () => void
  onOpenCard: () => void
  onOpenQr: () => void
  onOpenRecharge: () => void
  onOpenReport: () => void
  onOpenMenu: () => void
}) {
  const total = payments.reduce((sum, payment) => sum + payment.amount_won, 0)
  const [activeSlide, setActiveSlide] = useState(0)
  const homeSlides = slidesForCards({
    cards: userCards,
    products,
    designId: cardDesign,
    balanceWon: wallet?.balance_won ?? null,
    benefits,
  })
  return (
    <div className="screen-content">
      <div className="user-row">
        <div className="avatar">{userName?.slice(0, 1) ?? '동'}</div>
        <strong>{userName ?? '프로필 정보 미등록'}</strong>
        <div className="user-actions"><Bell size={18} /><button onClick={onOpenMenu} aria-label="메뉴"><Menu size={20} /></button></div>
      </div>
      {homeSlides.length === 0 && (
        <p className="home-balance-summary" style={{ textAlign: 'center' }}>등록된 카드가 없습니다. 카드 관리에서 카드를 등록해 주세요.</p>
      )}
      <CardCarousel
        slides={homeSlides}
        activeIndex={activeSlide}
        onChange={setActiveSlide}
        onOpen={onOpenCard}
      />
      <p className="home-balance-summary" style={{ margin: '0 0 12px', textAlign: 'center' }}>
        {payments.length}건 결제 · {formatWon(total)}
      </p>
      {lastPayment && (
        <section className="payment-result-banner" role="status" aria-live="polite">
          <div className="payment-result-head">
            <b>결제 완료</b>
            <button type="button" onClick={onDismissLastPayment} aria-label="결제 결과 닫기"><X size={15} /></button>
          </div>
          <dl>
            <div><dt>가맹점</dt><dd>{lastPayment.merchantName}</dd></div>
            <div><dt>결제 금액</dt><dd>{formatWon(lastPayment.amountWon)}</dd></div>
            <div><dt>결제 카드</dt><dd>{lastPayment.productName ?? '-'}</dd></div>
            {lastPayment.balanceBeforeWon !== null && lastPayment.balanceAfterPaymentWon !== null ? (
              <div>
                <dt>동백전 잔액</dt>
                <dd>{`${formatWon(lastPayment.balanceBeforeWon)} → ${formatWon(lastPayment.balanceAfterPaymentWon)}`}</dd>
              </div>
            ) : lastPayment.fundingBeforeWon !== null && lastPayment.fundingAfterWon !== null ? (
              <div>
                <dt>연결 계좌 잔액</dt>
                <dd>{`${formatWon(lastPayment.fundingBeforeWon)} → ${formatWon(lastPayment.fundingAfterWon)}`}</dd>
              </div>
            ) : (
              <div><dt>결제 승인 결과</dt><dd>승인 완료</dd></div>
            )}
            <div className="highlight">
              <dt>{lastPayment.balanceBeforeWon !== null ? '받은 캐시백' : '적용 혜택'}</dt>
              <dd>
                {lastPayment.awardedBenefitWon === null || ['UNRESOLVED', 'DATA_MISSING', 'ERROR'].includes(lastPayment.benefitStatus ?? '')
                  ? `혜택 산정 불가${lastPayment.benefitReason ? ` (${lastPayment.benefitReason})` : ''}`
                  : lastPayment.awardedBenefitWon > 0
                    ? `+${formatWon(lastPayment.awardedBenefitWon)}`
                    : `0원${lastPayment.benefitReason ? ` (${lastPayment.benefitReason})` : ''}`}
              </dd>
            </div>
            {lastPayment.balanceAfterWon !== null && (lastPayment.awardedBenefitWon ?? 0) > 0 && (
              <div><dt>캐시백 적립 후 잔액</dt><dd>{formatWon(lastPayment.balanceAfterWon)}</dd></div>
            )}
          </dl>
        </section>
      )}
      <button className="qr-pay-button" onClick={onOpenQr}>
        <QrCode size={30} />
        <span><b>QR 결제</b><small>카메라로 가맹점 QR을 스캔하세요</small></span>
        <ChevronRight size={22} />
      </button>
      <section className="api-panel">
        <div className="chart-heading"><div><b>최근 결제 내역</b><small>최근 승인된 결제 정보</small></div><button onClick={onOpenReport}>전체 보기 ›</button></div>
        {payments.length ? payments.slice(0, 3).map((item) => (
          <div className="recent-payment" key={item.tx_id}>
            <div>
              <b>{item.merchant_name ?? '가맹점'}</b>
              <small>{cardLabel(item.product_name ?? '카드')} · {new Date(item.event_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
              {(item.awarded_benefit_won ?? 0) > 0 && (
                <small className="recent-cashback">받은 캐시백 +{formatWon(item.awarded_benefit_won ?? 0)}</small>
              )}
            </div>
            <strong>{formatWon(item.amount_won)}</strong>
          </div>
        )) : <p className="empty-state">표시할 결제 이력이 없습니다.</p>}
      </section>
      <button className="recharge-shortcut" onClick={onOpenRecharge}><span><CreditCard size={15} /> 충전</span><b>{wallet ? '동백전 잔액' : walletError || '잔액 정보 확인 필요'}</b><ChevronRight size={16} /></button>
      <button className="report-shortcut" onClick={onOpenReport}><span><BarChart3 size={16} /> 월별 사용 리포트</span><b>이용 내역 기준</b><ChevronRight size={16} /></button>
      <section className="walk-card"><div><b>조금 더 걸어볼까요?</b><br /><span>산책이라도 나설까요?</span><small>걷기사용 · 오늘의 걸음은 연결 후 표시됩니다</small></div><span className="walk-icon">◜◡◝</span></section>
      <div className="bento">
        <button onClick={onOpenMenu}><b>MY 플랫폼</b><span>내 정보를<br />한번에 확인하세요!</span><small>› 내정보 관리</small></button>
        <button onClick={onOpenReport}><b>월별 사용 리포트</b><span>결제 이용 내역을 확인해요</span></button>
      </div>
      <div className="quick-grid">{quickLinks.map(({ label, icon: Icon, tone }) => <button key={label} type="button" disabled><span className={`quick-icon ${tone}`}><Icon size={17} /></span><b>{label}</b></button>)}</div>
    </div>
  )
}

function CardDetail({
  userId,
  merchants,
  userCards,
  payments,
  initialMerchantId,
  onBack,
  onPaymentComplete,
}: {
  userId: string
  merchants: Merchant[]
  userCards: UserCard[]
  payments: PaymentRecord[]
  initialMerchantId: string
  onBack: () => void
  onPaymentComplete: () => Promise<void>
}) {
  const [merchantId, setMerchantId] = useState(initialMerchantId)
  const [amount, setAmount] = useState('')
  const [recommendation, setRecommendation] = useState<PaymentRecommendation | null>(null)
  const [recommendationError, setRecommendationError] = useState('')
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState(false)
  const [success, setSuccess] = useState('')
  const [showBenefitComparison, setShowBenefitComparison] = useState(false)
  const { showToast } = useToast()
  const thisMonthBenefit = payments
    .filter((payment) => payment.event_at.slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, payment) => sum + (payment.awarded_benefit_won ?? 0), 0)

  useEffect(() => {
    setRecommendation(null)
    const amountWon = Number(amount)
    if (!merchantId || !Number.isInteger(amountWon) || amountWon <= 0 || !userCards.length) {
      setRecommendationError('')
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      api.recommendPayment({
        user_id: userId,
        merchant_id: merchantId,
        amount_won: amountWon,
      }, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) {
            setRecommendation(result)
            setRecommendationError('')
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setRecommendationError(cause instanceof Error ? cause.message : '추천 정보를 불러오지 못했습니다.')
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [amount, merchantId, userCards.length, userId])

  const pay = async () => {
    if (!recommendation?.recommended_user_card_id) return
    setPaying(true)
    setSuccess('')
    try {
      const result = await api.createPayment({
        request_id: crypto.randomUUID(),
        user_id: userId,
        user_card_id: recommendation.recommended_user_card_id,
        merchant_id: merchantId,
        amount_won: Number(amount),
      })
      const balanceNote = result.balance_after_won != null && result.balance_before_won != null
        ? `동백전 잔액 ${formatWon(result.balance_before_won)} → ${formatWon(result.balance_after_won)}.`
        : ''
      setSuccess([balanceNote, `거래 ID: ${result.tx_id}`, '금융기관 승인이 아닌 서비스 내 결제입니다.'].filter(Boolean).join(' '))
      showToast({ tone: 'success', message: NOTICE.paymentDone })
      await onPaymentComplete()
    } catch (cause) {
      showToast({ tone: 'error', message: failureMessage(cause, NOTICE.paymentFailed) })
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="screen-content detail-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>원패스 카드</strong><button onClick={onBack} aria-label="내 카드 관리"><Settings2 size={18} /></button></div>
      <section className="benefit-card"><div><span>이번 달 승인 결제 혜택</span><strong>{formatWon(thisMonthBenefit)}</strong><b>결제 이용 내역 기준</b></div><div className="mascot">◔ᴥ◔</div></section>
      <section className="pay-section">
        <div className="section-title"><h3>카드 혜택 비교</h3><span>보유 카드 기준</span></div>
        <label className="form-field">가맹점
          <select value={merchantId} onChange={(event) => { setMerchantId(event.target.value); setSuccess('') }}>
            <option value="">가맹점을 선택해 주세요</option>
            {merchants.map((merchant) => <option key={merchant.merchant_id} value={merchant.merchant_id}>{merchant.merchant_name ?? merchant.merchant_id}</option>)}
          </select>
        </label>
        <label className="form-field">결제 금액
          <div className="amount-input"><input aria-label="결제 금액" inputMode="numeric" placeholder="금액을 입력해 주세요" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[^0-9]/g, '')); setSuccess('') }} /><b>원</b></div>
        </label>
        <div className="recommend">
          {loading && <LoaderCircle className="spin" size={17} />}
          {recommendation ? (
            <>
              <span>{merchants.find((merchant) => merchant.merchant_id === merchantId)?.merchant_name} · {formatWon(recommendation.amount_won)}</span>
              <strong>예상 혜택 {formatWon(recommendation.expected_benefit_won)}</strong>
              <p>{cardLabel(recommendation.candidates.find((candidate) => candidate.user_card_id === recommendation.recommended_user_card_id)?.product_name ?? '추천 카드 없음')}</p>
              <small>{recommendation.candidates.length ? '예상 혜택이 가장 높은 카드입니다.' : '등록된 보유 카드가 없어 비교할 수 없습니다.'}</small>
            </>
          ) : (
            <small>{recommendationError || (userCards.length ? '가맹점과 금액을 입력하면 보유 카드의 혜택을 조회합니다.' : '내 카드 관리에서 카드를 연결하면 결제 추천을 사용할 수 있습니다.')}</small>
          )}
          <button
            type="button"
            disabled={!recommendation?.candidates.length}
            aria-expanded={showBenefitComparison}
            onClick={() => setShowBenefitComparison((visible) => !visible)}
          >
            {showBenefitComparison ? '혜택 비교 닫기' : '혜택 비교하기'}
          </button>
          {showBenefitComparison && recommendation && (
            <ol className="benefit-comparison-list">
              {recommendation.candidates
                .slice()
                .sort((left, right) => right.expected_benefit_won - left.expected_benefit_won)
                .map((candidate) => (
                  <li
                    className={candidate.user_card_id === recommendation.recommended_user_card_id ? 'recommended' : ''}
                    key={candidate.user_card_id}
                  >
                    <span>
                      <b>{cardLabel(candidate.product_name ?? '카드 상품')}</b>
                      <small>{candidate.reason ?? (candidate.eligible ? '혜택 적용 가능' : '혜택 적용 대상 아님')}</small>
                    </span>
                    <strong>{formatWon(candidate.expected_benefit_won)}</strong>
                  </li>
                ))}
            </ol>
          )}
          <button
            type="button"
            className="secondary-action"
            disabled={paying || !recommendation?.recommended_user_card_id}
            onClick={() => void pay()}
          >
            {paying ? '처리 중…' : '결제 시뮬레이션'}
          </button>
          {success && <small className="success-message" role="status">{success}</small>}
        </div>
      </section>
      <div className="stats">
        <div><span>동백전 잔액</span><b>잔액 정보 없음</b><a onClick={onBack}>홈에서 확인 ›</a></div>
        <div><span>연결된 카드</span><b>{userCards.length}장</b><i><em style={{ width: `${Math.min(100, userCards.length * 20)}%` }} /></i></div>
      </div>
    </div>
  )
}

type CardSlide = {
  key: string
  title: string
  issuer: string
  kindLabel: string
  statusLabel: string
  detail: string | null
  face: CardFace
  isDongi: boolean
  card?: UserCard
  product?: CardProduct
  rules: BenefitRule[]
}

function CardFaceView({ face, title }: { face: CardFace; title: string }) {
  const imagePath = face.kind === 'image' ? face.imagePath : ''
  const [brokenPath, setBrokenPath] = useState('')
  const broken = imagePath !== '' && brokenPath === imagePath
  if (face.kind === 'missing' || broken) {
    return (
      <p className="carousel-art-missing" role="alert">
        {face.kind === 'missing' ? face.message : `${title} 이미지를 불러오지 못했습니다.`}
      </p>
    )
  }
  if (face.kind === 'image') {
    return (
      <img
        className="carousel-art-image"
        src={face.imagePath}
        alt={`${title} 디자인`}
        width={face.width}
        height={face.height}
        draggable={false}
        onError={() => setBrokenPath(face.imagePath)}
      />
    )
  }
  return (
    <div
      className="card-picker-card-art carousel-plate"
      data-plate={face.designId}
      style={{ background: face.background, color: face.color }}
      role="img"
      aria-label={`${title} 디자인`}
    />
  )
}

function slideOffset(track: HTMLElement, slide: HTMLElement): number {
  const trackBox = track.getBoundingClientRect()
  const slideBox = slide.getBoundingClientRect()
  return slideBox.left - trackBox.left + track.scrollLeft
}

function CardCarousel({
  slides,
  activeIndex,
  onChange,
  onOpen,
}: {
  slides: CardSlide[]
  activeIndex: number
  onChange: (index: number) => void
  onOpen?: () => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollLock = useRef<number | null>(null)
  const count = slides.length
  const safeIndex = count === 0 ? 0 : ((activeIndex % count) + count) % count
  const scrollToSlide = (index: number, instant = false) => {
    const track = trackRef.current
    const slide = track?.children[index] as HTMLElement | undefined
    if (!track || !slide) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = instant || reduceMotion ? 'auto' : 'smooth'
    if (instant) scrollLock.current = index
    track.scrollTo({ left: slideOffset(track, slide), behavior })
  }
  const goTo = (index: number) => {
    if (count === 0) return
    const next = ((index % count) + count) % count
    scrollToSlide(next)
    onChange(next)
  }
  const stepBy = (delta: number) => {
    if (count === 0) return
    const next = (safeIndex + delta + count) % count
    const wraps = delta > 0 ? safeIndex === count - 1 : safeIndex === 0
    scrollToSlide(next, wraps)
    onChange(next)
  }
  useEffect(() => {
    const track = trackRef.current
    const slide = track?.children[safeIndex] as HTMLElement | undefined
    if (!track || !slide) return
    track.scrollTo({ left: slideOffset(track, slide), behavior: 'auto' })
  }, [count])
  return (
    <section
      className="card-carousel"
      aria-roledescription="carousel"
      aria-label="내 보유 카드"
      tabIndex={count > 1 ? 0 : undefined}
      aria-keyshortcuts={count > 1 ? 'ArrowLeft ArrowRight' : undefined}
      onKeyDown={(event) => {
        if (count < 2) return
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          stepBy(1)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          stepBy(-1)
        }
      }}
    >
      <div
        className={`carousel-track ${count < 2 ? 'single' : ''}`}
        ref={trackRef}
        onScroll={(event) => {
          if (count < 2) return
          const track = event.currentTarget
          const center = track.scrollLeft + track.clientWidth / 2
          let nearest = 0
          let best = Infinity
          Array.from(track.children).forEach((child, index) => {
            const element = child as HTMLElement
            const distance = Math.abs(slideOffset(track, element) + element.clientWidth / 2 - center)
            if (distance < best) {
              best = distance
              nearest = index
            }
          })
          if (scrollLock.current !== null) {
            if (nearest === scrollLock.current) scrollLock.current = null
            return
          }
          if (nearest !== safeIndex) onChange(nearest)
        }}
      >
        {slides.map((slide, index) => (
          <div
            className={`carousel-slide ${index === safeIndex ? 'current' : ''}`}
            key={slide.key}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} / ${count}, ${slide.title}`}
            onClick={() => (index !== safeIndex ? goTo(index) : onOpen?.())}
          >
            <div className="carousel-art">
              <CardFaceView face={slide.face} title={slide.title} />
            </div>
            <div className="carousel-meta">
              <b>{slide.title}</b>
              <span>{slide.kindLabel}</span>
              <span>{slide.statusLabel}</span>
              {slide.detail && <strong>{slide.detail}</strong>}
            </div>
          </div>
        ))}
      </div>
      {count > 1 && (
        <div className="carousel-nav">
          <button type="button" aria-label="이전 카드" onClick={() => stepBy(-1)}><ChevronLeft size={18} /></button>
          <div className="carousel-dots" role="tablist" aria-label="카드 위치">
            {slides.map((slide, index) => (
              <button
                key={slide.key}
                type="button"
                role="tab"
                aria-selected={index === safeIndex}
                aria-label={`${index + 1}번째 카드: ${slide.title}`}
                className={index === safeIndex ? 'on' : ''}
                onClick={() => goTo(index)}
              />
            ))}
          </div>
          <button type="button" aria-label="다음 카드" onClick={() => stepBy(1)}><ChevronRight size={18} /></button>
        </div>
      )}
    </section>
  )
}

function CardManager({
  products,
  userCards,
  payments,
  benefits,
  wallet,
  pendingCard,
  cardDesign,
  onBack,
  onToggle,
  onRetry,
}: {
  onRetry: () => void
  products: CardProduct[]
  userCards: UserCard[]
  payments: PaymentRecord[]
  benefits: Record<string, BenefitRule[]>
  wallet: WalletBalance | null
  pendingCard: string
  cardDesign: DongiImageVariant
  onBack: () => void
  onToggle: (product: CardProduct, details?: CardRegistrationDetails) => Promise<void>
}) {
  const [showAvailableProducts, setShowAvailableProducts] = useState(false)
  const [activeSlide, setActiveSlide] = useState(0)
  const activeProductIds = new Set(userCards.map((card) => card.product_id))
  const slides = slidesForCards({
    cards: userCards,
    products,
    designId: cardDesign,
    balanceWon: wallet?.balance_won ?? null,
    benefits,
  })
  const current = slides.length > 0 ? slides[((activeSlide % slides.length) + slides.length) % slides.length] : undefined
  const availableProducts = registrableProducts(products).filter(
    (product) => !activeProductIds.has(product.product_id),
  )
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const getMonthlySpend = (userCardId: string) =>
    payments
      .filter(
        (payment) =>
          payment.user_card_id === userCardId &&
          payment.event_at.slice(0, 7) === currentMonth,
      )
      .reduce((total, payment) => total + payment.amount_won, 0)

  return (
    <div className="screen-content manager-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>내 카드 관리</strong><button onClick={onBack} aria-label="메뉴"><Menu size={19} /></button></div>
      <CardCarousel
        slides={slides}
        activeIndex={activeSlide}
        onChange={setActiveSlide}
      />
      {pendingCard && <p className="card-action-status" role="status">카드 등록 상태를 변경하는 중입니다.</p>}
      {current && (
        <section className="card-detail-panel" aria-live="polite">
          <header>
            <div>
              <b>{current.title}</b>
              <small>{current.issuer}</small>
            </div>
            {current.card && current.product && (
              <button
                className="card-action-button secondary"
                type="button"
                disabled={Boolean(pendingCard)}
                onClick={() => current.product && void onToggle(current.product)}
              >
                등록 해제
              </button>
            )}
          </header>
          <dl className="card-stats">
            {current.isDongi && (
              <div><dt>동백전 잔액</dt><dd>{wallet ? formatWon(wallet.balance_won) : '확인 불가'}</dd></div>
            )}
            {current.card && (
              <>
                {current.card.card_last4 && (
                  <div><dt>카드번호</dt><dd>•••• {current.card.card_last4}</dd></div>
                )}
                {current.card.expires_at && (
                  <div><dt>유효기간</dt><dd>{current.card.expires_at.slice(5, 7)}/{current.card.expires_at.slice(2, 4)}</dd></div>
                )}
                {current.card.prev_month_spend_won != null && (
                  <div><dt>전월실적</dt><dd>{current.card.prev_month_spend_won > 0 ? `${formatWon(current.card.prev_month_spend_won)} 이상` : '없음'}</dd></div>
                )}
                <div><dt>이번 달 결제</dt><dd>{formatWon(getMonthlySpend(current.card.user_card_id))}</dd></div>
                <div>
                  <dt>남은 한도</dt>
                  <dd>
                    {current.card.credit_limit_won != null
                      ? formatWon(Math.max(0, current.card.credit_limit_won - getMonthlySpend(current.card.user_card_id)))
                      : '정보 없음'}
                  </dd>
                </div>
                {current.card.credit_limit_won != null && (
                  <div><dt>전체 한도</dt><dd>{formatWon(current.card.credit_limit_won)}</dd></div>
                )}
              </>
            )}
          </dl>
          <p className="list-label">카드 혜택</p>
          {current.rules.length > 0 ? (
            <ul className="card-benefits readable">
              {current.rules.map((rule) => {
                const caps = [
                  rule.per_tx_cap_won != null ? `1회 최대 ${formatWon(rule.per_tx_cap_won)}` : null,
                  rule.monthly_cap_won != null ? `월 최대 ${formatWon(rule.monthly_cap_won)}` : null,
                  rule.monthly_count_cap != null ? `월 ${rule.monthly_count_cap}회` : null,
                ].filter((value): value is string => value !== null)
                return (
                  <li key={rule.rule_id}>
                    <b>{rule.benefit_name ?? rule.benefit_type ?? '혜택'}</b>
                    {rule.perf_threshold_won != null && rule.perf_threshold_won > 0 && (
                      <small>전월실적 {formatWon(rule.perf_threshold_won)} 이상</small>
                    )}
                    {caps.length > 0 && <small>{caps.join(' · ')}</small>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="empty-state">
              {current.product && benefits[current.product.product_id] === undefined
                ? '혜택 정보를 불러오지 못했거나 아직 확인 중입니다.'
                : '등록된 혜택 규칙이 없습니다.'}
            </p>
          )}
        </section>
      )}
      {!userCards.length && <p className="empty-state">현재 로그인 사용자에게 연결된 카드가 없습니다.</p>}      <button
        className="card-action-button primary"
        type="button"
        disabled={Boolean(pendingCard) || !availableProducts.length}
        aria-expanded={showAvailableProducts}
        onClick={() => setShowAvailableProducts((visible) => !visible)}
      >
        {showAvailableProducts ? '카드 등록 목록 닫기' : '카드 등록'}
      </button>
      {showAvailableProducts && (
        <CardRegistrationPicker
          products={availableProducts}
          disabled={Boolean(pendingCard)}
          benefitSummary={(product) =>
            (benefits[product.product_id] ?? [])
              .map((rule) => rule.benefit_name ?? rule.benefit_type ?? '혜택')
              .join(', ') || '혜택 정보 없음'}
          onRegister={(product, details) => void onToggle(product, details)}
          onRetry={onRetry}
        />
      )}
      <section className="benefit-guide">
        <div className="chart-heading"><div><b>카드별 받을 수 있는 혜택</b><small>카드 상품 혜택 정보</small></div><span className="guide-filter">카드 상품</span></div>
        <div className="benefit-table" role="table" aria-label="카드 상품 혜택표">
          <div className="benefit-table-head" role="row"><span>카드</span><span>혜택</span><span>카드사</span><span>보유</span></div>
          {registrableProducts(products).map((product, index) => (
            <div className={`benefit-table-row ${activeProductIds.has(product.product_id) ? 'recommended' : ''}`} role="row" key={product.product_id}>
              <b><i className={`table-dot ${['blue', 'green', 'orange', 'pink'][index % 4]}`} />{cardLabel(product.product_name)}</b>
              <span>{(benefits[product.product_id] ?? [])[0]?.benefit_name ?? (benefits[product.product_id] ?? [])[0]?.benefit_type ?? '—'}</span>
              <span>{cardMeta(product)}</span>
              <strong>{activeProductIds.has(product.product_id) ? '보유' : '—'}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function RechargeScreen({
  userName,
  wallet,
  walletFallback,
  walletError,
  onTopUp,
  onBack,
}: {
  userName: string | null
  wallet: WalletBalance | null
  walletFallback: boolean
  walletError: string
  onTopUp: (payload: {
    request_id: string
    amount_won: number
    wallet_id?: string
  }) => Promise<{ amount_won: number; balance_won: number }>
  onBack: () => void
}) {
  const [amount, setAmount] = useState('30000')
  const [walletId, setWalletId] = useState(wallet?.wallets[0]?.wallet_id ?? '')
  const [pending, setPending] = useState(false)
  const { showToast } = useToast()
  const requestRef = useRef<{
    amountWon: number
    walletId: string
    requestId: string
  } | null>(null)
  const quickAmounts = ['10000', '30000', '50000', '100000']

  const submitTopUp = async () => {
    const amountWon = Number(amount)
    if (!Number.isSafeInteger(amountWon) || amountWon <= 0 || amountWon > 500_000) {
      showToast({ tone: 'info', message: '충전 금액은 1원 이상 500,000원 이하로 입력해 주세요.' })
      return
    }
    if (!wallet || !walletId) {
      showToast({ tone: 'error', message: walletError || '충전할 수 있는 활성 지갑이 없습니다.' })
      return
    }

    setPending(true)
    try {
      if (
        !requestRef.current ||
        requestRef.current.amountWon !== amountWon ||
        requestRef.current.walletId !== walletId
      ) {
        requestRef.current = {
          amountWon,
          walletId,
          requestId: globalThis.crypto.randomUUID(),
        }
      }
      const topUp = await onTopUp({
        request_id: requestRef.current.requestId,
        amount_won: amountWon,
        wallet_id: walletId,
      })
      requestRef.current = null
      showToast({
        tone: 'success',
        message: `${formatWon(topUp.amount_won)} 충전 완료 · 잔액 ${formatWon(topUp.balance_won)}`,
      })
    } catch (cause) {
      showToast({ tone: 'error', message: failureMessage(cause, '충전을 완료하지 못했습니다.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="screen-content recharge-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>충전</strong><button aria-label="충전 안내">?</button></div>
      <section className="recharge-balance"><span>{userName ?? '로그인 사용자'} · 현재 잔액</span><strong>{wallet ? formatWon(wallet.balance_won) : '잔액 조회 불가'}</strong><small>{walletFallback ? walletError : wallet ? '표시용 잔액 · 실제 금액 변동 없음' : walletError || '지갑 정보를 확인할 수 없습니다.'}</small></section>
      <section className="recharge-panel">
        <h3>충전 금액</h3>
        <div className="amount-input"><input aria-label="충전 금액" inputMode="numeric" value={Number(amount).toLocaleString('ko-KR')} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))} /><b>원</b></div>
        <div className="amount-chips">{quickAmounts.map((value) => <button key={value} className={amount === value ? 'selected' : ''} onClick={() => setAmount(value)}>+{Number(value).toLocaleString('ko-KR')}원</button>)}</div>
        {wallet && wallet.wallets.length > 1 && (
          <label className="profile-field">충전 지갑
            <select value={walletId} onChange={(event) => setWalletId(event.target.value)}>
              {wallet.wallets.map((item) => <option key={item.wallet_id} value={item.wallet_id}>{item.wallet_id} · {formatWon(item.balance_won)}</option>)}
            </select>
          </label>
        )}
        <button className="primary-action" disabled={pending || !wallet || walletFallback} onClick={() => void submitTopUp()}>{pending ? '처리 중…' : walletFallback ? '현재 이용할 수 없습니다' : `${Number(amount || 0).toLocaleString('ko-KR')}원 충전`}</button>
        <p className="recharge-note">{walletFallback ? '현재 잔액 정보를 확인할 수 없어 충전할 수 없습니다.' : '충전 및 잔액은 서비스 시뮬레이션 기준으로 표시됩니다.'}</p>
      </section>
      <section className="auto-charge"><div><b>잔액 부족 시 자동충전</b><small>자동충전은 지원하지 않습니다.</small></div><Toggle on={false} disabled label="자동충전 미지원" onChange={() => {}} /></section>
    </div>
  )
}

function ReportScreen({
  payments,
  onBack,
}: {
  payments: PaymentRecord[]
  onBack: () => void
}) {
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const now = new Date()
  const series = period === 'month'
    ? Array.from({ length: 6 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        return {
          label: `${date.getMonth() + 1}월`,
          amount: payments
            .filter((payment) => payment.event_at.slice(0, 7) === key)
            .reduce((sum, payment) => sum + payment.amount_won, 0),
        }
      })
    : Array.from({ length: 5 }, (_, index) => {
        const year = now.getFullYear() - 4 + index
        return {
          label: String(year),
          amount: payments
            .filter((payment) => Number(payment.event_at.slice(0, 4)) === year)
            .reduce((sum, payment) => sum + payment.amount_won, 0),
        }
      })
  const max = Math.max(1, ...series.map((item) => item.amount))
  const total = series.reduce((sum, item) => sum + item.amount, 0)
  const benefitTotal = payments.reduce((sum, payment) => sum + (payment.awarded_benefit_won ?? 0), 0)
  const cards = new Map<string, { name: string; amount: number }>()
  for (const payment of payments) {
    const name = cardLabel(payment.product_name ?? '카드 정보 없음')
    const current = cards.get(payment.user_card_id) ?? { name, amount: 0 }
    current.amount += payment.awarded_benefit_won ?? 0
    cards.set(payment.user_card_id, current)
  }

  return (
    <div className="screen-content report-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>사용 리포트</strong><BarChart3 size={19} color="#3182f6" /></div>
      <div className="report-summary">
        <div><span>{period === 'month' ? '최근 6개월 승인 결제' : '최근 5년 승인 결제'}</span><strong>{formatWon(total)}</strong><small>최근 결제 이용 내역 기준</small></div>
        <div className="report-ring"><b>{formatWon(benefitTotal)}</b><span>기록된 혜택</span></div>
      </div>
      <div className="report-tabs"><button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>월별</button><button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>연도별</button></div>
      <section className="chart-card">
        <div className="chart-heading"><div><b>{period === 'month' ? '월별 사용금액' : '연도별 사용금액'}</b><small>승인 완료된 결제 이력 기준</small></div><strong>{formatWon(total)}</strong></div>
        <div className={`bar-chart ${period === 'year' ? 'yearly' : ''}`}>
          {series.map((item) => <div className="bar-column" key={item.label}><span>{item.amount ? `${Math.round(item.amount / 10000)}만` : ''}</span><div className="bar-track"><i style={{ height: `${Math.max(4, item.amount / max * 100)}%` }} /></div><b>{item.label}</b></div>)}
        </div>
      </section>
      <section className="category-card">
        <div className="chart-heading"><div><b>카테고리별 비율</b><small>가맹점 업종 정보가 없습니다.</small></div><strong>집계 불가</strong></div>
        <p className="empty-state">가맹점 업종이 거래 이력에 포함되면 실제 비율을 표시할 수 있습니다.</p>
      </section>
      <section className="card-compare-card">
        <div className="chart-heading"><div><b>카드별 혜택 비교</b><small>결제 이용 내역에 기록된 적립 혜택</small></div><span>이용 내역</span></div>
        {[...cards.entries()].map(([id, card], index) => (
          <div className={`compare-row ${index === 0 ? 'featured' : ''}`} key={id}>
            <div className={`compare-icon ${['', 'pod', 'zip', 'bread'][index % 4]}`}>{card.name.slice(0, 1)}</div>
            <div className="compare-name"><b>{card.name}</b><small>결제 이용 내역</small></div>
            <div className="compare-value"><strong>{formatWon(card.amount)}</strong><small>기록된 혜택</small></div>
            <div className="compare-bar"><i style={{ width: `${benefitTotal ? Math.max(5, card.amount / benefitTotal * 100) : 0}%` }} /></div>
          </div>
        ))}
        {!cards.size && <p className="empty-state">비교할 결제 이력이 없습니다.</p>}
      </section>
    </div>
  )
}

const ENROLLMENT_STATUS = /^(재학|휴학|졸업|제적|수료|자퇴)$/

function studentIdentityMeta(card: UserIdentityCard) {
  const parts = card.subtitle
    .replace(/\s*\(데모\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  const enrollment = parts.length > 1 && ENROLLMENT_STATUS.test(parts[parts.length - 1]) ? parts.pop() ?? '' : ''
  return {
    university: card.issuer_name,
    name: card.holder_name,
    details: parts.join(' · '),
    enrollment,
  }
}

function MyPlatform({
  profile,
  profileFallback,
  profileError,
  identityCards,
  identityCardError,
  hasOnepassCard,
  cardDesign,
  onIssueOnepass,
  onSave,
  onBack,
}: {
  profile: UserProfile | null
  profileFallback: boolean
  profileError: string
  identityCards: UserIdentityCard[]
  identityCardError: string
  hasOnepassCard: boolean
  cardDesign: DongiImageVariant
  onIssueOnepass: () => void
  onSave: (payload: {
    display_name: string
    student_card_id: string | null
    university: string | null
    department: string | null
    phone_number: string | null
    address: string | null
  }) => Promise<void>
  onBack: () => void
}) {
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [studentCardId, setStudentCardId] = useState(profile?.student_card_id ?? '')
  const [university, setUniversity] = useState(profile?.university ?? '')
  const [department, setDepartment] = useState(profile?.department ?? '')
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? '')
  const [address, setAddress] = useState(profile?.address ?? '')
  const [pending, setPending] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const { showToast } = useToast()
  const studentIdentityCard = identityCards.find((card) => card.card_type === 'STUDENT')
  const civicIdentityCard = identityCards.find((card) => card.card_type !== 'STUDENT')
  const studentMeta = studentIdentityCard ? studentIdentityMeta(studentIdentityCard) : null
  const cardImage = ONEPASS_CARD_IMAGES[cardDesign]
  const cardOrientation = cardImage.height > cardImage.width ? 'portrait' : 'landscape'

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '')
    setStudentCardId(profile?.student_card_id ?? '')
    setUniversity(profile?.university ?? '')
    setDepartment(profile?.department ?? '')
    setPhoneNumber(profile?.phone_number ?? '')
    setAddress(profile?.address ?? '')
  }, [profile])

  const saveProfile = async () => {
    if (!displayName.trim()) {
      showToast({ tone: 'info', message: '이름을 입력해 주세요.' })
      return
    }
    setPending(true)
    try {
      await onSave({
        display_name: displayName.trim(),
        student_card_id: studentCardId.trim() || null,
        university: university.trim() || null,
        department: department.trim() || null,
        phone_number: phoneNumber.trim() || null,
        address: address.trim() || null,
      })
      showToast({ tone: 'success', message: NOTICE.settingsSaved })
    } catch (cause) {
      showToast({ tone: 'error', message: failureMessage(cause, '프로필을 저장하지 못했습니다.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="screen-content platform-screen">
      <div className="detail-head">
        <button
          onClick={() => editingProfile ? setEditingProfile(false) : onBack()}
          aria-label="뒤로"
        >
          <ArrowLeft size={19} />
        </button>
        <strong>{editingProfile ? '프로필 및 연락처 관리' : 'MY 플랫폼'}</strong>
        {editingProfile && <button className="profile-cancel" onClick={() => setEditingProfile(false)}>취소</button>}
      </div>
      <section className="identity-sections">
        <div className="citizen-auth-heading">
          <h2>부산시민 인증</h2>
          <span>{civicIdentityCard ? '시민 정보 등록' : '인증이 필요합니다'}</span>
        </div>
        <section className="identity-display" aria-labelledby="student-identity-title">
          <h2 id="student-identity-title" className="sr-only">{studentIdentityCard?.title ?? '대학교 학생증'}</h2>
          {identityCardError && <p className="identity-card-error" role="status">{identityCardError}</p>}
          {hasOnepassCard && (
            <div className={`identity-artwork student-id-artwork is-${cardOrientation}`}>
              <DongiImage variant={cardDesign} alt="발급받은 원패스 카드 디자인의 학생증" className="identity-artwork-image" />
            </div>
          )}
          <div className="student-id-meta">
            {studentMeta ? (
              <>
                <span className="student-id-university">{studentMeta.university}</span>
                <strong className="student-id-holder">{studentMeta.name}</strong>
                {studentMeta.details && <span className="student-id-details">{studentMeta.details}</span>}
                {studentMeta.enrollment && <span className="student-id-badge">{studentMeta.enrollment}</span>}
              </>
            ) : (
              <>
                <span className="student-id-university">학생증 인증</span>
                <strong className="student-id-holder">인증이 필요합니다</strong>
                <span className="student-id-details">대학교 학생증 인증을 완료하면 학생증이 표시됩니다.</span>
              </>
            )}
          </div>
          {!hasOnepassCard && (
            <div className="identity-issue-notice" role="status">
              <span>아직 발급받은 원패스 카드가 없어요.</span>
              <button type="button" className="primary-action" onClick={onIssueOnepass}>원패스 카드 발급받기</button>
            </div>
          )}
        </section>
      </section>
      {!editingProfile ? (
        <section className="profile-edit-entry">
          <div>
            <span className="pink-label">계정 정보</span>
            <h2>프로필 및 연락처 관리</h2>
            <p>{profile?.display_name ?? '저장된 프로필과 연락처 정보를 관리합니다.'}</p>
          </div>
          <button
            className="primary-action"
            disabled={profileFallback}
            onClick={() => setEditingProfile(true)}
          >
            프로필 수정
          </button>
        </section>
      ) : (
        <section className="student-card profile-editor">
          <span className="pink-label">계정 정보</span>
          <h2>프로필 및 연락처 관리</h2>
          <p>저장된 프로필 및 연락처 정보를 수정합니다.</p>
          <div className="profile-fields">
            <label className="profile-field">이름<input value={displayName} maxLength={80} disabled={profileFallback} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
            <label className="profile-field">학생증 ID<input value={studentCardId} maxLength={64} disabled={profileFallback} onChange={(event) => setStudentCardId(event.target.value)} /></label>
            <label className="profile-field">대학교<input value={university} maxLength={120} disabled={profileFallback} onChange={(event) => setUniversity(event.target.value)} autoComplete="organization" /></label>
            <label className="profile-field">학과<input value={department} maxLength={120} disabled={profileFallback} onChange={(event) => setDepartment(event.target.value)} /></label>
            <label className="profile-field">휴대폰 번호<input value={phoneNumber} maxLength={32} disabled={profileFallback} onChange={(event) => setPhoneNumber(event.target.value)} inputMode="tel" autoComplete="tel" /></label>
            <label className="profile-field">주소<input value={address} maxLength={300} disabled={profileFallback} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" /></label>
          </div>
          <button className="primary-action" disabled={pending || profileFallback} onClick={() => void saveProfile()}>{pending ? '저장 중…' : profileFallback ? '현재 수정할 수 없습니다' : '프로필 저장'}</button>
        </section>
      )}
      <div className="settings-list"><div>원패스 카드&nbsp; · &nbsp;시민 생활 서비스</div><div>마케팅 및 혜택 알림 설정 · 미연결</div></div>
    </div>
  )
}

type BarcodeDetection = { rawValue: string }
type BarcodeDetectorLike = {
  detect: (video: HTMLVideoElement) => Promise<BarcodeDetection[]>
}
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike

const MAX_QR_PAY_AMOUNT_WON = 9_999_999
const QUICK_AMOUNTS_WON = [5000, 10000, 20000]

function QrPayScreen({
  userId,
  merchantId,
  merchants,
  userCards,
  wallet,
  onBack,
  onPaid,
}: {
  userId: string
  merchantId: string
  merchants: Merchant[]
  userCards: UserCard[]
  wallet: WalletBalance | null
  onBack: () => void
  onPaid: (summary: PaymentSummary) => Promise<void>
}) {
  const knownMerchant = merchants.find((item) => item.merchant_id === merchantId) ?? null
  const [fetchedMerchant, setFetchedMerchant] = useState<Merchant | null>(null)
  const [merchantError, setMerchantError] = useState('')
  const [amount, setAmount] = useState('')
  const [recommendation, setRecommendation] = useState<PaymentRecommendation | null>(null)
  const [recommendationError, setRecommendationError] = useState('')
  const [recommending, setRecommending] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState('')
  const [paying, setPaying] = useState(false)
  const payingRef = useRef(false)
  const requestIdRef = useRef<string | null>(null)
  const { showToast } = useToast()
  const merchant = knownMerchant ?? fetchedMerchant
  const amountWon = Number(amount)
  const amountValid = Number.isInteger(amountWon) && amountWon > 0 && amountWon <= MAX_QR_PAY_AMOUNT_WON

  useEffect(() => {
    if (knownMerchant || !merchantId) return
    const controller = new AbortController()
    api.getMerchant(merchantId, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setFetchedMerchant(result)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setMerchantError(
          cause instanceof ApiError && cause.status === 404
            ? '등록되지 않은 가맹점 QR 코드입니다.'
            : '가맹점 정보를 불러오지 못했습니다.',
        )
      })
    return () => controller.abort()
  }, [knownMerchant, merchantId])

  useEffect(() => {
    setRecommendation(null)
    setSelectedCardId('')
    setRecommendationError('')
    requestIdRef.current = null
    if (!merchant || !amountValid || !userCards.length) {
      setRecommending(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setRecommending(true)
      api.recommendPayment(
        { user_id: userId, merchant_id: merchant.merchant_id, amount_won: amountWon },
        { signal: controller.signal },
      )
        .then((result) => {
          if (controller.signal.aborted) return
          setRecommendation(result)
          setSelectedCardId(result.recommended_user_card_id ?? '')
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return
          setRecommendationError(cause instanceof Error ? cause.message : '추천 정보를 불러오지 못했습니다.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setRecommending(false)
        })
    }, 300)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [merchant, amountValid, amountWon, userCards.length, userId])

  const selectCard = (userCardId: string) => {
    setSelectedCardId(userCardId)
    requestIdRef.current = null
  }

  const selected = recommendation?.candidates.find((item) => item.user_card_id === selectedCardId) ?? null
  const canPay = Boolean(merchant && amountValid && selected && !paying && !recommending)

  const pay = async () => {
    if (payingRef.current || !merchant || !selected || !amountValid) return
    payingRef.current = true
    setPaying(true)
    requestIdRef.current ??= newRequestId()
    try {
      const result = await api.createPayment({
        request_id: requestIdRef.current,
        user_id: userId,
        user_card_id: selected.user_card_id,
        merchant_id: merchant.merchant_id,
        amount_won: amountWon,
      })
      const detail = await api.getPaymentDetail(result.tx_id).catch(() => null)
      await onPaid({
        txId: result.tx_id,
        merchantName: merchant.merchant_name ?? merchant.merchant_id,
        amountWon,
        productName: selected.product_name,
        expectedBenefitWon: selected.expected_benefit_won,
        awardedBenefitWon: result.awarded_benefit_won ?? (detail ? detail.awarded_benefit_won ?? 0 : null),
        balanceBeforeWon: result.balance_before_won ?? null,
        balanceAfterPaymentWon: result.balance_after_payment_won ?? null,
        balanceAfterWon: result.balance_after_won ?? null,
        fundingType: result.funding_type ?? null,
        fundingBeforeWon: result.funding_balance_before_won ?? null,
        fundingAfterWon: result.funding_balance_after_won ?? null,
        benefitReason: result.benefit_reason ?? null,
        benefitStatus: result.benefit_status ?? null,
        paidAt: result.event_at,
      })
      showToast({ tone: 'success', message: NOTICE.paymentDone })
    } catch (cause) {
      payingRef.current = false
      setPaying(false)
      showToast({ tone: 'error', message: failureMessage(cause, NOTICE.paymentFailed) })
    }
  }

  return (
    <div className="screen-content detail-screen qr-pay-screen">
      <div className="detail-head">
        <button onClick={onBack} aria-label="뒤로" disabled={paying}><ArrowLeft size={19} /></button>
        <strong>QR 결제</strong>
        <span aria-hidden="true" />
      </div>
      <section className="qr-pay-merchant">
        <span>결제할 가맹점</span>
        <strong>{merchant ? merchant.merchant_name ?? merchant.merchant_id : merchantError || '가맹점 확인 중…'}</strong>
        {merchant && <small>{merchant.merchant_id}</small>}
      </section>
      <section className="pay-section">
        <div className="section-title"><h3>결제 금액</h3><span>보유 잔액 {wallet ? formatWon(wallet.balance_won) : '확인 불가'}</span></div>
        <label className="form-field">금액 입력
          <div className="amount-input">
            <input
              aria-label="결제 금액"
              inputMode="numeric"
              autoComplete="off"
              placeholder="금액을 입력해 주세요"
              value={amount}
              disabled={paying}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
            />
            <b>원</b>
          </div>
        </label>
        <div className="quick-amounts">
          {QUICK_AMOUNTS_WON.map((value) => (
            <button key={value} type="button" disabled={paying} onClick={() => setAmount(String(value))}>{formatWon(value)}</button>
          ))}
        </div>
        <div className="recommend">
          {recommending && <LoaderCircle className="spin" size={17} />}
          {recommendation ? (
            recommendation.candidates.length ? (
              <>
                <small>결제 카드를 확인해 주세요. 예상 혜택은 결제 전 추정값입니다.</small>
                <ol className="benefit-comparison-list">
                  {recommendation.candidates
                    .slice()
                    .sort((left, right) => right.expected_benefit_won - left.expected_benefit_won)
                    .map((candidate) => (
                      <li
                        key={candidate.user_card_id}
                        className={candidate.user_card_id === selectedCardId ? 'recommended selectable selected' : 'selectable'}
                      >
                        <button
                          type="button"
                          className="candidate-select"
                          disabled={paying || candidate.payable === false}
                          aria-pressed={candidate.user_card_id === selectedCardId}
                          onClick={() => selectCard(candidate.user_card_id)}
                        >
                          <span>
                            <b>{cardLabel(candidate.product_name ?? '카드 상품')}{candidate.user_card_id === recommendation.recommended_user_card_id ? ' · 추천' : ''}</b>
                            <small>{candidate.payable === false ? `결제 불가 (${candidate.payable_reason ?? '사용 조건 미충족'})` : '결제 가능'}</small>
                          </span>
                          <strong>{candidateBenefitLabel(candidate)}</strong>
                        </button>
                      </li>
                    ))}
                </ol>
              </>
            ) : <small>결제에 사용할 수 있는 카드가 없습니다.</small>
          ) : (
            <small>{recommendationError || (userCards.length ? '금액을 입력하면 최적 결제 카드와 예상 혜택을 조회합니다.' : '내 카드 관리에서 카드를 연결해 주세요.')}</small>
          )}
        </div>
        <button
          type="button"
          className="primary-action qr-pay-submit"
          disabled={!canPay}
          aria-busy={paying}
          onClick={() => void pay()}
        >
          {paying ? <><LoaderCircle className="spin" size={18} /> 결제 처리 중…</> : `${amountValid ? formatWon(amountWon) : ''} 결제하기`.trim()}
        </button>
      </section>
    </div>
  )
}

function QrScanScreen({
  merchants,
  error,
  onError,
  onDetected,
  onBack,
}: {
  merchants: Merchant[]
  error: string
  onError: (message: string) => void
  onDetected: (value: string) => void
  onBack: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const detectedRef = useRef(onDetected)
  const errorRef = useRef(onError)
  const [cameraError, setCameraError] = useState('')
  const [manualValue, setManualValue] = useState('')

  detectedRef.current = onDetected
  errorRef.current = onError

  useEffect(() => {
    let disposed = false
    let stream: MediaStream | null = null
    let timer: number | undefined
    let detector: BarcodeDetectorLike | null = null

    const scan = async () => {
      if (disposed || !detector || !videoRef.current || videoRef.current.readyState < 2) {
        return
      }
      try {
        const [result] = await detector.detect(videoRef.current)
        if (disposed) return
        if (result?.rawValue) {
          detectedRef.current(result.rawValue)
          return
        }
      } catch {
        if (!disposed) {
          errorRef.current('카메라 화면에서 QR을 읽지 못했습니다. 다시 비추거나 코드를 직접 입력해 주세요.')
        }
      }
      if (!disposed) timer = window.setTimeout(() => void scan(), 350)
    }

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('이 브라우저에서는 카메라를 사용할 수 없습니다. QR 문자열을 직접 입력해 주세요.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const video = videoRef.current
        if (!video) {
          throw new Error('카메라 화면을 표시할 수 없습니다.')
        }
        video.srcObject = stream
        await video.play()

        const Detector = (window as Window & {
          BarcodeDetector?: BarcodeDetectorConstructor
        }).BarcodeDetector
        if (Detector) {
          detector = new Detector({ formats: ['qr_code'] })
          void scan()
        }
      } catch (cause) {
        if (!disposed) {
          setCameraError(
            cause instanceof Error
              ? `카메라를 열지 못했습니다: ${cause.message}`
              : '카메라를 열지 못했습니다. 브라우저 카메라 권한과 HTTPS 연결을 확인해 주세요.',
          )
        }
      }
    }

    void startCamera()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [])

  const submitManualQr = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onDetected(manualValue)
  }

  return (
    <div className="screen-content qr-scan-screen">
      <div className="detail-head">
        <button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button>
        <strong>QR 결제</strong>
        <span className="verified">체험</span>
      </div>
      <section className="qr-camera-card">
        <p>가맹점 QR 코드를 사각형 안에 맞춰 주세요.</p>
        <div className="qr-camera-view">
          <video ref={videoRef} autoPlay playsInline muted aria-label="QR 스캔 카메라 화면" />
          <span className="qr-scan-frame" aria-hidden="true" />
        </div>
        {cameraError && <p className="identity-card-error" role="status">{cameraError}</p>}
        {error && <p className="identity-card-error" role="alert">{error}</p>}
      </section>
    </div>
  )
}
