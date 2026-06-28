/**
 * Per-view palette switcher (spec §8.4, §12 Phase 3).
 *
 * Lists the graph's palettes (the seeded built-in library + any user palettes)
 * and assigns the chosen one to the active view via `updateView({ paletteId })`.
 * Because `diagram.ts` resolves a view's tokens from its palette and node/edge
 * styles are token-referenced, switching re-skins everything not pinned. Phase 3
 * is palette *selection* only; the token-level editor is Phase 4.
 */

import { useQuery, useMutation } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Uuid } from '../../gateway'

export interface PaletteSwitcherProps {
  graphId: Uuid
  viewId: Uuid
  /** The view's current palette id (controls the selected option). */
  currentPaletteId: Uuid | null
  /** Called after the palette is switched so the canvas re-skins. */
  onChanged: () => void
}

export function PaletteSwitcher({
  graphId,
  viewId,
  currentPaletteId,
  onChanged,
}: PaletteSwitcherProps) {
  const getGateway = useGateway()

  const palettes = useQuery({
    queryKey: ['palettes', graphId],
    queryFn: async () => (await getGateway()).listPalettes(graphId),
  })

  const switchPalette = useMutation({
    mutationFn: async (paletteId: Uuid) =>
      (await getGateway()).updateView(viewId, { paletteId }),
    onSuccess: onChanged,
  })

  return (
    <section className="panel" aria-label="Palette">
      <h2 className="panel-title">Palette</h2>
      <label className="panel-field">
        <span>Canvas palette</span>
        <select
          aria-label="Canvas palette"
          value={currentPaletteId ?? ''}
          onChange={(e) => switchPalette.mutate(e.target.value)}
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
