/**
 * Component tests for the FloatingDock (spec §10.1, §10.2): the slim bar shows
 * the controls placed `slim`; the expand toggle reveals the rest; the display
 * toggles drive the canvas-prefs store; and the Customize picker moves a control
 * between placements. Interaction is mode-less, so there are no tool-mode
 * buttons. Editing / file actions are fired through the injected callbacks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FloatingDock, type FloatingDockProps } from './FloatingDock'
import { useSheets } from '../sheets'
import { useCanvasPrefs } from '../canvasPrefs'
import { useDockPrefs } from '../dockControls'

function renderDock(overrides: Partial<FloatingDockProps> = {}) {
  const props: FloatingDockProps = {
    availableSheets: ['palette'],
    canUndo: true,
    canRedo: true,
    canAct: true,
    hasSelection: true,
    onAddNode: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onSave: vi.fn(),
    onLoad: vi.fn(),
    ...overrides,
  }
  render(<FloatingDock {...props} />)
  return props
}

describe('FloatingDock', () => {
  beforeEach(() => {
    localStorage.clear()
    useSheets.setState({ sheet: null })
    useCanvasPrefs.setState({ showMinimap: false, showBackground: true })
    useDockPrefs.getState().resetPlacements()
  })

  it('renders the default slim controls and no tool-mode buttons', () => {
    renderDock()
    expect(screen.getByRole('toolbar', { name: 'Canvas tools' })).toBeInTheDocument()
    // Default slim controls.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add node' })).toBeInTheDocument()
    // Mode-less interaction (§10.2): no Select/Connect/Add mode buttons.
    expect(screen.queryByRole('button', { name: 'Select mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add mode' })).not.toBeInTheDocument()
  })

  it('disables and fires the editing actions per their enablement', () => {
    const props = renderDock({ canUndo: false })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }))
    expect(props.onAddNode).toHaveBeenCalledTimes(1)
  })

  it('the expand toggle reveals the expanded controls', () => {
    const props = renderDock()
    // Collapsed: the expanded-only controls are not shown.
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more controls' }))
    const copy = screen.getByRole('button', { name: 'Copy' })
    expect(copy).toBeInTheDocument()
    fireEvent.click(copy)
    expect(props.onCopy).toHaveBeenCalledTimes(1)
  })

  it('a panel opener tab is disabled when its sheet has no content', () => {
    renderDock({ availableSheets: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Show more controls' }))
    expect(screen.getByRole('button', { name: 'Palette panel' })).toBeDisabled()
  })

  it('the Minimap display toggle drives the canvas-prefs store', () => {
    renderDock()
    fireEvent.click(screen.getByRole('button', { name: 'Show more controls' }))
    const minimap = screen.getByRole('switch', { name: 'Minimap' })
    expect(minimap).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(minimap)
    expect(useCanvasPrefs.getState().showMinimap).toBe(true)
  })

  it('Customize moves a control to a different placement', () => {
    renderDock()
    fireEvent.click(screen.getByRole('button', { name: 'Show more controls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    const saveGroup = screen.getByRole('radiogroup', { name: 'Save placement' })
    fireEvent.click(within(saveGroup).getByRole('radio', { name: 'Slim' }))
    expect(useDockPrefs.getState().placements.save).toBe('slim')
  })

  it('a slim control can be hidden via Customize', () => {
    renderDock()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more controls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    const undoGroup = screen.getByRole('radiogroup', { name: 'Undo placement' })
    fireEvent.click(within(undoGroup).getByRole('radio', { name: 'Hidden' }))
    expect(useDockPrefs.getState().placements.undo).toBe('hidden')
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
})
