/**
 * Phase 4 — Styling depth & palettes (spec §12) gateway integration tests.
 *
 * Real in-memory SQLite through the gateway + command bus. Proves the Phase 4
 * acceptance criteria at the data seam:
 *   - duplicate/create/update a palette, apply it to a view, and read the custom
 *     tokens back through the diagram transform (custom palette on a view);
 *   - pin one node's color via updateNode({ styleOverride }); it survives a
 *     palette swap while unpinned nodes re-skin;
 *   - style-profile create/rename/edit/delete are undoable commands;
 *   - a document in the OLD minimal token shape still imports + round-trips.
 * Each new mutation reverts as a single undo.
 */

import { describe, it, expect } from 'vitest'
import { createMemoryGateway, type GatewayDeps } from './index'
import type { LocalGateway } from './LocalGateway'
import { loadDiagram } from '../editor/diagram'
import { BUILTIN_PALETTES, DEFAULT_PALETTE_TOKENS } from '../editor/style'
import { DEFAULT_FULL_TOKENS, fullTokens, toPaletteTokens } from '../editor/tokens'

function deterministicDeps(): GatewayDeps {
  let n = 0
  let t = 0
  return {
    newId: () => `id-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

async function newGraph(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const board = await gw.createBoard(graph.id, { name: 'Board 1' })
  const view = await gw.createView(board.id, { name: 'View 1' })
  return { graphId: graph.id, boardId: board.id, viewId: view.id }
}

describe('Phase 4 — custom palette: duplicate, edit a token, apply to a view (§8.4)', () => {
  it('duplicatePalette + updatePalette tokens render through the diagram transform', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { graphId, boardId, viewId } = await newGraph(gw)
    const base = await gw.createPalette(graphId, {
      name: 'Default',
      tokens: DEFAULT_PALETTE_TOKENS,
      builtin: true,
    })

    // Duplicate the built-in → a new, editable (non-builtin) palette.
    const fork = await gw.duplicatePalette(base.id, 'My palette')
    expect(fork.builtin).toBe(false)
    expect(fork.name).toBe('My palette')

    // Edit a single token: a hot-pink node surface.
    const customNode = { ...fullTokens(fork.tokens).node, surface: '#ff00aa' }
    await gw.updatePalette(fork.id, {
      tokens: toPaletteTokens({ ...fullTokens(fork.tokens), node: customNode }),
    })

    // Assign it to the view and place a (following) node.
    await gw.updateView(viewId, { paletteId: fork.id })
    const node = await gw.addNode(boardId, viewId, { name: 'N', x: 0, y: 0 })

    const snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: fork.id })
    const flow = snap.flowNodes.find((n) => n.id === node.node.id)!
    expect(flow.data.style.surface).toBe('#ff00aa') // renders with the custom token
  })

  it('editing a built-in palette clears its builtin flag (seeded library stays pristine)', async () => {
    const gw = await createMemoryGateway()
    const { graphId } = await newGraph(gw)
    const p = await gw.createPalette(graphId, { name: 'Seeded', tokens: {}, builtin: true })
    const updated = await gw.updatePalette(p.id, {
      tokens: toPaletteTokens(DEFAULT_FULL_TOKENS),
    })
    expect(updated.builtin).toBe(false)
  })

  it('deletePalette / updatePalette / duplicatePalette are single undoable commands', async () => {
    const gw = await createMemoryGateway()
    const { graphId } = await newGraph(gw)
    const p = await gw.createPalette(graphId, { name: 'P', tokens: {}, builtin: false })

    await gw.updatePalette(p.id, { name: 'Renamed' })
    expect((await gw.listPalettes(graphId)).find((x) => x.id === p.id)?.name).toBe('Renamed')
    expect(await gw.undo()).toBe(true)
    expect((await gw.listPalettes(graphId)).find((x) => x.id === p.id)?.name).toBe('P')

    const dup = await gw.duplicatePalette(p.id, 'Dup')
    expect((await gw.listPalettes(graphId)).some((x) => x.id === dup.id)).toBe(true)
    expect(await gw.undo()).toBe(true)
    expect((await gw.listPalettes(graphId)).some((x) => x.id === dup.id)).toBe(false)

    await gw.deletePalette(p.id)
    expect((await gw.listPalettes(graphId)).some((x) => x.id === p.id)).toBe(false)
    expect(await gw.undo()).toBe(true)
    expect((await gw.listPalettes(graphId)).some((x) => x.id === p.id)).toBe(true)
  })
})

describe('Phase 4 — pin one node color; it survives a palette swap (§8.3)', () => {
  it('pinning surface via updateNode keeps the color across a palette switch', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const paletteA = await gw.createPalette(graphId, {
      name: 'A',
      tokens: BUILTIN_PALETTES[0].tokens, // Default — surface #ffffff
      builtin: true,
    })
    const paletteB = await gw.createPalette(graphId, {
      name: 'B',
      tokens: BUILTIN_PALETTES[1].tokens, // Midnight — surface #1f2937
      builtin: true,
    })
    await gw.updateView(viewId, { paletteId: paletteA.id })

    const following = await gw.addNode(boardId, viewId, { name: 'follow', x: 0, y: 0 })
    const pinnedNode = await gw.addNode(boardId, viewId, { name: 'pin', x: 100, y: 0 })

    // Pin the node's surface to a raw literal via the link/unlink affordance.
    await gw.updateNode(pinnedNode.node.id, { styleOverride: { surface: '#abcdef' } })

    let snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: paletteA.id })
    expect(snap.flowNodes.find((n) => n.id === following.node.id)!.data.style.surface).toBe('#ffffff')
    expect(snap.flowNodes.find((n) => n.id === pinnedNode.node.id)!.data.style.surface).toBe('#abcdef')

    // Swap the view's palette.
    await gw.updateView(viewId, { paletteId: paletteB.id })
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: paletteB.id })
    expect(snap.flowNodes.find((n) => n.id === following.node.id)!.data.style.surface).toBe('#1f2937')
    expect(snap.flowNodes.find((n) => n.id === pinnedNode.node.id)!.data.style.surface).toBe('#abcdef')
  })

  it('unpinning (removing the key) makes the node follow the palette again', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const palette = await gw.createPalette(graphId, {
      name: 'A',
      tokens: BUILTIN_PALETTES[1].tokens, // Midnight surface #1f2937
      builtin: true,
    })
    await gw.updateView(viewId, { paletteId: palette.id })
    const n = await gw.addNode(boardId, viewId, {
      name: 'N',
      x: 0,
      y: 0,
      styleOverride: { surface: '#abcdef' },
    })
    // Unlink: write a styleOverride without the surface key.
    await gw.updateNode(n.node.id, { styleOverride: {} })
    const snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: palette.id })
    expect(snap.flowNodes.find((x) => x.id === n.node.id)!.data.style.surface).toBe('#1f2937')
  })
})

describe('Phase 4 — style profile management (§8.3)', () => {
  it('create / rename / edit / delete a style profile, each undoable', async () => {
    const gw = await createMemoryGateway()
    const { graphId } = await newGraph(gw)
    const sp = await gw.createStyleProfile(graphId, {
      name: 'Accent',
      target: 'node',
      style: { border: '#4361ee' },
    })
    const renamed = await gw.updateStyleProfile(sp.id, { name: 'Brand' })
    expect(renamed.name).toBe('Brand')
    const restyled = await gw.updateStyleProfile(sp.id, { style: { border: '#ff0000' } })
    expect(restyled.style).toEqual({ border: '#ff0000' })

    expect(await gw.undo()).toBe(true) // revert restyle
    expect((await gw.listStyleProfiles(graphId)).find((x) => x.id === sp.id)?.style).toEqual({
      border: '#4361ee',
    })

    await gw.deleteStyleProfile(sp.id)
    expect((await gw.listStyleProfiles(graphId)).some((x) => x.id === sp.id)).toBe(false)
    expect(await gw.undo()).toBe(true)
    expect((await gw.listStyleProfiles(graphId)).some((x) => x.id === sp.id)).toBe(true)
  })
})

describe('Phase 4 — backward compatibility: old minimal palettes still load (§8.2)', () => {
  it('a document with a legacy {node,edge} palette imports + round-trips + renders', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { graphId } = await newGraph(gw)
    // A legacy palette: only the minimal Phase-1 token shape.
    const legacyTokens = {
      node: { surface: '#2b2b2b', content: '#fafafa', border: '#888888', shape: 'rect' },
      edge: { stroke: '#888888', strokeWidth: 1 },
    }
    const legacy = await gw.createPalette(graphId, { name: 'Legacy', tokens: legacyTokens })

    // Export → re-import into a fresh DB → the legacy palette survives unchanged.
    const doc = await gw.exportJson(graphId)
    const fresh = await createMemoryGateway()
    const importedGraph = await fresh.importJson(doc)
    const palettes = await fresh.listPalettes(importedGraph.id)
    const round = palettes.find((p) => p.id === legacy.id)!
    expect(round.tokens).toEqual(legacyTokens) // lossless round-trip

    // It still resolves to a complete, total style.
    const full = fullTokens(round.tokens)
    expect(full.node.surface).toBe('#2b2b2b')
    expect(full.node.shape).toBe('rect')
    // Fields the legacy palette never had are filled from defaults.
    expect(full.intent.primary.bg).toBe(DEFAULT_FULL_TOKENS.intent.primary.bg)
    expect(full.elevation.low).toBe(DEFAULT_FULL_TOKENS.elevation.low)
  })
})
