/**
 * Unit tests for the dock control registry + placement store (spec §10.1).
 * The registry is the single source of which controls exist; the store owns
 * each control's placement (slim / expanded / hidden), persisted to localStorage
 * and merged over the defaults so a new control or a partial blob never drops a
 * control or yields an invalid placement.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DOCK_CONTROLS,
  DOCK_PLACEMENT_KEY,
  defaultPlacement,
  useDockPrefs,
} from './dockControls'

describe('dockControls registry', () => {
  it('includes a panel opener for every sheet and the display toggles', () => {
    const ids = DOCK_CONTROLS.map((d) => d.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'undo',
        'redo',
        'add',
        'copy',
        'paste',
        'panel:properties',
        'panel:prototypes',
        'panel:palette',
        'panel:crossref',
        'toggle:minimap',
        'toggle:background',
        'save',
        'load',
      ]),
    )
  })

  it('the editing essentials default to the slim row, the rest to expanded', () => {
    expect(defaultPlacement('undo')).toBe('slim')
    expect(defaultPlacement('redo')).toBe('slim')
    expect(defaultPlacement('add')).toBe('slim')
    expect(defaultPlacement('copy')).toBe('expanded')
    expect(defaultPlacement('panel:palette')).toBe('expanded')
    expect(defaultPlacement('save')).toBe('expanded')
  })
})

describe('useDockPrefs store', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset to defaults between tests (the store is a module singleton).
    useDockPrefs.getState().resetPlacements()
  })

  it('setPlacement updates the store and persists to localStorage', () => {
    useDockPrefs.getState().setPlacement('save', 'slim')
    expect(useDockPrefs.getState().placements.save).toBe('slim')

    const persisted = JSON.parse(localStorage.getItem(DOCK_PLACEMENT_KEY) ?? '{}')
    expect(persisted.save).toBe('slim')
  })

  it('resetPlacements restores every control to its default', () => {
    useDockPrefs.getState().setPlacement('undo', 'hidden')
    useDockPrefs.getState().resetPlacements()
    expect(useDockPrefs.getState().placements.undo).toBe('slim')
  })
})
