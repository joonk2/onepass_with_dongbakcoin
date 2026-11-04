export type DongiState =
  | 'IDLE'
  | 'WALK'
  | 'RUN'
  | 'SURPRISED'
  | 'CONFUSED'
  | 'GREET'
  | 'TALK'
  | 'HAPPY'
  | 'ANGRY'
  | 'SPECIAL'

export type DongiEvent =
  | { type: 'WANDER' }
  | { type: 'REST' }
  | { type: 'STAGE_CLICK' }
  | { type: 'ARRIVED' }
  | { type: 'DONGI_CLICK' }
  | { type: 'GREETED' }
  | { type: 'CONFUSE' }
  | { type: 'UNDERSTAND' }
  | { type: 'CELEBRATE' }
  | { type: 'GET_ANGRY' }
  | { type: 'SPECIAL' }
  | { type: 'DONE' }

export type DongiMachine = {
  state: DongiState
  previous: DongiState
}

export const initialDongiMachine: DongiMachine = { state: 'IDLE', previous: 'IDLE' }

// 3D 연동 시 AnimationMixer 크로스페이드 기본 시간(초)
export const DONGI_BLEND_SECONDS = 0.25

export function isAutonomous(state: DongiState): boolean {
  return state === 'IDLE' || state === 'WALK'
}

function go(machine: DongiMachine, state: DongiState): DongiMachine {
  if (machine.state === state) return machine
  return { state, previous: machine.state }
}

export function transition(machine: DongiMachine, event: DongiEvent): DongiMachine {
  const { state } = machine
  switch (event.type) {
    case 'WANDER':
      return state === 'IDLE' ? go(machine, 'WALK') : machine
    case 'REST':
      return state === 'WALK' ? go(machine, 'IDLE') : machine
    case 'STAGE_CLICK':
      // 안내 중(TALK/CONFUSED/GREET/HAPPY)에는 빈 공간 클릭이 대화를 끊지 않는다.
      return isAutonomous(state) ? go(machine, 'SURPRISED') : machine
    case 'ARRIVED':
      return state === 'RUN' ? go(machine, 'IDLE') : machine
    case 'DONE':
      if (state === 'SURPRISED') return go(machine, 'RUN')
      if (state === 'SPECIAL' || state === 'ANGRY' || state === 'HAPPY') return go(machine, 'IDLE')
      return machine
    case 'DONGI_CLICK':
      return state === 'CONFUSED' || state === 'HAPPY' ? machine : go(machine, 'GREET')
    case 'GREETED':
      return state === 'GREET' ? go(machine, 'TALK') : machine
    case 'CONFUSE':
      return go(machine, 'CONFUSED')
    case 'UNDERSTAND':
      return state === 'CONFUSED' ? go(machine, 'TALK') : machine
    case 'CELEBRATE':
      return go(machine, 'HAPPY')
    case 'GET_ANGRY':
      return isAutonomous(state) ? go(machine, 'ANGRY') : machine
    case 'SPECIAL':
      return isAutonomous(state) ? go(machine, 'SPECIAL') : machine
    default:
      return machine
  }
}

export type OnboardingBeat = {
  state: DongiState
  atMs: number
  showQuestionMark?: boolean
  showBubble?: boolean
  greetWave?: boolean
}

// 카드 0장 안내의 감정 흐름: 어리둥절 → 상황 이해 → 친절한 안내
export const ONBOARDING_SCRIPT: readonly OnboardingBeat[] = [
  { state: 'WALK', atMs: 0 },
  { state: 'SURPRISED', atMs: 1800 },
  { state: 'CONFUSED', atMs: 2400, showQuestionMark: true },
  { state: 'CONFUSED', atMs: 4200, showQuestionMark: true, showBubble: true },
  { state: 'TALK', atMs: 6200, showBubble: true, greetWave: true },
]

export const ONBOARDING_MESSAGE =
  '어라! 아직 등록된 카드가 없네요. 카드를 등록하는데 제가 도와드릴게요!'

export const CARD_REGISTERED_MESSAGE =
  '카드 등록 완료! 이제 어떤 카드가 가장 혜택이 좋은지 알아볼까요?'
