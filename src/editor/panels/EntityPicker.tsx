/**
 * EntityPicker — the shared existing/new-entity tabbed picker (spec §9.4, design
 * §9 / D6). Two creation entry points reuse it:
 *
 *   - **Edge-drop** (drag a connection into empty canvas) via {@link QuickPicker},
 *     which is a thin wrapper over this component.
 *   - **Add-node** (Add-mode pane tap, the dock's Add button) — opening it at the
 *     target point instead of dropping an anonymous `Node N`.
 *
 * Two tabbed paths, with search over existing entities:
 *   (a) **Use existing** → pick an entity already in the graph;
 *   (b) **Create new**   → a name + an optional NodePrototype to link/seed from.
 *
 * Mobile-first (spec §10): on a phone-sized viewport it presents as a swipe-to-
 * dismiss **bottom sheet** (reusing {@link BottomSheet}); on wider viewports it is
 * a centered modal dialog. Both forms are a labelled `role="dialog"` with a
 * proper `tablist`, a navigable list, ≥44px hit targets, `Escape` to dismiss,
 * focus moved into the surface on open + trapped while open + returned to the
 * trigger on close, and visible `focus-visible` rings. No hover-only affordances.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type { Entity, Prototype } from '../../model'
import { BottomSheet } from './BottomSheet'

export interface EntityPickerProps {
  /** Existing entities in the graph (the "Use existing" tab searches over these). */
  entities: Entity[]
  /** Node prototypes available to seed a new entity from (the `<select>` options). */
  nodePrototypes: Prototype[]
  /** Use an existing entity → caller places a node / connects to it. */
  onUseExisting: (entityId: string) => void
  /** Create a new entity with a name and an optional prototype to link/seed. */
  onCreateNew: (name: string, nodePrototypeId: string | null) => void
  /** Dismiss without choosing. */
  onCancel: () => void
  /** Accessible name for the dialog / sheet title. Defaults to "Add node". */
  title?: string
  /** Label for the create button (varies by entry point). Defaults to "Create". */
  createLabel?: string
}

/** Phone-sized viewport → bottom-sheet presentation (matches `canvasPrefs`). */
function isPhoneViewport(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  } catch {
    return false
  }
}

/** Reactive phone-viewport flag so rotating / resizing swaps the presentation. */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(isPhoneViewport)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 640px)')
    const onChange = () => setPhone(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return phone
}

/** All tabbable elements inside `root`, in document order (for the focus trap). */
function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

/** The tabbed picker body, shared by the desktop dialog and the mobile sheet. */
function PickerBody({
  entities,
  nodePrototypes,
  onUseExisting,
  onCreateNew,
  createLabel,
}: {
  entities: Entity[]
  nodePrototypes: Prototype[]
  onUseExisting: (entityId: string) => void
  onCreateNew: (name: string, nodePrototypeId: string | null) => void
  createLabel: string
}) {
  const [tab, setTab] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [prototypeId, setPrototypeId] = useState<string>('')
  const baseId = useId()
  const existingTabId = `${baseId}-tab-existing`
  const newTabId = `${baseId}-tab-new`
  const existingPanelId = `${baseId}-panel-existing`
  const newPanelId = `${baseId}-panel-new`

  const filteredEntities = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entities
    return entities.filter((e) => e.name.toLowerCase().includes(q))
  }, [entities, query])

  return (
    <div className="entity-picker-body">
      <div className="entity-picker-tabs" role="tablist" aria-label="Add node by">
        <button
          type="button"
          role="tab"
          id={existingTabId}
          aria-selected={tab === 'existing'}
          aria-controls={existingPanelId}
          tabIndex={tab === 'existing' ? 0 : -1}
          className={tab === 'existing' ? 'active' : ''}
          onClick={() => setTab('existing')}
        >
          Use existing
        </button>
        <button
          type="button"
          role="tab"
          id={newTabId}
          aria-selected={tab === 'new'}
          aria-controls={newPanelId}
          tabIndex={tab === 'new' ? 0 : -1}
          className={tab === 'new' ? 'active' : ''}
          onClick={() => setTab('new')}
        >
          Create new
        </button>
      </div>

      {tab === 'existing' ? (
        <div
          className="entity-picker-pane"
          role="tabpanel"
          id={existingPanelId}
          aria-labelledby={existingTabId}
        >
          <input
            type="search"
            autoFocus
            aria-label="Search entities"
            placeholder="Search entities"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="entity-picker-list panel-list" aria-label="Existing entities">
            {filteredEntities.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onUseExisting(e.id)}>
                  {e.name}
                </button>
              </li>
            ))}
            {filteredEntities.length === 0 && <li className="panel-empty">No matches</li>}
          </ul>
        </div>
      ) : (
        <div
          className="entity-picker-pane"
          role="tabpanel"
          id={newPanelId}
          aria-labelledby={newTabId}
        >
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
            type="button"
            className="entity-picker-primary"
            disabled={!name.trim()}
            onClick={() => onCreateNew(name.trim(), prototypeId || null)}
          >
            {createLabel}
          </button>
        </div>
      )}
    </div>
  )
}

export function EntityPicker({
  entities,
  nodePrototypes,
  onUseExisting,
  onCreateNew,
  onCancel,
  title = 'Add node',
  createLabel = 'Create',
}: EntityPickerProps) {
  const isPhone = useIsPhone()

  // Remember the trigger so focus returns there when the picker closes (§10.4).
  // Captured during the first render — before any child `autoFocus` moves focus
  // into the picker — so it points at the element that opened it, not the input.
  const triggerRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null,
  )
  useEffect(() => {
    const trigger = triggerRef.current
    return () => trigger?.focus?.()
  }, [])

  const body = (
    <PickerBody
      entities={entities}
      nodePrototypes={nodePrototypes}
      onUseExisting={onUseExisting}
      onCreateNew={onCreateNew}
      createLabel={createLabel}
    />
  )

  // On a phone, present as the swipe-to-dismiss bottom sheet (Esc + drag-handle
  // dismiss + focus-on-open all live in BottomSheet). The footer Cancel is
  // redundant there (the sheet has its own close), so it is omitted.
  if (isPhone) {
    return (
      <BottomSheet title={title} open onClose={onCancel}>
        {body}
      </BottomSheet>
    )
  }

  return <DesktopDialog title={title} onCancel={onCancel} body={body} />
}

/** The centered desktop dialog: focus trap + Esc + focus-on-open + return. */
function DesktopDialog({
  title,
  onCancel,
  body,
}: {
  title: string
  onCancel: () => void
  body: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Move focus into the dialog on open (the search field via autoFocus, or the
  // dialog itself as a fallback) so keyboard users land inside it (§10.4).
  useEffect(() => {
    const root = dialogRef.current
    if (!root) return
    if (!root.contains(document.activeElement)) {
      const first = tabbables(root)[0]
      ;(first ?? root).focus()
    }
  }, [])

  // Trap Tab within the dialog and dismiss on Escape (§10.4 — escapable trap).
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = tabbables(root)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onCancel],
  )

  return (
    <div className="entity-picker-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="entity-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="entity-picker-header">
          <span className="entity-picker-title">{title}</span>
        </div>
        {body}
        <div className="entity-picker-footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
