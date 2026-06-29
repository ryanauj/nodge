/**
 * Palette switcher (spec §8.4; §D10 — palettes demoted to app-chrome theme +
 * preset/seed source). Lists the graph's palettes (the seeded built-in library
 * plus any user palettes) and reports the chosen one up via `onSelect`. Per-canvas
 * palette assignment was removed (§D10): node/edge styles are concrete snapshots,
 * so the palette is a chrome theme / fallback, not a live per-canvas reskin.
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
