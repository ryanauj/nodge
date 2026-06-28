import { describe, it, expect } from 'vitest'
import { ALL_TABLES, entityTable, nodePositionTable } from './schema'
import { createTableSql, schemaDdl } from './ddl'
import { parseRow, rowFromSql, rowToSql } from './table'
import { validateDocument, CURRENT_SCHEMA_VERSION } from './document'
import { ValidationError } from './validate'

describe('single model definition → three artifacts', () => {
  it('generates one CREATE TABLE per table with every column', () => {
    const ddl = schemaDdl()
    expect(ddl).toHaveLength(ALL_TABLES.length)
    for (const def of ALL_TABLES) {
      const sql = createTableSql(def)
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${def.name}`)
      for (const key of def.keys) {
        expect(sql).toContain(def.columns[key])
      }
      const pkCols = def.primaryKey.map((k) => def.columns[k]).join(', ')
      expect(sql).toContain(`PRIMARY KEY (${pkCols})`)
    }
  })

  it('maps camelCase DTO keys to snake_case columns', () => {
    expect(entityTable.columns.graphId).toBe('graph_id')
    expect(entityTable.columns.prototypeId).toBe('prototype_id')
    expect(entityTable.columns.styleOverride).toBe('style_override')
  })

  it('supports composite primary keys', () => {
    expect(nodePositionTable.primaryKey).toEqual(['viewId', 'nodeId'])
    expect(createTableSql(nodePositionTable)).toContain('PRIMARY KEY (view_id, node_id)')
  })

  it('marshals a typed row to SQL primitives and back losslessly', () => {
    const row = parseRow(
      entityTable,
      {
        id: 'e1',
        graphId: 'g1',
        name: 'Thing',
        prototypeId: null,
        styleOverride: { color: 'red' },
        links: [{ id: 'l1', kind: 'url', target: 'https://x', label: 'X' }],
        metadata: { a: 1 },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      },
      '$',
    )
    const { columns, values } = rowToSql(entityTable, row)
    const cells: Record<string, string | number | null> = {}
    columns.forEach((c, i) => (cells[c] = values[i]))
    // JSON columns are stored as TEXT.
    expect(typeof cells.links).toBe('string')
    expect(typeof cells.style_override).toBe('string')
    expect(rowFromSql(entityTable, cells)).toEqual(row)
  })
})

describe('document validator', () => {
  const minimalDoc = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    graph: {
      id: 'g',
      name: 'G',
      description: '',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: 't',
      updatedAt: 't',
      version: 1,
    },
    entities: [],
    relationships: [],
    prototypes: [],
    boards: [],
    palettes: [],
    styleProfiles: [],
  }

  it('accepts a well-formed document', () => {
    expect(() => validateDocument(minimalDoc)).not.toThrow()
  })

  it('rejects a document missing a required graph field', () => {
    const bad = { ...minimalDoc, graph: { ...minimalDoc.graph, name: undefined } }
    expect(() => validateDocument(bad)).toThrow(ValidationError)
  })

  it('rejects an entity with an invalid link kind', () => {
    const bad = {
      ...minimalDoc,
      entities: [
        {
          id: 'e',
          graphId: 'g',
          name: 'E',
          prototypeId: null,
          styleOverride: {},
          links: [{ id: 'l', kind: 'bogus', target: 't', label: 'l' }],
          metadata: {},
          createdAt: 't',
          updatedAt: 't',
          version: 1,
        },
      ],
    }
    expect(() => validateDocument(bad)).toThrow(/kind/)
  })
})
