/**
 * Unit tests for the bottom-sheet UI store (spec §10.1). The store owns exactly
 * one open sheet at a time; it is pure client UI state (no gateway calls).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useSheets, SHEET_KEYS, SHEET_LABELS } from './sheets'

describe('useSheets store', () => {
  beforeEach(() => {
    useSheets.setState({ sheet: null })
  })

  it('opens, toggles and closes, tracking a single active sheet', () => {
    useSheets.getState().openSheet('palette')
    expect(useSheets.getState().sheet).toBe('palette')
    useSheets.getState().toggleSheet('palette') // same key → close
    expect(useSheets.getState().sheet).toBeNull()
    useSheets.getState().toggleSheet('properties') // different → open
    expect(useSheets.getState().sheet).toBe('properties')
    useSheets.getState().closeSheet()
    expect(useSheets.getState().sheet).toBeNull()
  })

  it('every sheet key has a human label', () => {
    for (const key of SHEET_KEYS) {
      expect(SHEET_LABELS[key]).toBeTruthy()
    }
  })
})
