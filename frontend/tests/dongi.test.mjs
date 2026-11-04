import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CARD_REGISTERED_MESSAGE,
  initialDongiMachine,
  ONBOARDING_MESSAGE,
  ONBOARDING_SCRIPT,
  transition,
} from '../lib/dongi/state-machine.ts'
import { resolveOnboardingStatus } from '../lib/dongi/onboarding.ts'

const run = (events) => events.reduce((m, type) => transition(m, { type }), initialDongiMachine)

test('idle wandering alternates IDLE and WALK', () => {
  assert.equal(run(['WANDER']).state, 'WALK')
  assert.equal(run(['WANDER', 'REST']).state, 'IDLE')
})

test('empty-space click: SURPRISED then RUN then back to IDLE on arrival', () => {
  assert.equal(run(['STAGE_CLICK']).state, 'SURPRISED')
  assert.equal(run(['STAGE_CLICK', 'DONE']).state, 'RUN')
  assert.equal(run(['STAGE_CLICK', 'DONE', 'ARRIVED']).state, 'IDLE')
})

test('dongi click: GREET then TALK, and it interrupts walking', () => {
  assert.equal(run(['WANDER', 'DONGI_CLICK']).state, 'GREET')
  assert.equal(run(['DONGI_CLICK', 'GREETED']).state, 'TALK')
})

test('guidance states are not interrupted by stage clicks or autonomous events', () => {
  for (const events of [['CONFUSE'], ['DONGI_CLICK', 'GREETED'], ['CELEBRATE']]) {
    const base = run(events)
    for (const type of ['STAGE_CLICK', 'WANDER', 'REST', 'GET_ANGRY', 'SPECIAL']) {
      assert.equal(transition(base, { type }).state, base.state, `${base.state} + ${type}`)
    }
  }
})

test('confused flows to TALK only through UNDERSTAND', () => {
  assert.equal(run(['CONFUSE', 'UNDERSTAND']).state, 'TALK')
  assert.equal(run(['CONFUSE', 'DONGI_CLICK']).state, 'CONFUSED')
  assert.equal(run(['WANDER', 'UNDERSTAND']).state, 'WALK')
})

test('HAPPY, ANGRY and SPECIAL return to IDLE', () => {
  assert.equal(run(['CELEBRATE', 'DONE']).state, 'IDLE')
  assert.equal(run(['GET_ANGRY', 'DONE']).state, 'IDLE')
  assert.equal(run(['SPECIAL', 'DONE']).state, 'IDLE')
})

test('unrelated events leave the machine untouched (same reference)', () => {
  assert.equal(transition(initialDongiMachine, { type: 'ARRIVED' }), initialDongiMachine)
})

test('onboarding script follows confusion, understanding, then guidance', () => {
  const states = ONBOARDING_SCRIPT.map((beat) => beat.state)
  assert.deepEqual(states, ['WALK', 'SURPRISED', 'CONFUSED', 'CONFUSED', 'TALK'])
  const times = ONBOARDING_SCRIPT.map((beat) => beat.atMs)
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
  const firstBubble = ONBOARDING_SCRIPT.findIndex((beat) => beat.showBubble)
  assert.ok(ONBOARDING_SCRIPT[firstBubble].showQuestionMark)
  assert.ok(ONBOARDING_SCRIPT.at(-1).greetWave)
})

test('required messages are kept verbatim', () => {
  assert.equal(
    ONBOARDING_MESSAGE,
    '어라! 아직 등록된 카드가 없네요. 카드를 등록하는데 제가 도와드릴게요!',
  )
  assert.equal(
    CARD_REGISTERED_MESSAGE,
    '카드 등록 완료! 이제 어떤 카드가 가장 혜택이 좋은지 알아볼까요?',
  )
})

const base = {
  authenticated: true,
  cardsLoaded: true,
  cardsError: false,
  activeCardCount: 0,
  dismissed: false,
  qrPaymentFlow: false,
}

test('onboarding shows only when cards loaded successfully and none are active', () => {
  assert.equal(resolveOnboardingStatus(base), 'onboarding')
  assert.equal(resolveOnboardingStatus({ ...base, activeCardCount: 1 }), 'dashboard')
})

test('a card lookup error is never treated as zero cards', () => {
  assert.equal(resolveOnboardingStatus({ ...base, cardsError: true }), 'error')
  assert.equal(resolveOnboardingStatus({ ...base, cardsLoaded: false }), 'loading')
})

test('dismissal, logged-out users and QR payment flow suppress onboarding', () => {
  assert.equal(resolveOnboardingStatus({ ...base, dismissed: true }), 'dashboard')
  assert.equal(resolveOnboardingStatus({ ...base, authenticated: false }), 'hidden')
  assert.equal(resolveOnboardingStatus({ ...base, qrPaymentFlow: true }), 'hidden')
})
