/**
 * FloatingDock — the draggable, multi-level floating control surface for the
 * mobile canvas (spec §10.1 edge-anchored chrome), adapted from iux's
 * DraggableControls. It replaces the old fixed bottom tool bar and the separate
 * add button with one surface the user can drag anywhere and customise.
 *
 * With the mode-less interaction model (spec §10.2) there are no Select/Connect/
 * Add tool buttons: selecting, connecting and marquee-ing are all gestures on the
 * canvas. The dock is purely a control surface with two levels of progressive
 * disclosure:
 *   - **Slim bar** (always visible): whichever controls the user has placed
 *     `slim` (Undo/Redo/Add by default), plus an expand toggle.
 *   - **Expanded panel** (toggled): the controls placed `expanded`, grouped by
 *     category (Panels / Edit / Display / File), plus a **Customize** section
 *     that moves any control between Slim / Expanded / Hidden.
 *
 * The dock is data-driven: every configurable control is a {@link DOCK_CONTROLS}
 * registry entry and its surface is its placement in the {@link useDockPrefs}
 * store. The panel/display toggles are client UI state; only the editing/file
 * actions reach the gateway, via the callbacks passed in. Position and expanded
 * state persist to localStorage; dragging uses pointer capture.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { useSheets, type SheetKey } from '../sheets'
import { useCanvasPrefs } from '../canvasPrefs'
import {
  DOCK_CATEGORIES,
  DOCK_CONTROLS,
  PLACEMENTS,
  PLACEMENT_LABELS,
  useDockPrefs,
  type DockControlDef,
  type Placement,
} from '../dockControls'

/** Callbacks + enablement for the editing/file actions, which reach the gateway
 *  and so are owned by the editor rather than the dock. */
export interface FloatingDockProps {
  /** Sheet keys whose panel currently has content (others' tabs are disabled). */
  availableSheets: readonly SheetKey[]
  canUndo: boolean
  canRedo: boolean
  /** A diagram is resolved and ready — enables add / paste / save. */
  canAct: boolean
  /** An add-node mutation is in flight — disables Add so rapid taps can't place
   *  two nodes at the same (stale-count) position. */
  addBusy?: boolean
  /** Something is selected — enables copy. */
  hasSelection: boolean
  onAddNode: () => void
  onUndo: () => void
  onRedo: () => void
  onCopy: () => void
  onPaste: () => void
  onSave: () => void
  onLoad: () => void
}

interface Position {
  x: number
  y: number
}

const POS_KEY = 'nodge.dockPos'
const EXPANDED_KEY = 'nodge.dockExpanded'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Default resting place: bottom, horizontally centred (the old bottom bar's spot). */
function defaultPos(): Position {
  if (typeof window === 'undefined') return { x: 16, y: 16 }
  return {
    x: Math.max(8, Math.round((window.innerWidth - 320) / 2)),
    y: Math.max(8, window.innerHeight - 96),
  }
}

function loadPos(): Position {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Position
      if (typeof p.x === 'number' && typeof p.y === 'number') return p
    }
  } catch {
    /* ignore */
  }
  return defaultPos()
}

function loadExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === 'true'
  } catch {
    return false
  }
}

