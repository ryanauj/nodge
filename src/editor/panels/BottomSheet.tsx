/**
 * BottomSheet — the mobile responsive panel container (spec §10.1, §10.2).
 *
 * On narrow viewports the desktop side panels become bottom sheets that slide up
 * over the bottom edge, leaving the canvas visible. The sheet is a labelled
 * dialog: keyboard-operable (Esc to dismiss, a focusable close button) and
 * swipe-to-dismiss via a drag handle (pointer events, so it works for both touch
 * and mouse). The slide-in transition respects `prefers-reduced-motion` (handled
 * in CSS). It is purely presentational — open/close state lives in the tool-mode
 * store, never the gateway.
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

export interface BottomSheetProps {
  /** Accessible name for the sheet dialog and its title bar. */
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}

/** How far (px) the sheet must be dragged down before it dismisses. */
const DISMISS_THRESHOLD = 80

export function BottomSheet({ title, open, onClose, children }: BottomSheetProps) {
  const [dragY, setDragY] = useState(0)
  const dragYRef = useRef(0)
  const startY = useRef<number | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  // Reset any in-progress drag whenever the sheet (re)opens or closes.
  useEffect(() => {
    setDragY(0)
    dragYRef.current = 0
    startY.current = null
  }, [open])

  // Move focus into the sheet on open so it is keyboard-operable and screen
  // readers announce the dialog (spec §10.4). Focus the dialog *container* (not
  // the close button) and only when the content hasn't already claimed focus —
  // e.g. the entity picker autofocuses its search field. Focusing the close
  // button drew a large focus ring in the corner on touch-open; the container is
  // silent and non-visual.
  useEffect(() => {
    if (!open) return
    const root = sheetRef.current
    if (root && !root.contains(document.activeElement)) root.focus()
  }, [open])

  // Esc dismisses the sheet (standard dialog keyboard affordance).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onPointerDown = (e: ReactPointerEvent) => {
    startY.current = e.clientY
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (startY.current == null) return
    const dy = e.clientY - startY.current
    // Only track downward drags (swipe-to-dismiss); ignore upward.
    const clamped = dy > 0 ? dy : 0
    dragYRef.current = clamped
    setDragY(clamped)
  }
  const onPointerUp = () => {
    if (dragYRef.current > DISMISS_THRESHOLD) onClose()
    dragYRef.current = 0
    setDragY(0)
    startY.current = null
  }

  if (!open) return null

  return (
    <div
      ref={sheetRef}
      className="bottom-sheet"
      role="dialog"
      aria-modal="false"
      aria-label={title}
      tabIndex={-1}
      style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
    >
      <div
        className="bottom-sheet-handle"
        data-testid="bottom-sheet-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-hidden="true"
      />
      <div className="bottom-sheet-header">
        <span className="bottom-sheet-title">{title}</span>
        <button
          ref={closeRef}
          className="bottom-sheet-close"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="bottom-sheet-body">{children}</div>
    </div>
  )
}
