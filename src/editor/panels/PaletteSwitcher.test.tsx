/**
 * PaletteSwitcher component test (spec §8.4, Phase 3). Real in-memory gateway.
 * Proves the switcher lists the graph's palettes and assigns the chosen one to
 * the view via `updateView({ paletteId })`.
 */

import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'
import { renderWithGateway } from './panelTestUtils'
import { PaletteSwitcher } from './PaletteSwitcher'
import { BUILTIN_PALETTES } from '../style'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const palettes = []
  for (const b of BUILTIN_PALETTES) {
    palettes.push(await gw.createPalette(graph.id, { name: b.name, tokens: b.tokens, builtin: true }))
  }
  const board = await gw.createBoard(graph.id, { name: 'B' })
  const view = await gw.createView(board.id, { name: 'V', paletteId: palettes[0].id })
  return { graphId: graph.id, viewId: view.id, palettes }
}

describe('PaletteSwitcher', () => {
  it('lists palettes and switches the view palette via updateView', async () => {
    const gw = await createMemoryGateway()
    const { graphId, viewId, palettes } = await seed(gw)
    const onChanged = vi.fn()
    renderWithGateway(
      <PaletteSwitcher
        graphId={graphId}
        viewId={viewId}
        currentPaletteId={palettes[0].id}
        onChanged={onChanged}
      />,
      gw,
    )
    // Wait for the palettes query to populate the options.
    await waitFor(() => expect(screen.getByText(BUILTIN_PALETTES[0].name)).toBeInTheDocument())
    for (const b of BUILTIN_PALETTES) expect(screen.getByText(b.name)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Canvas palette'), { target: { value: palettes[1].id } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())

    const board = await gw.getBoard((await gw.getGraph(graphId)).boards[0].id)
    expect(board.views.find((v) => v.id === viewId)?.paletteId).toBe(palettes[1].id)
  })
})
