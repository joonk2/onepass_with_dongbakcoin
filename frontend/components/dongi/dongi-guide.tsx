'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import DongiImage from '@/components/dongi-image'
import {
  CARD_REGISTERED_MESSAGE,
  initialDongiMachine,
  ONBOARDING_MESSAGE,
  ONBOARDING_SCRIPT,
  transition,
  type DongiEvent,
  type DongiState,
} from '@/lib/dongi/state-machine'
import './dongi-guide.css'

export type DongiScenario = 'no-cards' | 'card-registered'

const BEAT_EVENT: Partial<Record<DongiState, DongiEvent>> = {
  WALK: { type: 'WANDER' },
  SURPRISED: { type: 'STAGE_CLICK' },
  CONFUSED: { type: 'CONFUSE' },
  TALK: { type: 'UNDERSTAND' },
}

const STATE_LABEL: Record<DongiState, string> = {
  IDLE: '대기 중',
  WALK: '걸어오는 중',
  RUN: '달려오는 중',
  SURPRISED: '깜짝 놀람',
  CONFUSED: '어리둥절',
  GREET: '인사 중',
  TALK: '안내 중',
  HAPPY: '기뻐하는 중',
  ANGRY: '화난 상태',
  SPECIAL: '특별 동작',
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// 3D GLB가 연결되기 전까지는 정적 이미지로 상태를 표현한다 (data-render로 구분).
export default function DongiGuide({
  scenario,
  onPrimary,
  onSecondary,
  onClose,
}: {
  scenario: DongiScenario
  onPrimary?: () => void
  onSecondary?: () => void
  onClose?: () => void
}) {
  const [machine, dispatch] = useReducer(transition, initialDongiMachine)
  const [beat, setBeat] = useState(-1)
  const [clickedBubble, setClickedBubble] = useState(false)
  const timers = useRef<number[]>([])
  const registered = scenario === 'card-registered'

  const schedule = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  useEffect(() => {
    const pending = timers.current
    if (registered) {
      dispatch({ type: 'CELEBRATE' })
      schedule(() => onClose?.(), 6000)
      return () => pending.forEach(window.clearTimeout)
    }
    const playBeat = (index: number) => {
      const target = ONBOARDING_SCRIPT[index]
      const event = BEAT_EVENT[target.state]
      if (event) dispatch(event)
      setBeat(index)
    }
    if (prefersReducedMotion()) {
      ONBOARDING_SCRIPT.forEach((_, index) => playBeat(index))
    } else {
      ONBOARDING_SCRIPT.forEach((target, index) => schedule(() => playBeat(index), target.atMs))
    }
    return () => pending.forEach(window.clearTimeout)
  }, [registered, schedule, onClose])

  const current = beat >= 0 ? ONBOARDING_SCRIPT[beat] : undefined
  const showQuestion = !registered && Boolean(current?.showQuestionMark) && machine.state === 'CONFUSED'
  const showBubble = registered || Boolean(current?.showBubble) || clickedBubble
  const waving = machine.state === 'GREET' || (!registered && Boolean(current?.greetWave) && machine.state === 'TALK')
  const guideReady = registered || machine.state === 'TALK'

  const handleDongiClick = () => {
    if (registered) return
    dispatch({ type: 'DONGI_CLICK' })
    setClickedBubble(true)
    schedule(() => dispatch({ type: 'GREETED' }), 700)
  }

  return (
    <aside
      className="dongi-guide"
      role="dialog"
      aria-label={registered ? '카드 등록 완료 안내' : '카드 등록 안내'}
      data-state={machine.state}
      data-render="static-fallback"
    >
      <div className="dongi-guide-stage">
        {showQuestion && <span className="dongi-question" aria-hidden="true">?</span>}
        <button
          type="button"
          className={`dongi-body ${waving ? 'waving' : ''}`}
          onClick={handleDongiClick}
          aria-label={`동이 (${STATE_LABEL[machine.state]})`}
        >
          <DongiImage variant="classic" alt="" className="dongi-figure" />
        </button>
      </div>
      <div className="dongi-guide-panel" aria-live="polite">
        {showBubble ? (
          <p className="dongi-bubble">{registered ? CARD_REGISTERED_MESSAGE : ONBOARDING_MESSAGE}</p>
        ) : (
          <p className="dongi-bubble pending" aria-hidden="true">…</p>
        )}
        {!registered && (
          <div className="dongi-actions">
            <button type="button" className="dongi-primary" disabled={!guideReady} onClick={onPrimary}>
              카드 등록하러 가기
            </button>
            <button type="button" className="dongi-secondary" onClick={onSecondary}>
              나중에 할게요
            </button>
          </div>
        )}
        {registered && (
          <div className="dongi-actions">
            <button type="button" className="dongi-secondary" onClick={onClose}>닫기</button>
          </div>
        )}
      </div>
    </aside>
  )
}
