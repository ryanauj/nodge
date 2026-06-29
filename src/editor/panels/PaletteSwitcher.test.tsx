/**
 * PaletteSwitcher component test (spec §8.4, §D10). Real in-memory gateway.
 * Proves the switcher lists the graph's palettes and reports the chosen one up
 * via `onSelect`.
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
  return { graphId: graph.id, palettes }
}

describe('PaletteSwitcher', () => {
  it('lists palettes and reports the chosen one via onSelect', async () => {
    const gw = await createMemoryGateway()
    const { graphId, palettes } = await seed(gw)
    const onSelect = vi.fn()
    renderWithGateway(
      <PaletteSwitcher
        graphId={graphId}
        currentPaletteId={palettes[0].id}
        onSelect={onSelect}
      />,
      gw,
    )
    // Wait for the palettes query to populate the options.
    await waitFor(() => expect(screen.getByText(BUILTIN_PALETTES[0].name)).toBeInTheDocument())
    for (const b of BUILTIN_PALETTES) expect(screen.getByText(b.name)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Canvas palette'), { target: { value: palettes[1].id } })
    expect(onSelect).toHaveBeenCalledWith(palettes[1].id)
  })
})
