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
import { LocalGateway } from './LocalGateway'
import { loadDiagram } from '../editor/diagram'
import { BUILTIN_PALETTES, DEFAULT_PALETTE_TOKENS } from '../editor/style'
import { DEFAULT_FULL_TOKENS, fullTokens, toPaletteTokens } from '../editor/tokens'
import { createMemorySqlite } from '../db/wasm'
import { Repository } from '../db/repository'
import { entityTable } from '../model/schema'
import { CURRENT_SCHEMA_VERSION } from '../model/document'

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

describe('Phase 4 — edge pin/unlink affordance: updateEdge is one undoable command (§8.3)', () => {
  it('pins an edge style key, survives a palette swap, and unpins as a single undo', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const paletteA = await gw.createPalette(graphId, {
      name: 'A',
      tokens: BUILTIN_PALETTES[0].tokens, // Default — edge stroke #4361ee
      builtin: true,
    })
    const paletteB = await gw.createPalette(graphId, {
      name: 'B',
      tokens: BUILTIN_PALETTES[1].tokens, // Midnight — edge stroke #60a5fa
      builtin: true,
    })
    await gw.updateView(viewId, { paletteId: paletteA.id })

    const a = await gw.addNode(boardId, viewId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(boardId, viewId, { name: 'B', x: 100, y: 0 })
    const { edge } = await gw.connectNodes(boardId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
    })

    // Pin the edge's stroke to a raw literal via updateEdge (link/unlink).
    await gw.updateEdge(edge.id, { styleOverride: { stroke: '#abcdef' } })
    let snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: paletteA.id })
    expect(snap.flowEdges.find((e) => e.id === edge.id)!.style.stroke).toBe('#abcdef')

    // Swap the view's palette — the pinned edge keeps its raw stroke.
    await gw.updateView(viewId, { paletteId: paletteB.id })
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: paletteB.id })
    expect(snap.flowEdges.find((e) => e.id === edge.id)!.style.stroke).toBe('#abcdef')

    // Unlink (write an override without the key) → follows the palette again.
    await gw.updateEdge(edge.id, { styleOverride: {} })
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: paletteB.id })
    expect(snap.flowEdges.find((e) => e.id === edge.id)!.style.stroke).toBe('#60a5fa')

    // Each updateEdge was a single undoable command: undo reverts the unlink.
    expect(await gw.undo()).toBe(true)
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: paletteB.id })
    expect(snap.flowEdges.find((e) => e.id === edge.id)!.style.stroke).toBe('#abcdef')
  })
})

describe('Phase 4 — StyleProfiles are referenceable + applied (§8.3)', () => {
  it('a node referencing a profile renders its style; a pin overrides it; clearing reverts', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const palette = await gw.createPalette(graphId, {
      name: 'Default',
      tokens: DEFAULT_PALETTE_TOKENS, // node surface #ffffff
      builtin: true,
    })
    await gw.updateView(viewId, { paletteId: palette.id })

    // A named bundle: a shared look that re-skins the node surface.
    const profile = await gw.createStyleProfile(graphId, {
      name: 'Brand',
      target: 'node',
      style: { surface: '#ff00aa' },
    })
    const added = await gw.addNode(boardId, viewId, { name: 'N', x: 0, y: 0 })
    const nodeId = added.node.id

    // Before referencing the profile, the node follows the palette surface.
    let snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: palette.id })
    expect(snap.flowNodes.find((n) => n.id === nodeId)!.data.style.surface).toBe('#ffffff')

    // Reference the profile on the node — it renders with the profile's surface.
    await gw.updateNode(nodeId, { styleProfileId: profile.id })
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: palette.id })
    expect(snap.flowNodes.find((n) => n.id === nodeId)!.data.style.surface).toBe('#ff00aa')

    // An explicit node pin still overrides the profile (pins win, §8.3).
    await gw.updateNode(nodeId, {
      styleProfileId: profile.id,
      styleOverride: { surface: '#00ff00' },
    })
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: palette.id })
    expect(snap.flowNodes.find((n) => n.id === nodeId)!.data.style.surface).toBe('#00ff00')

    // Removing the pin falls back to the profile again.
    await gw.updateNode(nodeId, { styleOverride: {} })
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: palette.id })
    expect(snap.flowNodes.find((n) => n.id === nodeId)!.data.style.surface).toBe('#ff00aa')

    // Clearing the reference reverts to the palette baseline (undoable command).
    await gw.updateNode(nodeId, { styleProfileId: null })
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: palette.id })
    expect(snap.flowNodes.find((n) => n.id === nodeId)!.data.style.surface).toBe('#ffffff')
    expect(await gw.undo()).toBe(true) // revert the clear
    snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: palette.id })
    expect(snap.flowNodes.find((n) => n.id === nodeId)!.data.style.surface).toBe('#ff00aa')
  })

  it('a referenced profile round-trips through the JSON export/import', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { graphId, boardId, viewId } = await newGraph(gw)
    const profile = await gw.createStyleProfile(graphId, {
      name: 'Brand',
      target: 'node',
      style: { surface: '#ff00aa' },
    })
    const added = await gw.addNode(boardId, viewId, { name: 'N', x: 0, y: 0 })
    await gw.updateNode(added.node.id, { styleProfileId: profile.id })

    const doc = await gw.exportJson(graphId)
    const fresh = await createMemoryGateway()
    const imported = await fresh.importJson(doc)
    const board = await fresh.getBoard((await fresh.getGraph(imported.id)).boards[0].id)
    const node = board.nodes.find((n) => n.id === added.node.id)!
    expect(node.styleProfileId).toBe(profile.id) // the reference survives
  })
})

