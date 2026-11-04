'use client'

import { useMemo, useState } from 'react'
import { useToast } from '@/components/toast-provider'
import { NOTICE } from '@/lib/notices'
import {
  CARD_KIND_LABEL,
  cardArtOf,
  cardKindOf,
  issuerLabel,
  issuerTheme,
  productPlate,
  registrableProducts,
  type CardKind,
  type CatalogProduct,
} from '@/lib/card-catalog'
import type { CardRegistrationDetails } from '@/lib/api'
import './card-registration-picker.css'

type PickerProduct = CatalogProduct & { product_id: string }

const SPEND_TIERS = [
  { value: 0, label: '실적 없음' },
  { value: 300_000, label: '30만원 이상' },
  { value: 500_000, label: '50만원 이상' },
  { value: 700_000, label: '70만원 이상' },
  { value: 1_000_000, label: '100만원 이상' },
] as const

const KINDS: readonly CardKind[] = ['CHECK', 'CREDIT']

const digitsOnly = (value: string, max: number) => value.replace(/\D/g, '').slice(0, max)
const formatCardNumber = (digits: string) => digits.replace(/(.{4})/g, '$1 ').trim()

export default function CardRegistrationPicker<T extends PickerProduct>({
  products,
  benefitSummary,
  disabled,
  onRegister,
  onRetry,
}: {
  products: readonly T[]
  benefitSummary: (product: T) => string
  disabled: boolean
  onRegister: (product: T, details: CardRegistrationDetails) => void
  onRetry?: () => void
}) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [cardNumber, setCardNumber] = useState('')
  const [cvc, setCvc] = useState('')
  const [expiryMonth, setExpiryMonth] = useState('')
  const [expiryYear, setExpiryYear] = useState('')
  const [spend, setSpend] = useState('0')
  const { showToast } = useToast()

  const sections = useMemo(() => {
    const allowed = registrableProducts(products)
    return KINDS.map((kind) => ({
      kind,
      products: allowed.filter((product) => cardKindOf(product) === kind),
    }))
  }, [products])
  const total = sections.reduce((sum, section) => sum + section.products.length, 0)
  const pickedProduct = sections.flatMap((section) => section.products).find((product) => product.product_id === pickedId) ?? null
  const thisYear = new Date().getFullYear()

  const pickProduct = (id: string | null) => {
    setPickedId(id)
    setCardNumber(''); setCvc(''); setExpiryMonth(''); setExpiryYear(''); setSpend('0')
  }

  const submit = () => {
    if (!pickedProduct) {
      showToast({ tone: 'info', message: '카드를 선택해 주세요.' })
      return
    }
    if (cardNumber.length < 15) {
      showToast({ tone: 'info', message: '카드번호 15~16자리를 입력해 주세요.' })
      return
    }
    if (expiryMonth === '' || expiryYear === '') {
      showToast({ tone: 'info', message: '유효기간을 선택해 주세요.' })
      return
    }
    const month = Number(expiryMonth)
    const year = Number(expiryYear)
    if (year === thisYear && month < new Date().getMonth() + 1) {
      showToast({ tone: 'error', message: NOTICE.cardExpired })
      return
    }
    if (cvc.length < 3) {
      showToast({ tone: 'info', message: 'CVC 3~4자리를 입력해 주세요.' })
      return
    }
    onRegister(pickedProduct, {
      card_number: cardNumber,
      card_cvc: cvc,
      expiry_month: month,
      expiry_year: year,
      prev_month_spend_won: Number(spend),
    })
  }

  return (
    <section className="card-picker" aria-label="내 카드 등록하기">
      <h3 className="card-picker-title">내 카드 등록하기</h3>
      <p className="card-picker-desc">등록할 부산은행 카드를 선택해 주세요.</p>

      {total === 0 && (
        <div className="card-picker-empty" role="status">
          <p>등록할 수 있는 카드 상품이 없습니다. 이미 모두 등록했거나 상품 정보를 불러오지 못했을 수 있습니다.</p>
          {onRetry && <button type="button" className="card-action-button secondary" onClick={onRetry}>다시 시도</button>}
        </div>
      )}

      {sections.map(({ kind, products: kindProducts }) => kindProducts.length > 0 && (
        <div key={kind} className="card-picker-section">
          <p className="card-picker-step">{CARD_KIND_LABEL[kind]} {kindProducts.length}종</p>
          <ul className="card-picker-deck" aria-label={`${CARD_KIND_LABEL[kind]} 목록`}>
            {kindProducts.map((product) => {
              const selected = pickedId === product.product_id
              const art = cardArtOf(product.product_id)
              const plate = productPlate(product.product_id)
              const theme = issuerTheme(product.issuer)
              const gradient =
                art.shade === 0
                  ? `linear-gradient(150deg, ${theme.from}, ${theme.to})`
                  : art.shade === 1
                    ? `linear-gradient(210deg, ${theme.to}, ${theme.from})`
                    : `linear-gradient(135deg, ${theme.from} 35%, ${theme.to})`
              return (
                <li className={`card-picker-card ${selected ? 'selected' : ''}`} key={product.product_id}>
                  <button
                    type="button"
                    className="card-picker-card-art"
                    data-kind={kind}
                    data-plate={plate?.plate}
                    data-pattern={plate ? undefined : art.pattern}
                    style={{ background: plate?.background ?? gradient, color: plate?.color ?? theme.ink }}
                    aria-pressed={selected}
                    aria-label={`${product.product_name} 선택`}
                    onClick={() => pickProduct(selected ? null : product.product_id)}
                  >
                    <span>{issuerLabel(product.issuer)} · {CARD_KIND_LABEL[kind]}</span>
                    <b>{product.product_name}</b>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {pickedProduct && (
        <div className="card-picker-card-detail">
          <b>{pickedProduct.product_name}</b>
          <small>{benefitSummary(pickedProduct)}</small>
          <label className="card-picker-field">카드번호
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder="0000 0000 0000 0000"
              value={formatCardNumber(cardNumber)}
              onChange={(event) => setCardNumber(digitsOnly(event.target.value, 16))}
            />
          </label>
          <div className="card-picker-row">
            <label className="card-picker-field">유효기간
              <span className="card-picker-expiry">
                <select aria-label="유효기간 월" value={expiryMonth} onChange={(event) => setExpiryMonth(event.target.value)}>
                  <option value="">월</option>
                  {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, '0')}</option>)}
                </select>
                <select aria-label="유효기간 연도" value={expiryYear} onChange={(event) => setExpiryYear(event.target.value)}>
                  <option value="">연도</option>
                  {Array.from({ length: 12 }, (_, index) => <option key={thisYear + index} value={thisYear + index}>{thisYear + index}</option>)}
                </select>
              </span>
            </label>
            <label className="card-picker-field">CVC
              <input
                inputMode="numeric"
                autoComplete="off"
                type="password"
                placeholder="3~4자리"
                value={cvc}
                onChange={(event) => setCvc(digitsOnly(event.target.value, 4))}
              />
            </label>
          </div>
          <label className="card-picker-field">전월실적
            <select value={spend} onChange={(event) => setSpend(event.target.value)}>
              {SPEND_TIERS.map((tier) => <option key={tier.value} value={tier.value}>{tier.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="card-action-button secondary"
            disabled={disabled}
            onClick={submit}
          >
            등록
          </button>
        </div>
      )}
    </section>
  )
}
