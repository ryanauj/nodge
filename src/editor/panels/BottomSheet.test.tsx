/**
 * Component tests for the reusable BottomSheet (spec §10.1, §10.4): it renders
 * as a labelled dialog, is keyboard-dismissable (Esc + close button), and
 * swipe-to-dismiss fires onClose past the drag threshold but not below it.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomSheet } from './BottomSheet'

describe('BottomSheet', () => {
  it('renders a labelled dialog with a close button when open', () => {
    render(
      <BottomSheet title="Palette" open onClose={() => {}}>
        <p>content</p>
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Palette' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close Palette' })).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(
      <BottomSheet title="Palette" open={false} onClose={() => {}}>
        <p>content</p>
      </BottomSheet>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the close button calls onClose', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet title="Palette" open onClose={onClose}>
        <p>content</p>
      </BottomSheet>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close Palette' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape dismisses the sheet (keyboard-operable)', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet title="Palette" open onClose={onClose}>
        <p>content</p>
      </BottomSheet>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('swipe-to-dismiss: a downward drag past the threshold closes; a short drag does not', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet title="Palette" open onClose={onClose}>
        <p>content</p>
      </BottomSheet>,
    )
    const handle = screen.getByTestId('bottom-sheet-handle')

    // jsdom has no PointerEvent, so synthesize the pointer gesture with
    // MouseEvents (which carry clientY) under the pointer event names.
    const pointer = (type: string, clientY: number) =>
      fireEvent(
        handle,
        new MouseEvent(type, { bubbles: true, cancelable: true, clientY }),
      )

    // Short drag (below threshold) → no dismiss.
    pointer('pointerdown', 0)
    pointer('pointermove', 20)
    pointer('pointerup', 20)
    expect(onClose).not.toHaveBeenCalled()

    // Long downward drag (past threshold) → dismiss.
    pointer('pointerdown', 0)
    pointer('pointermove', 200)
    pointer('pointerup', 200)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
