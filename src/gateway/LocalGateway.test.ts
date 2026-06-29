import { describe, it, expect } from 'vitest'
import { createMemoryGateway, type GatewayDeps } from './index'
import { LocalGateway } from './LocalGateway'
import { createMemorySqliteFromBytes } from '../db/wasm'
import { serializeDocument } from '../io'
import { CURRENT_SCHEMA_VERSION, type NodgeDocument } from '../model/document'

/** Deterministic ids/clock so assertions are stable; round-trip works regardless. */
function deterministicDeps(): GatewayDeps {
  let n = 0
  let t = 0
  return {
    newId: () => `id-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

/** Build a fully-populated graph touching every table, through the gateway. */
async function buildSampleGraph(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'Sample', description: 'a graph' })
  const proto = await gw.createPrototype(graph.id, {
    kind: 'node',
    name: 'Service',
    shape: 'rounded',
    defaultLabel: 'svc',
    metadata: { tier: 'backend' },
    linkScaffold: [{ id: 'l0', kind: 'url', target: 'https://x', label: 'docs' }],
  })
  await gw.createPalette(graph.id, {
    name: 'Default',
    tokens: { surface: '#fff' },
    builtin: true,
  })

  const a = await gw.createEntity(graph.id, {
    name: 'A',
    nodePrototypeId: proto.id,
    links: [{ id: 'lnk1', kind: 'url', target: 'https://a', label: 'A' }],
    metadata: { k: 'v' },
  })
  const b = await gw.createEntity(graph.id, { name: 'B' })
  const rel = await gw.createRelationship(graph.id, {
    sourceEntityId: a.id,
    targetEntityId: b.id,
    label: 'calls',
    directed: true,
  })

  const diagram = await gw.createDiagram(graph.id, { name: 'Diagram 1' })
  const n1 = await gw.createNode(diagram.id, { entityId: a.id, label: 'A node' })
  const n2 = await gw.createNode(diagram.id, { entityId: b.id, label: 'B node' })
  await gw.createEdge(diagram.id, {
    relationshipId: rel.id,
    sourceNodeId: n1.id,
    targetNodeId: n2.id,
    label: 'calls',
  })
  const layout = await gw.createLayout(diagram.id, {
    name: 'Layout 1',
    viewport: { x: 0, y: 0, zoom: 1 },
  })
  await gw.bulkUpsertPositions(layout.id, [
    { nodeId: n1.id, x: 10, y: 20 },
    { nodeId: n2.id, x: 30, y: 40 },
  ])
  return graph
}

describe('LocalGateway — JSON round-trip', () => {
  it('exports a graph and re-imports it into a fresh DB byte-identically', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const graph = await buildSampleGraph(gw)

    const doc1 = await gw.exportJson(graph.id)
    const json1 = serializeDocument(doc1)

    // Fresh, independent database + gateway.
    const gw2 = await createMemoryGateway(deterministicDeps())
    const imported = await gw2.importJson(doc1)
    const doc2 = await gw2.exportJson(imported.id)
    const json2 = serializeDocument(doc2)

    expect(json2).toEqual(json1)
  })

  it('round-trips through the .sqlite binary export as well', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const graph = await buildSampleGraph(gw)
    const doc1 = await gw.exportJson(graph.id)

    const bytes = await gw.exportSqlite()
    expect(bytes.byteLength).toBeGreaterThan(0)

    // Reopen the exact bytes into a new in-memory DB and read back the graph.
    const restoredDb = await createMemorySqliteFromBytes(bytes)
    const gw2 = await LocalGateway.open(restoredDb, deterministicDeps())
    const doc2 = await gw2.exportJson(graph.id)
    expect(serializeDocument(doc2)).toEqual(serializeDocument(doc1))
  })
})

describe('LocalGateway — command layer', () => {
  it('stamps UUID, version and updatedAt on create', async () => {
    const gw = await createMemoryGateway()
    const graph = await gw.createGraph({ name: 'G' })
    const entity = await gw.createEntity(graph.id, { name: 'X' })

    expect(entity.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(entity.version).toBe(1)
    expect(typeof entity.updatedAt).toBe('string')
    expect(entity.updatedAt.length).toBeGreaterThan(0)
  })

  it('bumps version on update and reverts it on undo', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const graph = await gw.createGraph({ name: 'G' })
    const created = await gw.createEntity(graph.id, { name: 'X' })

    const updated = await gw.updateEntity(created.id, { name: 'Y' })
    expect(updated.name).toBe('Y')
    expect(updated.version).toBe(2)
    expect(updated.updatedAt).not.toEqual(created.updatedAt)

    expect(await gw.commands.undo()).toBe(true)
    const afterUndo = (await gw.getGraph(graph.id)).entities.find((e) => e.id === created.id)
    expect(afterUndo?.name).toBe('X')
    expect(afterUndo?.version).toBe(1)

    expect(await gw.commands.redo()).toBe(true)
    const afterRedo = (await gw.getGraph(graph.id)).entities.find((e) => e.id === created.id)
    expect(afterRedo?.name).toBe('Y')
    expect(afterRedo?.version).toBe(2)
  })

  it('undo of a create removes the row entirely', async () => {
    const gw = await createMemoryGateway()
    const graph = await gw.createGraph({ name: 'G' })
    const entity = await gw.createEntity(graph.id, { name: 'X' })
    expect((await gw.getGraph(graph.id)).entities).toHaveLength(1)

    await gw.commands.undo()
    expect((await gw.getGraph(graph.id)).entities).toHaveLength(0)

    await gw.commands.redo()
    const entities = (await gw.getGraph(graph.id)).entities
    expect(entities).toHaveLength(1)
    expect(entities[0].id).toBe(entity.id)
  })
})

describe('LocalGateway — migrations', () => {
  it('rejects a pre-v3 document (the v3 model refactor is a clean break, §D11)', async () => {
    const legacy = {
      schemaVersion: 0,
      graph: {
        id: 'legacy-graph',
        name: 'Legacy',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
        version: 1,
      },
      entities: [],
      relationships: [],
      prototypes: [],
      boards: [],
    }

    const gw = await createMemoryGateway()
    await expect(gw.importJson(legacy as unknown as NodgeDocument)).rejects.toThrow(
      /No migration registered from schemaVersion 0/,
    )
  })

  it('imports a current-version document and stamps it at the current format version', async () => {
    const doc: NodgeDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      graph: {
        id: 'g',
        name: 'Fresh',
        description: '',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      },
      entities: [],
      relationships: [],
      prototypes: [],
      diagrams: [],
      palettes: [],
    }

    const gw = await createMemoryGateway()
    const graph = await gw.importJson(doc)
    expect(graph.description).toBe('')

    const out = await gw.exportJson(graph.id)
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(out.palettes).toEqual([])
    expect(out.diagrams).toEqual([])
  })
})
