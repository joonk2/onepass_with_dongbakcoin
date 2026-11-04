'use client'

import { useState } from 'react'
import DongiImage from '@/components/dongi-image'
import { CARD_DESIGNS, DEFAULT_CARD_DESIGN } from '@/lib/dongi/card-design'
import type { DongiImageVariant } from '@/components/dongi-image'
import './card-issue-sheet.css'

export default function CardIssueSheet({
  busy,
  error,
  onIssue,
  onCancel,
}: {
  busy: boolean
  error: string
  onIssue: (variant: DongiImageVariant) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<DongiImageVariant>(DEFAULT_CARD_DESIGN)

  return (
    <div className="card-issue-backdrop" role="presentation">
      <section className="card-issue-sheet" role="dialog" aria-modal="true" aria-labelledby="card-issue-title">
        <h2 id="card-issue-title">원패스 카드부터 발급받아요</h2>
        <p className="card-issue-lead">
          다른 카드를 등록하려면 원패스 카드가 먼저 필요해요. 마음에 드는 디자인을 하나 골라 주세요.
          실제 금융기관에서 발급되는 카드가 아닌 OnePass 서비스용 카드입니다.
        </p>
        <div className="card-issue-grid" role="radiogroup" aria-label="카드 디자인">
          {CARD_DESIGNS.map((design) => (
            <button
              key={design.variant}
              type="button"
              role="radio"
              aria-checked={selected === design.variant}
              className={`card-issue-option ${selected === design.variant ? 'selected' : ''}`}
              onClick={() => setSelected(design.variant)}
              disabled={busy}
            >
              <DongiImage variant={design.variant} alt="" className="card-issue-image" />
              <b>{design.title}</b>
              <small>{design.description}</small>
            </button>
          ))}
        </div>
        {error && <p className="card-issue-error" role="alert">{error}</p>}
        <div className="card-issue-actions">
          <button type="button" className="card-issue-cancel" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button type="button" className="card-issue-confirm" onClick={() => onIssue(selected)} disabled={busy}>
            {busy ? '발급 중…' : '이 디자인으로 발급받기'}
          </button>
        </div>
      </section>
    </div>
  )
}
