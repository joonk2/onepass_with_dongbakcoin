'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Bell,
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
import {
  api,
  ApiError,
  DEMO_USER_ID,
  type BenefitRule,
  type CardProduct,
  type Merchant,
  type PaymentRecord,
  type PaymentRecommendation,
  type UserCard,
  type UserProfile,
  type WalletBalance,
} from '@/lib/api'

type Screen = 'home' | 'card' | 'manage' | 'platform' | 'recharge' | 'report'

const quickLinks = [
  { label: '동백+', icon: Sparkles, tone: 'pink' },
  { label: '동백택시', icon: TrainFront, tone: 'gray' },
  { label: '동백드림', icon: Heart, tone: 'rose' },
  { label: '동백몰', icon: ShoppingBag, tone: 'mint' },
]

const formatWon = (amount: number) => `${amount.toLocaleString('ko-KR')}원`

function optionalApiMessage(
  cause: unknown,
  notFoundMessage: string,
  fallbackMessage: string,
): string {
  if (cause instanceof ApiError && cause.status === 404) return notFoundMessage
  return cause instanceof Error ? cause.message : fallbackMessage
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
  const [screen, setScreen] = useState<Screen>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [products, setProducts] = useState<CardProduct[]>([])
  const [userCards, setUserCards] = useState<UserCard[]>([])
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [benefits, setBenefits] = useState<Record<string, BenefitRule[]>>({})
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [wallet, setWallet] = useState<WalletBalance | null>(null)
  const [profileError, setProfileError] = useState('')
  const [walletError, setWalletError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingCard, setPendingCard] = useState('')

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const [loadedProducts, loadedCards, loadedMerchants, history] =
        await Promise.all([
          api.getProducts({ signal }),
          api.getUserCards(DEMO_USER_ID, { signal }),
          api.getMerchants({ signal }),
          api.getPaymentHistory(DEMO_USER_ID, { signal }),
        ])
      if (signal?.aborted) return
      const [loadedProfile, loadedWallet] = await Promise.allSettled([
        api.getProfile(DEMO_USER_ID, { signal }),
        api.getWalletBalance(DEMO_USER_ID, { signal }),
      ])
      if (signal?.aborted) return
      setProducts(loadedProducts)
      setUserCards(loadedCards)
      setMerchants(loadedMerchants)
      setPayments(history.payments)
      if (loadedProfile.status === 'fulfilled') {
        setProfile(loadedProfile.value)
        setProfileError('')
      } else {
        setProfile(null)
        setProfileError(
          optionalApiMessage(
            loadedProfile.reason,
            '프로필 API가 아직 배포되지 않았거나 데모 사용자 데이터가 없습니다.',
            '프로필 정보를 불러오지 못했습니다.',
          ),
        )
      }
      if (loadedWallet.status === 'fulfilled') {
        setWallet(loadedWallet.value)
        setWalletError('')
      } else {
        setWallet(null)
        setWalletError(
          optionalApiMessage(
            loadedWallet.reason,
            '잔액 API가 아직 배포되지 않았거나 활성 지갑이 없습니다.',
            '지갑 잔액을 불러오지 못했습니다.',
          ),
        )
      }
      setError('')
    } catch (cause) {
      if (signal?.aborted) return
      setError(
        cause instanceof Error ? cause.message : '서비스 정보를 불러오지 못했습니다.',
      )
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadData(controller.signal)
    return () => controller.abort()
  }, [loadData])

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
  const approvedPayments = useMemo(
    () =>
      payments
        .filter((payment) => payment.approval_status === 'APPROVED')
        .sort((left, right) => Date.parse(right.event_at) - Date.parse(left.event_at)),
    [payments],
  )

  const handleCardToggle = async (product: CardProduct) => {
    const linked = activeCards.find((card) => card.product_id === product.product_id)
    setPendingCard(product.product_id)
    setError('')
    try {
      if (linked) {
        await api.removeUserCard(DEMO_USER_ID, linked.user_card_id)
      } else {
        await api.addUserCard(DEMO_USER_ID, product.product_id)
      }
      await loadData()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '카드 연결을 변경하지 못했습니다.',
      )
    } finally {
      setPendingCard('')
    }
  }

  const handleProfileUpdate = async (payload: {
    display_name: string
    student_card_id: string | null
    phone_number: string | null
    address: string | null
  }) => {
    const updatedProfile = await api.updateProfile(DEMO_USER_ID, payload)
    setProfile(updatedProfile)
    setProfileError('')
  }

  const handleWalletTopUp = async (payload: {
    request_id: string
    amount_won: number
    wallet_id?: string
  }) => {
    const result = await api.createWalletTopUp(DEMO_USER_ID, payload)
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
    setWalletError('')
    return result
  }

  return (
    <main className={`app-shell ${screen === 'report' ? 'report-active' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><DongbaekMark small /></div>
          <div><b>동백전</b><span>부산시민플랫폼</span></div>
        </div>
        <div className="header-actions">
          <button aria-label="알림"><Bell size={19} /></button>
          <button aria-label="전체메뉴" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="주요 메뉴">
        <button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}><Home size={18} />홈</button>
        <button className={screen === 'platform' ? 'active' : ''} onClick={() => setScreen('platform')}><Grid2X2 size={18} />MY 플랫폼</button>
        <button className={screen === 'manage' ? 'active' : ''} onClick={() => setScreen('manage')}><WalletCards size={18} />내 원카드</button>
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
          <div className="api-loading"><LoaderCircle className="spin" size={22} /> API 데이터를 불러오는 중입니다.</div>
        ) : (
          <>
            {screen === 'home' && (
              <HomeScreen
                userName={profile?.display_name ?? null}
                wallet={wallet}
                walletError={walletError}
                payments={approvedPayments}
                cardCount={activeCards.length}
                onOpenCard={() => setScreen('card')}
                onOpenRecharge={() => setScreen('recharge')}
                onOpenReport={() => setScreen('report')}
                onOpenMenu={() => setMenuOpen(true)}
              />
            )}
            {screen === 'card' && (
              <CardDetail
                userId={DEMO_USER_ID}
                merchants={merchants}
                userCards={activeCards}
                payments={approvedPayments}
                onBack={() => setScreen('home')}
                onPaymentComplete={loadData}
                onError={setError}
              />
            )}
            {screen === 'manage' && (
              <CardManager
                products={products}
                userCards={activeCards}
                payments={approvedPayments}
                benefits={benefits}
                displayName={profile?.display_name ?? null}
                pendingCard={pendingCard}
                onBack={() => setScreen('home')}
                onToggle={handleCardToggle}
              />
            )}
            {screen === 'platform' && (
              <MyPlatform
                profile={profile}
                profileError={profileError}
                onSave={handleProfileUpdate}
                onBack={() => setScreen('home')}
              />
            )}
            {screen === 'recharge' && (
              <RechargeScreen
                userName={profile?.display_name ?? null}
                wallet={wallet}
                walletError={walletError}
                onTopUp={handleWalletTopUp}
                onBack={() => setScreen('home')}
              />
            )}
            {screen === 'report' && (
              <ReportScreen payments={approvedPayments} onBack={() => setScreen('home')} />
            )}
          </>
        )}
      </div>

      <footer className="app-footer">
        <span>부산광역시&nbsp; | &nbsp;BNK부산은행</span>
        <span>DEMO · 실제 금융 결제 아님</span>
      </footer>

      {menuOpen && (
        <div className="menu-overlay" role="dialog" aria-modal="true" aria-label="전체 메뉴">
          <div className="menu-sheet">
            <div className="sheet-head"><h2>전체 메뉴</h2><button onClick={() => setMenuOpen(false)} aria-label="닫기"><X /></button></div>
            <button onClick={() => { setScreen('manage'); setMenuOpen(false) }}><CreditCard size={19} /><span><b>내 원카드 관리</b><small>연결 카드와 혜택 확인</small></span><ChevronRight /></button>
            <button onClick={() => { setScreen('platform'); setMenuOpen(false) }}><Receipt size={19} /><span><b>내정보 관리</b><small>{profile?.display_name ?? '프로필 정보 미등록'}</small></span><ChevronRight /></button>
            <button onClick={() => { setScreen('recharge'); setMenuOpen(false) }}><CreditCard size={19} /><span><b>동백전 충전</b><small>데모 모의 충전</small></span><ChevronRight /></button>
            <button><MapIcon size={19} /><span><b>15분도시 생활권맵</b><small>내 주변 생활시설 찾기</small></span><ChevronRight /></button>
          </div>
        </div>
      )}
    </main>
  )
}

function HomeScreen({
  userName,
  wallet,
  walletError,
  payments,
  cardCount,
  onOpenCard,
  onOpenRecharge,
  onOpenReport,
  onOpenMenu,
}: {
  userName: string | null
  wallet: WalletBalance | null
  walletError: string
  payments: PaymentRecord[]
  cardCount: number
  onOpenCard: () => void
  onOpenRecharge: () => void
  onOpenReport: () => void
  onOpenMenu: () => void
}) {
  const recent = payments[0]
  const total = payments.reduce((sum, payment) => sum + payment.amount_won, 0)
  return (
    <div className="screen-content">
      <div className="user-row">
        <div className="avatar">{userName?.slice(0, 1) ?? '동'}</div>
        <strong>{userName ?? '프로필 정보 미등록'}</strong>
        <div className="user-actions"><Bell size={18} /><button onClick={onOpenMenu} aria-label="메뉴"><Menu size={20} /></button></div>
      </div>
      <section className="balance-card">
        <div className="balance-top"><span>동백전&nbsp; | &nbsp;QR결제&nbsp; | &nbsp;가맹점찾기</span><span>{wallet ? '데모 잔액' : '잔액 확인 필요'}</span></div>
        <strong>{wallet ? formatWon(wallet.balance_won) : '잔액 조회 불가'}</strong>
        <div className="pass"><span>결제 내역</span><b>{payments.length}건 · {formatWon(total)}</b></div>
      </section>
      <button className="recharge-shortcut" onClick={onOpenRecharge}><span><CreditCard size={15} /> 충전하기</span><b>{wallet ? '모의 충전' : '잔액 정보 확인 필요'}</b><ChevronRight size={16} /></button>
      <button className="report-shortcut" onClick={onOpenReport}><span><BarChart3 size={16} /> 월별 사용 리포트</span><b>연결된 결제 내역 기준</b><ChevronRight size={16} /></button>
      <section className="walk-card"><div><b>조금 더 걸어볼까요?</b><br /><span>산책이라도 나설까요?</span><small>걷기사용 · 오늘의 걸음은 연결 후 표시됩니다</small></div><span className="walk-icon">◜◡◝</span></section>
      <div className="bento">
        <button onClick={onOpenMenu}><b>MY 플랫폼</b><span>내 정보를<br />한번에 확인하세요!</span><small>› 내정보 관리</small></button>
        <button onClick={onOpenCard}><b>동백원카드</b><span>내 카드와 혜택을 확인해요</span></button>
        <button onClick={onOpenReport}><b>월별 사용 리포트</b><span>실제 결제 내역으로 확인해요</span></button>
      </div>
      <div className="quick-grid">{quickLinks.map(({ label, icon: Icon, tone }) => <button key={label}><span className={`quick-icon ${tone}`}><Icon size={17} /></span><b>{label}</b></button>)}</div>
      <section className="api-panel">
        <div className="chart-heading"><div><b>최근 결제 내역</b><small>백엔드 결제 이력 API</small></div><button onClick={onOpenReport}>전체 보기 ›</button></div>
        {recent ? (
          <div className="recent-payment">
            <div><b>{recent.merchant_name ?? '가맹점'}</b><small>{recent.product_name ?? '카드'} · {new Date(recent.event_at).toLocaleDateString('ko-KR')}</small></div>
            <strong>{formatWon(recent.amount_won)}</strong>
          </div>
        ) : <p className="empty-state">표시할 결제 이력이 없습니다.</p>}
      </section>
    </div>
  )
}

function CardDetail({
  userId,
  merchants,
  userCards,
  payments,
  onBack,
  onPaymentComplete,
  onError,
}: {
  userId: string
  merchants: Merchant[]
  userCards: UserCard[]
  payments: PaymentRecord[]
  onBack: () => void
  onPaymentComplete: () => Promise<void>
  onError: (message: string) => void
}) {
  const [merchantId, setMerchantId] = useState('')
  const [amount, setAmount] = useState('')
  const [recommendation, setRecommendation] = useState<PaymentRecommendation | null>(null)
  const [recommendationError, setRecommendationError] = useState('')
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState(false)
  const [success, setSuccess] = useState('')
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
      setSuccess(`모의 결제가 승인되었습니다. 거래 ID: ${result.tx_id}`)
      await onPaymentComplete()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '모의 결제가 실패했습니다.')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="screen-content detail-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>동백원카드</strong><button onClick={onBack} aria-label="내 카드 관리"><Settings2 size={18} /></button></div>
      <section className="benefit-card"><div><span>이번 달 승인 결제 혜택</span><strong>{formatWon(thisMonthBenefit)}</strong><b>결제 이력 API 기준</b></div><div className="mascot">◔ᴥ◔</div></section>
      <section className="pay-section">
        <div className="section-title"><h3>어디서 결제하세요?</h3><span>카드 추천 후 모의 결제</span></div>
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
              <p>{recommendation.candidates.find((candidate) => candidate.user_card_id === recommendation.recommended_user_card_id)?.product_name ?? '추천 카드 없음'}</p>
              <small>{recommendation.candidates.length ? '보유 카드의 실제 추천 결과입니다.' : '이 사용자에게 연결된 카드가 없어 추천 결과가 없습니다.'}</small>
            </>
          ) : (
            <small>{recommendationError || (userCards.length ? '가맹점과 금액을 입력하면 보유 카드의 혜택을 조회합니다.' : '내 카드 관리에서 카드를 연결하면 결제 추천을 사용할 수 있습니다.')}</small>
          )}
          <button disabled={paying || !recommendation?.recommended_user_card_id} onClick={() => void pay()}>
            {paying ? '처리 중…' : '이 카드로 모의 결제하기'}
          </button>
          {success && <small className="success-message" role="status">{success}</small>}
        </div>
      </section>
      <div className="stats">
        <div><span>동백전 잔액</span><b>조회 API 미연결</b><a onClick={onBack}>홈에서 확인 ›</a></div>
        <div><span>연결된 카드</span><b>{userCards.length}장</b><i><em style={{ width: `${Math.min(100, userCards.length * 20)}%` }} /></i></div>
      </div>
    </div>
  )
}

function CardManager({
  products,
  userCards,
  payments,
  benefits,
  displayName,
  pendingCard,
  onBack,
  onToggle,
}: {
  products: CardProduct[]
  userCards: UserCard[]
  payments: PaymentRecord[]
  benefits: Record<string, BenefitRule[]>
  displayName: string | null
  pendingCard: string
  onBack: () => void
  onToggle: (product: CardProduct) => void
}) {
  const activeProductIds = new Set(userCards.map((card) => card.product_id))
  const connectedProducts = userCards.map((card) => ({
    card,
    product: products.find((item) => item.product_id === card.product_id),
  }))
  const availableProducts = products.filter((product) => !activeProductIds.has(product.product_id))
  const currentMonth = new Date().toISOString().slice(0, 7)

  return (
    <div className="screen-content manager-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>내 원카드 관리</strong><button onClick={onBack} aria-label="메뉴"><Menu size={19} /></button></div>
      <section className="primary-card"><div className="card-brand"><span className="mascot tiny">◔ᴥ◔</span><div><b>동백원카드</b><small>{displayName ?? '프로필 정보 미등록'} · 보유 카드 {userCards.length}장</small></div></div></section>
      <p className="list-label">내 보유 카드 {userCards.length}장</p>
      <section className="card-list">
        {connectedProducts.map(({ card, product }) => (
          <div className="card-row" key={card.user_card_id}>
            <div>
              <b>{product?.product_name ?? card.product_id}</b>
              <small>
                {product?.issuer ?? '카드 상품 정보 없음'} ·{' '}
                {(benefits[card.product_id] ?? []).length
                  ? `혜택 ${(benefits[card.product_id] ?? []).length}개`
                  : '혜택 정보 없음'}
              </small>
              {card.credit_limit_won != null && (
                <small>
                  카드 한도 {formatWon(card.credit_limit_won)} · 이번 달 결제{' '}
                  {formatWon(payments
                    .filter((payment) =>
                      payment.user_card_id === card.user_card_id &&
                      payment.event_at.slice(0, 7) === currentMonth,
                    )
                    .reduce((total, payment) => total + payment.amount_won, 0))}
                </small>
              )}
              {card.credit_limit_won == null && (
                <small>
                  한도 정보 없음 · 이번 달 결제{' '}
                  {formatWon(payments
                    .filter((payment) =>
                      payment.user_card_id === card.user_card_id &&
                      payment.event_at.slice(0, 7) === currentMonth,
                    )
                    .reduce((total, payment) => total + payment.amount_won, 0))}
                </small>
              )}
              {(benefits[card.product_id] ?? []).length > 0 && (
                <ul className="card-benefits">
                  {(benefits[card.product_id] ?? []).map((rule) => {
                    const caps = [
                      rule.per_tx_cap_won != null
                        ? `1회 최대 ${formatWon(rule.per_tx_cap_won)}`
                        : null,
                      rule.monthly_cap_won != null
                        ? `월 최대 ${formatWon(rule.monthly_cap_won)}`
                        : null,
                      rule.monthly_count_cap != null
                        ? `월 ${rule.monthly_count_cap}회`
                        : null,
                    ].filter((value): value is string => value !== null)
                    return (
                      <li key={rule.rule_id}>
                        <span>{rule.benefit_name ?? rule.benefit_type ?? '혜택'}</span>
                        {caps.length > 0 && <small>{caps.join(' · ')}</small>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <Toggle
              on
              label={`${product?.product_name ?? card.product_id} 연결 해제`}
              disabled={pendingCard === product?.product_id}
              onChange={() => product && onToggle(product)}
            />
          </div>
        ))}
        {!userCards.length && <p className="empty-state">현재 로그인 사용자에게 연결된 카드가 없습니다.</p>}
      </section>
      <p className="list-label">추가할 수 있는 카드 상품 {availableProducts.length}종</p>
      <section className="card-list">
        {availableProducts.map((product) => (
          <div className="card-row" key={product.product_id}>
            <div><b>{product.product_name}</b><small>{product.issuer ?? '카드사 정보 없음'} · {(benefits[product.product_id] ?? []).map((rule) => rule.benefit_name ?? rule.benefit_type ?? '혜택').join(', ') || '혜택 정보 없음'}</small></div>
            <Toggle
              on={false}
              label={`${product.product_name} 연결`}
              disabled={pendingCard === product.product_id}
              onChange={() => onToggle(product)}
            />
          </div>
        ))}
        {!availableProducts.length && <p className="empty-state">추가할 수 있는 카드 상품이 없습니다.</p>}
      </section>
      <section className="benefit-guide">
        <div className="chart-heading"><div><b>카드별 받을 수 있는 혜택</b><small>API에서 조회한 카드 상품 혜택</small></div><span className="guide-filter">실제 데이터</span></div>
        <div className="benefit-table" role="table" aria-label="카드 상품 혜택표">
          <div className="benefit-table-head" role="row"><span>카드</span><span>혜택</span><span>카드사</span><span>보유</span></div>
          {products.slice(0, 6).map((product, index) => (
            <div className={`benefit-table-row ${activeProductIds.has(product.product_id) ? 'recommended' : ''}`} role="row" key={product.product_id}>
              <b><i className={`table-dot ${['blue', 'green', 'orange', 'pink'][index % 4]}`} />{product.product_name}</b>
              <span>{(benefits[product.product_id] ?? [])[0]?.benefit_name ?? (benefits[product.product_id] ?? [])[0]?.benefit_type ?? '—'}</span>
              <span>{product.issuer ?? '—'}</span>
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
  walletError,
  onTopUp,
  onBack,
}: {
  userName: string | null
  wallet: WalletBalance | null
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const requestRef = useRef<{
    amountWon: number
    walletId: string
    requestId: string
  } | null>(null)
  const quickAmounts = ['10000', '30000', '50000', '100000']

  const submitTopUp = async () => {
    const amountWon = Number(amount)
    if (!Number.isSafeInteger(amountWon) || amountWon <= 0 || amountWon > 500_000) {
      setError('충전 금액은 1원 이상 500,000원 이하로 입력해 주세요.')
      return
    }
    if (!wallet || !walletId) {
      setError(walletError || '충전할 수 있는 활성 지갑이 없습니다.')
      return
    }

    setPending(true)
    setError('')
    setSuccess('')
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
      setSuccess(
        `${formatWon(topUp.amount_won)} 모의 충전 완료 · 잔액 ${formatWon(topUp.balance_won)}`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '모의 충전에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="screen-content recharge-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>동백전 충전하기</strong><button aria-label="충전 안내">?</button></div>
      <section className="recharge-balance"><span>{userName ?? '로그인 사용자'} · 현재 잔액</span><strong>{wallet ? formatWon(wallet.balance_won) : '잔액 조회 불가'}</strong><small>{wallet ? '데모 지갑 잔액 · 실결제 아님' : walletError || '지갑 API 응답을 확인해 주세요.'}</small></section>
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
        <button className="primary-action" disabled={pending || !wallet} onClick={() => void submitTopUp()}>{pending ? '처리 중…' : `${Number(amount || 0).toLocaleString('ko-KR')}원 모의 충전`}</button>
        {error && <p className="topup-error" role="alert">{error}</p>}
        {success && <p className="topup-success" role="status">{success}</p>}
        <p className="recharge-note">데모 모의 충전입니다. 실제 결제·계좌 출금은 발생하지 않습니다. 요청 ID로 중복 충전을 방지합니다.</p>
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
    const name = payment.product_name ?? '카드 정보 없음'
    const current = cards.get(payment.user_card_id) ?? { name, amount: 0 }
    current.amount += payment.awarded_benefit_won ?? 0
    cards.set(payment.user_card_id, current)
  }

  return (
    <div className="screen-content report-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>사용 리포트</strong><BarChart3 size={19} color="#3182f6" /></div>
      <div className="report-summary">
        <div><span>{period === 'month' ? '최근 6개월 승인 결제' : '최근 5년 승인 결제'}</span><strong>{formatWon(total)}</strong><small>결제 이력 API 최대 100건 기준</small></div>
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
        <div className="chart-heading"><div><b>카테고리별 비율</b><small>현재 거래 이력 API에는 업종 정보가 없습니다.</small></div><strong>집계 불가</strong></div>
        <p className="empty-state">가맹점 업종이 거래 이력에 포함되면 실제 비율을 표시할 수 있습니다.</p>
      </section>
      <section className="card-compare-card">
        <div className="chart-heading"><div><b>카드별 혜택 비교</b><small>거래 이력에 기록된 적립 혜택</small></div><span>API 데이터</span></div>
        {[...cards.entries()].map(([id, card], index) => (
          <div className={`compare-row ${index === 0 ? 'featured' : ''}`} key={id}>
            <div className={`compare-icon ${['', 'pod', 'zip', 'bread'][index % 4]}`}>{card.name.slice(0, 1)}</div>
            <div className="compare-name"><b>{card.name}</b><small>거래 이력 API</small></div>
            <div className="compare-value"><strong>{formatWon(card.amount)}</strong><small>기록된 혜택</small></div>
            <div className="compare-bar"><i style={{ width: `${benefitTotal ? Math.max(5, card.amount / benefitTotal * 100) : 0}%` }} /></div>
          </div>
        ))}
        {!cards.size && <p className="empty-state">비교할 결제 이력이 없습니다.</p>}
      </section>
    </div>
  )
}

function MyPlatform({
  profile,
  profileError,
  onSave,
  onBack,
}: {
  profile: UserProfile | null
  profileError: string
  onSave: (payload: {
    display_name: string
    student_card_id: string | null
    phone_number: string | null
    address: string | null
  }) => Promise<void>
  onBack: () => void
}) {
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [studentCardId, setStudentCardId] = useState(profile?.student_card_id ?? '')
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? '')
  const [address, setAddress] = useState(profile?.address ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '')
    setStudentCardId(profile?.student_card_id ?? '')
    setPhoneNumber(profile?.phone_number ?? '')
    setAddress(profile?.address ?? '')
  }, [profile])

  const saveProfile = async () => {
    if (!displayName.trim()) {
      setError('이름을 입력해 주세요.')
      return
    }
    setPending(true)
    setError('')
    setSaved(false)
    try {
      await onSave({
        display_name: displayName.trim(),
        student_card_id: studentCardId.trim() || null,
        phone_number: phoneNumber.trim() || null,
        address: address.trim() || null,
      })
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '프로필을 저장하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="screen-content platform-screen">
      <div className="detail-head"><button onClick={onBack} aria-label="뒤로"><ArrowLeft size={19} /></button><strong>내정보 관리</strong><span className="verified">동백원카드</span></div>
      <section className="identity-card"><span className="blue-label">로그인 사용자</span><h2>{profile?.display_name ?? '프로필 정보 미등록'}</h2><p>{profile ? '프로필 API에서 조회한 정보' : profileError || '사용자 프로필을 확인해 주세요.'}</p><QrCode size={40} /></section>
      <section className="student-card">
        <span className="pink-label">시민 생활 서비스 · 데모 프로필</span>
        <h2>프로필 및 연락처 관리</h2>
        <p>학생증 ID·휴대폰·주소는 현재 데모 DB에 저장됩니다. 실제 학생증 발급기관 또는 시민생활서비스 API와는 연결되지 않았습니다.</p>
        <div className="profile-fields">
          <label className="profile-field">이름<input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>
          <label className="profile-field">학생증 ID<input value={studentCardId} maxLength={64} onChange={(event) => setStudentCardId(event.target.value)} /></label>
          <label className="profile-field">휴대폰 번호<input value={phoneNumber} maxLength={32} onChange={(event) => setPhoneNumber(event.target.value)} inputMode="tel" autoComplete="tel" /></label>
          <label className="profile-field">주소<input value={address} maxLength={300} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" /></label>
        </div>
        <button className="primary-action" disabled={pending} onClick={() => void saveProfile()}>{pending ? '저장 중…' : '프로필 저장'}</button>
        {error && <p className="topup-error" role="alert">{error}</p>}
        {saved && <p className="topup-success" role="status">프로필 정보를 저장했습니다.</p>}
      </section>
      <div className="settings-list"><div>동백원카드&nbsp; · &nbsp;시민 생활 서비스</div><div>마케팅 및 혜택 알림 설정 · 미연결</div></div>
    </div>
  )
}
