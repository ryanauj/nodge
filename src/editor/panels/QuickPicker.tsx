/**
 * Drag-to-create quick-picker (spec §9.4, §12 Phase 2).
 *
 * Opened on React Flow `onConnectEnd` into empty canvas. Two paths:
 *   (a) use an existing entity → a new node placing it + the connecting edge;
 *   (b) create a new entity → name + prototype to link, seeded from the prototype.
 * Both resolve through ONE undoable gateway command (in the Editor).
 *
 * This is now a thin wrapper over the shared {@link EntityPicker} (design §9 / D6):
 * the tabbed search dialog, the mobile bottom-sheet / desktop modal presentation,
 * and the a11y (focus trap, Esc, ≥44px targets) all live there. QuickPicker only
 * keeps the edge-drop framing — a "Connect to" title, a "Create & connect" action,
 * and the legacy `prototypes` prop (filtered to node prototypes for the picker).
 */

import { useMemo } from 'react'
import type { Entity, Prototype } from '../../model'
import { EntityPicker } from './EntityPicker'

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
  const nodePrototypes = useMemo(() => prototypes.filter((p) => p.kind === 'node'), [prototypes])

  return (
    <EntityPicker
      entities={entities}
      nodePrototypes={nodePrototypes}
      onUseExisting={onUseExisting}
      onCreateNew={onCreateNew}
      onCancel={onCancel}
      title="Connect to"
      createLabel="Create & connect"
    />
  )
}
