'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Info, TriangleAlert, X } from 'lucide-react'
import { resolveToastUpdate, toastDuration, type ToastTone } from '@/lib/toast-timing'
import './toast.css'

type ShowToastInput = {
  tone: ToastTone
  message: string
  durationMs?: number
}

type ToastItem = {
  key: number
  revision: number
  tone: ToastTone
  message: string
  durationMs: number
  leaving: boolean
}

type ToastContextValue = {
  showToast: (input: ShowToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (!value) {
    throw new Error('useToast는 ToastProvider 안에서만 사용할 수 있습니다.')
  }
  return value
}

const ICONS = {
  success: Check,
  error: TriangleAlert,
  info: Info,
} as const

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null)
  const toastRef = useRef<HTMLDivElement>(null)
  const keyRef = useRef(0)

  const showToast = useCallback((input: ShowToastInput) => {
    const message = input.message.trim()
    if (!message) return
    const durationMs = input.durationMs ?? toastDuration(input.tone, message)
    setToast((current) => {
      const visible = current && !current.leaving ? current : null
      const nextKey = keyRef.current + 1
      const resolved = resolveToastUpdate(
        visible
          ? { key: visible.key, revision: visible.revision, tone: visible.tone, message: visible.message }
          : null,
        { tone: input.tone, message },
        nextKey,
      )
      keyRef.current = resolved.key
      return { ...resolved, durationMs, leaving: false }
    })
  }, [])

  const dismiss = useCallback(() => {
    setToast((current) => (current && !current.leaving ? { ...current, leaving: true } : current))
  }, [])

  useEffect(() => {
    if (!toast || toast.leaving) return
    const key = toast.key
    const revision = toast.revision
    const timer = window.setTimeout(() => {
      setToast((current) => (
        current && current.key === key && current.revision === revision && !current.leaving
          ? { ...current, leaving: true }
          : current
      ))
    }, toast.durationMs)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!toast?.leaving) return
    const key = toast.key
    const timer = window.setTimeout(() => {
      setToast((current) => (current && current.key === key && current.leaving ? null : current))
    }, 140)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!toast || toast.leaving) return
    const onPointerDown = (event: PointerEvent) => {
      const node = toastRef.current
      if (!node) return
      if (event.target instanceof Node && node.contains(event.target)) return
      dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [toast, dismiss])

  const Icon = toast ? ICONS[toast.tone] : null

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && Icon && (
        <div className="app-toast-viewport">
          <div
            ref={toastRef}
            className={`app-toast${toast.leaving ? ' leaving' : ''}`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
            data-tone={toast.tone}
          >
            <span className="app-toast-icon" aria-hidden="true"><Icon size={16} /></span>
            <p className="app-toast-message">{toast.message}</p>
            <button type="button" className="app-toast-close" aria-label="알림 닫기" onClick={dismiss}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}