/** A reusable on/off switch (ARIA switch) for the display toggles. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`dock-toggle${checked ? ' dock-toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="dock-toggle__label">{label}</span>
      <span className="dock-toggle__track" aria-hidden="true">
        <span className="dock-toggle__thumb" />
      </span>
    </button>
  )
}

export function FloatingDock(props: FloatingDockProps) {
  const { availableSheets } = props
  const sheet = useSheets((s) => s.sheet)
  const toggleSheet = useSheets((s) => s.toggleSheet)

  const showMinimap = useCanvasPrefs((s) => s.showMinimap)
  const showBackground = useCanvasPrefs((s) => s.showBackground)
  const setShowMinimap = useCanvasPrefs((s) => s.setShowMinimap)
  const setShowBackground = useCanvasPrefs((s) => s.setShowBackground)

  const placements = useDockPrefs((s) => s.placements)

  const [pos, setPos] = useState<Position>(() => loadPos())
  const [expanded, setExpanded] = useState<boolean>(() => loadExpanded())
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  // Persist position + expanded state.
  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos))
    } catch {
      /* ignore */
    }
  }, [pos])
  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, String(expanded))
    } catch {
      /* ignore */
    }
  }, [expanded])

  // Keep the dock on-screen across resizes / orientation changes.
  useEffect(() => {
    const clampToViewport = () => {
      const el = containerRef.current
      const w = el?.offsetWidth ?? 320
      const h = el?.offsetHeight ?? 56
      setPos((prev) => {
        const nx = clamp(prev.x, 4, Math.max(4, window.innerWidth - w - 4))
        const ny = clamp(prev.y, 4, Math.max(4, window.innerHeight - h - 4))
        return nx === prev.x && ny === prev.y ? prev : { x: nx, y: ny }
      })
    }
    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    window.addEventListener('orientationchange', clampToViewport)
    return () => {
      window.removeEventListener('resize', clampToViewport)
      window.removeEventListener('orientationchange', clampToViewport)
    }
  }, [expanded, customizeOpen])

  // Escape collapses the expanded panel (non-modal; focus is never trapped).
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  // ── Drag (grip only, so button taps never start a drag) ──
  const onGripDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  const onGripMove = (e: ReactPointerEvent) => {
    const s = dragRef.current
    if (!s) return
    const el = containerRef.current
    const w = el?.offsetWidth ?? 320
    const h = el?.offsetHeight ?? 56
    setPos({
      x: clamp(s.ox + (e.clientX - s.sx), 4, window.innerWidth - w - 4),
      y: clamp(s.oy + (e.clientY - s.sy), 4, window.innerHeight - h - 4),
    })
  }
  const onGripUp = (e: ReactPointerEvent) => {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  // Resolve a control's live click handler + disabled/pressed state.
  const controlState = (
    def: DockControlDef,
  ): { onClick: () => void; disabled?: boolean; expandedTab?: boolean; on?: boolean } => {
    switch (def.id) {
      case 'undo':
        return { onClick: props.onUndo, disabled: !props.canUndo }
      case 'redo':
        return { onClick: props.onRedo, disabled: !props.canRedo }
      case 'add':
        return { onClick: props.onAddNode, disabled: !props.canAct || !!props.addBusy }
      case 'copy':
        return { onClick: props.onCopy, disabled: !props.hasSelection }
      case 'paste':
        return { onClick: props.onPaste, disabled: !props.canAct }
      case 'save':
        return { onClick: props.onSave, disabled: !props.canAct }
      case 'load':
        return { onClick: props.onLoad }
      case 'toggle:minimap':
        return { onClick: () => setShowMinimap(!showMinimap), on: showMinimap }
      case 'toggle:background':
        return { onClick: () => setShowBackground(!showBackground), on: showBackground }
      default:
        if (def.sheet) {
          return {
            onClick: () => toggleSheet(def.sheet!),
            disabled: !availableSheets.includes(def.sheet),
            expandedTab: sheet === def.sheet,
          }
        }
        return { onClick: () => {} }
    }
  }

  /** A compact icon-only button for the slim row. */
  const renderSlim = (def: DockControlDef) => {
    const st = controlState(def)
    return (
      <button
        key={def.id}
        type="button"
        className={`dock-btn dock-btn--icon${st.on ? ' dock-btn--on' : ''}`}
        aria-label={def.ariaLabel}
        aria-pressed={def.kind === 'toggle' ? !!st.on : undefined}
        aria-expanded={def.kind === 'panel' ? !!st.expandedTab : undefined}
        disabled={st.disabled}
        title={def.ariaLabel}
        onClick={st.onClick}
      >
        <span className="dock-btn__icon" aria-hidden="true">
          {def.icon}
        </span>
      </button>
    )
  }

  /** A full icon+label control for the expanded panel. */
  const renderExpanded = (def: DockControlDef) => {
    if (def.kind === 'toggle') {
      const checked = def.id === 'toggle:minimap' ? showMinimap : showBackground
      const onChange = def.id === 'toggle:minimap' ? setShowMinimap : setShowBackground
      return <Toggle key={def.id} label={def.label} checked={checked} onChange={onChange} />
    }
    const st = controlState(def)
    return (
      <button
        key={def.id}
        type="button"
        className="dock-btn dock-btn--row"
        aria-label={def.ariaLabel}
        aria-expanded={def.kind === 'panel' ? !!st.expandedTab : undefined}
        disabled={st.disabled}
        onClick={st.onClick}
      >
        <span className="dock-btn__icon" aria-hidden="true">
          {def.icon}
        </span>
        <span className="dock-btn__label">{def.label}</span>
      </button>
    )
  }

  const slimControls = DOCK_CONTROLS.filter((d) => placements[d.id] === 'slim')
  const isBottomHalf = typeof window !== 'undefined' && pos.y > window.innerHeight / 2
  const isRightHalf = typeof window !== 'undefined' && pos.x > window.innerWidth / 2
  const containerStyle: CSSProperties = { left: pos.x, top: pos.y }

  return (
    <div
      ref={containerRef}
      className={`dock${expanded ? ' dock--expanded' : ''}`}
      style={containerStyle}
      role="region"
      aria-label="Canvas controls"
    >
      <div className="dock-bar" role="toolbar" aria-label="Canvas tools">
        <span
          className="dock-grip"
          role="presentation"
          aria-hidden="true"
          title="Drag to move"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        >
          ⠿
        </span>
        {slimControls.length > 0 && (
          <div className="dock-slim" role="group" aria-label="Quick controls">
            {slimControls.map(renderSlim)}
          </div>
        )}
        <button
          type="button"
          className="dock-btn dock-btn--icon dock-expand"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide more controls' : 'Show more controls'}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="dock-btn__icon" aria-hidden="true">
            {expanded ? '⌄' : '⌃'}
          </span>
        </button>
      </div>

      {/* The expanded panel is absolutely anchored above the bar when the dock
          sits in the bottom half of the screen, below it otherwise — so opening
          it never shoves the bar off-screen. */}
      {expanded && (
        <DockPanel
          placements={placements}
          renderExpanded={renderExpanded}
          customizeOpen={customizeOpen}
          setCustomizeOpen={setCustomizeOpen}
          direction={isBottomHalf ? 'up' : 'down'}
          align={isRightHalf ? 'right' : 'left'}
        />
      )}
    </div>
  )
}

