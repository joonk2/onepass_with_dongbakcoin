export type ToastTone = 'success' | 'error' | 'info'

const INFO_BASE_MS = 1000
const INFO_BASE_LENGTH = 20
const INFO_EXTRA_MS = 60
const INFO_MAX_MS = 4500

export function toastDuration(tone: ToastTone, message: string): number {
  if (tone === 'error') return 3000
  if (tone === 'success') return 1000
  const length = Array.from(message).length
  if (length <= INFO_BASE_LENGTH) return INFO_BASE_MS
  return Math.min(INFO_MAX_MS, INFO_BASE_MS + (length - INFO_BASE_LENGTH) * INFO_EXTRA_MS)
}

export type ToastSlot = {
  key: number
  revision: number
  tone: ToastTone
  message: string
}

// 화면에는 알림 하나만 둔다. 같은 알림은 다시 쌓지 않고 표시 시간만 갱신한다.
export function resolveToastUpdate(
  current: ToastSlot | null,
  incoming: { tone: ToastTone; message: string },
  nextKey: number,
): ToastSlot & { action: 'refresh' | 'replace' } {
  if (current && current.tone === incoming.tone && current.message === incoming.message) {
    return {
      action: 'refresh',
      key: current.key,
      revision: current.revision + 1,
      tone: current.tone,
      message: current.message,
    }
  }
  return {
    action: 'replace',
    key: nextKey,
    revision: 0,
    tone: incoming.tone,
    message: incoming.message,
  }
}
