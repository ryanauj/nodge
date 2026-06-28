/**
 * Unit tests for the tool-mode store and the pure mode→React-Flow-props mapping
 * (spec §10.2). These are the "no gesture conflicts" proof at the logic layer:
 * pan vs. move vs. connect are mutually exclusive per mode, so "draw an edge"
 * can never fight "pan". The store is pure client UI state — no gateway calls.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  toolModeFlowProps,
  useToolMode,
  TOOL_MODES,
  type ToolMode,
} from './toolMode'

describe('toolModeFlowProps (gesture disambiguation)', () => {
  it('Select mode: pan works AND nodes are draggable to move; no marquee-on-drag', () => {
    const p = toolModeFlowProps('select')
    expect(p.panOnDrag).toBe(true)
    expect(p.nodesDraggable).toBe(true)
    expect(p.selectionOnDrag).toBe(false) // a drag is never a marquee → never an edge
    expect(p.zoomOnPinch).toBe(true)
  })

  it('Connect mode: panning is OFF and nodes are pinned so tap→tap makes an edge', () => {
    const p = toolModeFlowProps('connect')
    // Pan off → a tap on a node is unambiguous; nodes not draggable → a drag
    // can't be a move; connecting stays enabled.
    expect(p.panOnDrag).toBe(false)
    expect(p.nodesDraggable).toBe(false)
    expect(p.nodesConnectable).toBe(true)
    expect(p.elementsSelectable).toBe(true)
  })

  it('Add mode: panning works but nodes are pinned and not selectable (tap = add)', () => {
    const p = toolModeFlowProps('add')
    expect(p.panOnDrag).toBe(true)
    expect(p.nodesDraggable).toBe(false)
    expect(p.elementsSelectable).toBe(false)
  })

  it('pinch-zoom and pan-on-scroll are mode-independent (pinch always on, scroll off)', () => {
    for (const mode of TOOL_MODES) {
      const p = toolModeFlowProps(mode)
      expect(p.zoomOnPinch).toBe(true)
      expect(p.panOnScroll).toBe(false)
    }
  })

  it('no mode both drags nodes AND draws an edge by marquee at once', () => {
    for (const mode of TOOL_MODES) {
      const p = toolModeFlowProps(mode)
      // selectionOnDrag (which would let a drag begin a box/edge gesture) is
      // never combined with a draggable-node move in a way that conflicts.
      expect(p.selectionOnDrag).toBe(false)
    }
  })
})

describe('useToolMode store', () => {
  beforeEach(() => {
    useToolMode.setState({ mode: 'select', sheet: null, connectSourceId: null })
  })

  it('switching mode clears any pending connect source', () => {
    useToolMode.getState().setConnectSource('node-1')
    expect(useToolMode.getState().connectSourceId).toBe('node-1')
    useToolMode.getState().setMode('connect')
    expect(useToolMode.getState().mode).toBe('connect')
    expect(useToolMode.getState().connectSourceId).toBeNull()
  })

  it('opening, toggling and closing a sheet tracks a single active sheet', () => {
    useToolMode.getState().openSheet('palette')
    expect(useToolMode.getState().sheet).toBe('palette')
    useToolMode.getState().toggleSheet('palette') // same key → close
    expect(useToolMode.getState().sheet).toBeNull()
    useToolMode.getState().toggleSheet('properties') // different → open
    expect(useToolMode.getState().sheet).toBe('properties')
    useToolMode.getState().closeSheet()
    expect(useToolMode.getState().sheet).toBeNull()
  })

  it('exposes exactly the three documented modes', () => {
    expect(TOOL_MODES).toEqual<readonly ToolMode[]>(['select', 'connect', 'add'])
  })
})