/** The expanded panel: controls placed `expanded`, grouped by category, plus
 *  the Customize section. Split out so it can render above or below the bar. */
function DockPanel({
  placements,
  renderExpanded,
  customizeOpen,
  setCustomizeOpen,
  direction,
  align,
}: {
  placements: Record<string, Placement>
  renderExpanded: (def: DockControlDef) => ReactElement
  customizeOpen: boolean
  setCustomizeOpen: (next: boolean) => void
  direction: 'up' | 'down'
  align: 'left' | 'right'
}) {
  return (
    <div
      className={`dock-panel dock-panel--${direction} dock-panel--align-${align}`}
      role="group"
      aria-label="More controls"
    >
      {DOCK_CATEGORIES.map((cat) => {
        const items = DOCK_CONTROLS.filter(
          (d) => d.category === cat && placements[d.id] === 'expanded',
        )
        if (items.length === 0) return null
        return (
          <section key={cat} className="dock-section">
            <p className="dock-section__title">{cat}</p>
            <div className="dock-section__items">{items.map(renderExpanded)}</div>
          </section>
        )
      })}
      <CustomizeSection open={customizeOpen} setOpen={setCustomizeOpen} />
    </div>
  )
}

/** Customize disclosure: a placement picker (Slim / Expanded / Hidden) for every
 *  registered control, persisted live, plus a reset-to-defaults action. */
function CustomizeSection({ open, setOpen }: { open: boolean; setOpen: (next: boolean) => void }) {
  const placements = useDockPrefs((s) => s.placements)
  const setPlacement = useDockPrefs((s) => s.setPlacement)
  const resetPlacements = useDockPrefs((s) => s.resetPlacements)

  return (
    <section className="dock-section dock-customize">
      <button
        type="button"
        className="dock-customize__toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="dock-customize__caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>Customize</span>
      </button>
      {open && (
        <div className="dock-customize__body">
          {DOCK_CONTROLS.map((def) => (
            <div key={def.id} className="dock-customize__row">
              <span className="dock-customize__name">{def.label}</span>
              <span
                className="dock-customize__choices"
                role="radiogroup"
                aria-label={`${def.ariaLabel} placement`}
              >
                {PLACEMENTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={placements[def.id] === p}
                    className={`dock-customize__choice${
                      placements[def.id] === p ? ' is-active' : ''
                    }`}
                    onClick={() => setPlacement(def.id, p)}
                  >
                    {PLACEMENT_LABELS[p]}
                  </button>
                ))}
              </span>
            </div>
          ))}
          <button type="button" className="dock-customize__reset" onClick={resetPlacements}>
            Reset to defaults
          </button>
        </div>
      )}
    </section>
  )
}
