'use client'

import { useEffect, useId, useRef } from 'react'
import { unlinkDialogCopy } from '@/lib/unlink-dialog'
import './unlink-confirm.css'

export default function UnlinkConfirm({
  cardName,
  onepass,
  busy,
  onCancel,
  onConfirm,
}: {
  cardName: string
  onepass: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const copy = unlinkDialogCopy({ onepass, cardName })
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  const busyRef = useRef(busy)

  useEffect(() => {
    onCancelRef.current = onCancel
    busyRef.current = busy
  }, [onCancel, busy])

  useEffect(() => {
    const previouslyFocused = document.activeElement
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (busyRef.current) return
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = [cancelRef.current, confirmRef.current].filter((node): node is HTMLButtonElement => (
        node !== null && !node.disabled
      ))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [])

  return (
    <div className="unlink-confirm" role="presentation" onClick={busy ? undefined : onCancel}>
      <section
        className="unlink-confirm-card"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        {copy.showSadDongi && (
          <img className="unlink-dongi" src="/sad_dongi.png" alt="슬픈 동이" />
        )}
        <h2 id={titleId}>{copy.title}</h2>
        <p id={descriptionId}>{copy.description}</p>
        <div className="unlink-confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="unlink-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            취소
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="unlink-ok"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '해제하는 중' : '해제'}
          </button>
        </div>
      </section>
    </div>
  )
}
