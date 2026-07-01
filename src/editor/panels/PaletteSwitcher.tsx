/**
 * Palette switcher (spec §8.4). Lists the graph's palettes (the seeded built-in
 * library plus any user palettes) and reports the chosen one up via `onSelect`.
 *
 * The parent (`Editor`) treats the selection as the **canvas theme**: a
 * client-side view preference that re-skins the canvas background and any
 * unpinned style keys through the per-view `PaletteRoot`. It is deliberately
 * non-destructive — per-node/edge styles are concrete snapshots (§D10), so
 * switching the palette never overwrites a pinned value; it only changes what the
 * still-linked keys fall back to.
 */

import { useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Uuid } from '../../gateway'

export interface PaletteSwitcherProps {
  graphId: Uuid
  /** The currently selected palette id (controls the selected option). */
  currentPaletteId: Uuid | null
  /** Called with the chosen palette id. */
  onSelect: (paletteId: Uuid) => void
}

export function PaletteSwitcher({ graphId, currentPaletteId, onSelect }: PaletteSwitcherProps) {
  const getGateway = useGateway()

  const palettes = useQuery({
    queryKey: ['palettes', graphId],
    queryFn: async () => (await getGateway()).listPalettes(graphId),
  })

  return (
    <section className="panel" aria-label="Palette">
      <h2 className="panel-title">Palette</h2>
      <label className="panel-field">
        <span>Canvas palette</span>
        <select
          aria-label="Canvas palette"
          value={currentPaletteId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {(palettes.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}
