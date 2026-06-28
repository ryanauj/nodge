/**
 * Component tests for the thumb-reach tool toolbar (spec §10.2, §10.4): it is an
 * ARIA toolbar; the Select/Connect/Add buttons are an `aria-pressed` group that
 * switches the tool-mode store; sheet tabs reflect open state and disable when a
 * panel has no content.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolModeToolbar } from './ToolModeToolbar'
import { useToolMode } from './toolMode'

describe('ToolModeToolbar', () => {
  beforeEach(() => {
    useToolMode.setState({ mode: 'select', sheet: null, connectSourceId: null })
  })

  it('renders an ARIA toolbar with the three mode buttons', () => {
    render(<ToolModeToolbar availableSheets={[]} />)
    expect(screen.getByRole('toolbar', { name: 'Tool modes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add mode' })).toBeInTheDocument()
  })

  it('Select is pressed by default and clicking Connect switches the store', () => {
    render(<ToolModeToolbar availableSheets={[]} />)
    expect(screen.getByRole('button', { name: 'Select mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connect mode' }))
    expect(useToolMode.getState().mode).toBe('connect')
    expect(screen.getByRole('button', { name: 'Connect mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('a sheet tab is disabled when its panel is unavailable and toggles when available', () => {
    const { rerender } = render(<ToolModeToolbar availableSheets={['palette']} />)
    expect(screen.getByRole('button', { name: 'Properties panel' })).toBeDisabled()
    const paletteTab = screen.getByRole('button', { name: 'Palette panel' })
    expect(paletteTab).toBeEnabled()
    expect(paletteTab).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(paletteTab)
    expect(useToolMode.getState().sheet).toBe('palette')

    rerender(<ToolModeToolbar availableSheets={['palette']} />)
    expect(screen.getByRole('button', { name: 'Palette panel' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})
