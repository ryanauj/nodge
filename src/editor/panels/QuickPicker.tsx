/**
 * Drag-to-create quick-picker (spec §9.4, §12 Phase 2).
 *
 * Opened on React Flow `onConnectEnd` into empty canvas. Two paths:
 *   (a) use an existing entity → a new node placing it + the connecting edge;
 *   (b) create a new entity → name + prototype to link, seeded from the prototype.
 * Both resolve through ONE undoable gateway command (in the Editor). The picker
 * itself is a plain dialog (Phase 5 owns the touch/bottom-sheet framework); it
 * supports search over existing entities and prototypes.
 */

import { useMemo, useState } from 'react'
import type { Entity, Prototype } from '../../model'

export interface QuickPickerProps {
  entities: Entity[]
  prototypes: Prototype[]
  onUseExisting: (entityId: string) => void
  onCreateNew: (name: string, prototypeId: string | null) => void
  onCancel: () => void
}

export function QuickPicker({
  entities,
  prototypes,
  onUseExisting,
  onCreateNew,
  onCancel,
}: QuickPickerProps) {
  const [tab, setTab] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [prototypeId, setPrototypeId] = useState<string>('')

  const nodePrototypes = useMemo(() => prototypes.filter((p) => p.kind === 'node'), [prototypes])

  const filteredEntities = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entities
    return entities.filter((e) => e.name.toLowerCase().includes(q))
  }, [entities, query])

  return (
    <div className="quickpicker-backdrop" role="dialog" aria-label="Connect to">
      <div className="quickpicker">
        <div className="quickpicker-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'existing'}
            className={tab === 'existing' ? 'active' : ''}
            onClick={() => setTab('existing')}
          >
            Use existing
          </button>
          <button
            role="tab"
            aria-selected={tab === 'new'}
            className={tab === 'new' ? 'active' : ''}
            onClick={() => setTab('new')}
          >
            Create new
          </button>
        </div>

        {tab === 'existing' ? (
          <div className="quickpicker-body">
            <input
              type="search"
              autoFocus
              aria-label="Search entities"
              placeholder="Search entities"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="panel-list" aria-label="Existing entities">
              {filteredEntities.map((e) => (
                <li key={e.id}>
                  <button onClick={() => onUseExisting(e.id)}>{e.name}</button>
                </li>
              ))}
              {filteredEntities.length === 0 && <li className="panel-empty">No matches</li>}
            </ul>
          </div>
        ) : (
          <div className="quickpicker-body">
            <label className="panel-field">
              <span>Name</span>
              <input
                autoFocus
                aria-label="New entity name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="panel-field">
              <span>Prototype</span>
              <select
                aria-label="Prototype to link"
                value={prototypeId}
                onChange={(e) => setPrototypeId(e.target.value)}
              >
                <option value="">(none)</option>
                {nodePrototypes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!name.trim()}
              onClick={() => onCreateNew(name.trim(), prototypeId || null)}
            >
              Create &amp; connect
            </button>
          </div>
        )}

        <div className="quickpicker-footer">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
