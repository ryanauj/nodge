import { describe, it, expect } from 'vitest'
import { CommandBus, command } from './CommandBus'
import { Repository } from '../db/repository'
import { createMemorySqlite } from '../db/wasm'
import { runSqliteMigrations } from '../db/migrations'
import { nodePositionTable, viewTable, boardTable, graphTable } from '../model/schema'

async function setup() {
  const db = await createMemorySqlite()
  await runSqliteMigrations(db)
  const repo = new Repository(db)
  const bus = new CommandBus(repo)
  const now = '2026-01-01T00:00:00.000Z'
  await repo.insert(graphTable, {
    id: 'g', name: 'G', description: '', schemaVersion: 1,
    createdAt: now, updatedAt: now, version: 1,
  })
  await repo.insert(boardTable, {
    id: 'b', graphId: 'g', name: 'B', description: '',
    createdAt: now, updatedAt: now, version: 1,
  })
  await repo.insert(viewTable, {
    id: 'v', boardId: 'b', name: 'V', paletteId: null, filter: null, viewport: null,
    createdAt: now, updatedAt: now, version: 1,
  })
  return { repo, bus }
}

describe('CommandBus — composite transactions', () => {
  it('treats a multi-row command as a single undo unit', async () => {
    const { repo, bus } = await setup()

    await bus.execute(
      command('seedPositions', async (m) => {
        await m.put(nodePositionTable, { viewId: 'v', nodeId: 'n1', x: 1, y: 1 })
        await m.put(nodePositionTable, { viewId: 'v', nodeId: 'n2', x: 2, y: 2 })
      }),
    )
    expect(await repo.list(nodePositionTable, { viewId: 'v' })).toHaveLength(2)

    // A single undo reverts both inserts.
    await bus.undo()
    expect(await repo.list(nodePositionTable, { viewId: 'v' })).toHaveLength(0)

    // Redo restores both.
    await bus.redo()
    expect(await repo.list(nodePositionTable, { viewId: 'v' })).toHaveLength(2)
  })

  it('restores prior values when a put overwrites an existing row', async () => {
    const { repo, bus } = await setup()
    await bus.execute(
      command('init', (m) => m.put(nodePositionTable, { viewId: 'v', nodeId: 'n1', x: 1, y: 1 })),
    )
    await bus.execute(
      command('move', (m) => m.put(nodePositionTable, { viewId: 'v', nodeId: 'n1', x: 9, y: 9 })),
    )

    expect((await repo.getByKey(nodePositionTable, { viewId: 'v', nodeId: 'n1' }))?.x).toBe(9)
    await bus.undo()
    expect((await repo.getByKey(nodePositionTable, { viewId: 'v', nodeId: 'n1' }))?.x).toBe(1)
  })

  it('clears the redo stack when a new command is executed', async () => {
    const { bus } = await setup()
    await bus.execute(
      command('a', (m) => m.put(nodePositionTable, { viewId: 'v', nodeId: 'n1', x: 1, y: 1 })),
    )
    await bus.undo()
    expect(bus.canRedo).toBe(true)
    await bus.execute(
      command('b', (m) => m.put(nodePositionTable, { viewId: 'v', nodeId: 'n2', x: 2, y: 2 })),
    )
    expect(bus.canRedo).toBe(false)
  })
})