describe('Phase 4 — backward compatibility: legacy data without styleProfileId still loads (§6.5)', () => {
  it('a legacy .nodge.json document (no styleProfileId field) imports + renders', async () => {
    // A schemaVersion-1 document: entities/nodes/prototypes predate the column.
    const legacyDoc = {
      schemaVersion: 1,
      graph: {
        id: 'g', name: 'Legacy', description: '', schemaVersion: 1,
        createdAt: 't', updatedAt: 't', version: 1,
      },
      entities: [
        {
          id: 'e1', graphId: 'g', name: 'E1', prototypeId: null,
          styleOverride: {}, links: [], metadata: {},
          createdAt: 't', updatedAt: 't', version: 1,
          // NOTE: no styleProfileId — the field did not exist at v1.
        },
      ],
      relationships: [],
      prototypes: [],
      boards: [
        {
          id: 'b', graphId: 'g', name: 'B', description: '',
          createdAt: 't', updatedAt: 't', version: 1,
          nodes: [
            {
              id: 'n1', boardId: 'b', entityId: 'e1', label: 'N1',
              styleOverride: {}, createdAt: 't', updatedAt: 't', version: 1,
              // NOTE: no styleProfileId.
            },
          ],
          edges: [],
          views: [
            {
              id: 'v', boardId: 'b', name: 'V', paletteId: null, filter: null,
              viewport: null, createdAt: 't', updatedAt: 't', version: 1,
              positions: [{ nodeId: 'n1', x: 0, y: 0 }],
            },
          ],
        },
      ],
      palettes: [],
      styleProfiles: [],
    }

    const gw = await createMemoryGateway()
    // The JSON migration chain backfills styleProfileId: null and bumps the version.
    const graph = await gw.importJson(legacyDoc as never)
    const detail = await gw.getGraph(graph.id)
    expect(detail.entities[0].styleProfileId).toBeNull()
    const board = await gw.getBoard(detail.boards[0].id)
    expect(board.nodes[0].styleProfileId).toBeNull()

    // It still renders — the node follows the palette baseline.
    const snap = await loadDiagram(gw, {
      graphId: graph.id, boardId: board.id, viewId: board.views[0].id, paletteId: null,
    })
    expect(snap.flowNodes).toHaveLength(1)
    expect(typeof snap.flowNodes[0].data.style.surface).toBe('string')

    // Re-export now carries the current schema version + the backfilled field.
    const out = await gw.exportJson(graph.id)
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(out.entities[0].styleProfileId).toBeNull()
  })

  it('a legacy SQLite DB (v1, no style_profile_id column) migrates + reads back', async () => {
    // Simulate a real OPFS database created before the column existed: build the
    // v1 tables by hand (without style_profile_id) and stamp user_version = 1.
    const db = await createMemorySqlite()
    await db.exec(
      'CREATE TABLE entity (id TEXT NOT NULL, graph_id TEXT NOT NULL, name TEXT NOT NULL, ' +
        'prototype_id TEXT, style_override TEXT NOT NULL, links TEXT NOT NULL, metadata TEXT NOT NULL, ' +
        'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (id))',
    )
    await db.exec(
      'CREATE TABLE node (id TEXT NOT NULL, board_id TEXT NOT NULL, entity_id TEXT NOT NULL, ' +
        'label TEXT NOT NULL, style_override TEXT NOT NULL, created_at TEXT NOT NULL, ' +
        'updated_at TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (id))',
    )
    await db.exec(
      'CREATE TABLE prototype (id TEXT NOT NULL, graph_id TEXT NOT NULL, kind TEXT NOT NULL, ' +
        'name TEXT NOT NULL, shape TEXT, default_label TEXT NOT NULL, style TEXT NOT NULL, ' +
        'metadata TEXT NOT NULL, link_scaffold TEXT NOT NULL, created_at TEXT NOT NULL, ' +
        'updated_at TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (id))',
    )
    await db.exec(
      "INSERT INTO entity VALUES ('e1','g','E1',NULL,'{}','[]','{}','t','t',1)",
    )
    await db.exec('PRAGMA user_version = 1')

    // Opening the gateway runs the v2 migration (ALTER TABLE ADD COLUMN).
    const gw = await LocalGateway.open(db)
    const repo = new Repository(db)
    const info = await db.all('PRAGMA table_info(entity)')
    expect(info.some((r) => r.name === 'style_profile_id')).toBe(true)
    // The pre-existing row reads back with a null reference and is otherwise intact.
    const entity = await repo.getById(entityTable, 'e1')
    expect(entity?.name).toBe('E1')
    expect(entity?.styleProfileId).toBeNull()
    void gw
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
