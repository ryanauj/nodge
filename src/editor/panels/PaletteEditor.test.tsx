import { describe, it, expect } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithGateway } from './panelTestUtils'
import { PaletteEditor } from './PaletteEditor'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'
import { DEFAULT_PALETTE_TOKENS } from '../style'
import { fullTokens } from '../tokens'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  await gw.createPalette(graph.id, { name: 'Default', tokens: DEFAULT_PALETTE_TOKENS, builtin: true })
  return graph.id
}

describe('PaletteEditor — token-level authoring (§8.4)', () => {
  it('duplicates a palette, edits a token and saves through updatePalette', async () => {
    const gw = await createMemoryGateway()
    const graphId = await seed(gw)
    renderWithGateway(<PaletteEditor graphId={graphId} />, gw)

    // Wait for the seeded palette to load, then duplicate it.
    await waitFor(() => expect(screen.getByLabelText('Edit palette')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))

    // The new (forked) palette is selected; edit the node surface color.
    await waitFor(() => expect(screen.getAllByLabelText('Edit palette')[0]).toBeInTheDocument())
    const surface = await screen.findByLabelText('Surface')
    fireEvent.change(surface, { target: { value: '#ff00aa' } })
    fireEvent.click(screen.getByLabelText('Save palette'))

    await waitFor(async () => {
      const palettes = await gw.listPalettes(graphId)
      const fork = palettes.find((p) => !p.builtin)
      expect(fork).toBeDefined()
      expect(fullTokens(fork!.tokens).node.surface).toBe('#ff00aa')
    })
  })

  it('warns when the edited palette has a low-contrast pair', async () => {
    const gw = await createMemoryGateway()
    const graphId = await seed(gw)
    renderWithGateway(<PaletteEditor graphId={graphId} />, gw)

    await waitFor(() => expect(screen.getByLabelText('Surface')).toBeInTheDocument())
    // Make content nearly the same as surface → low contrast.
    fireEvent.change(screen.getByLabelText('Surface'), { target: { value: '#ffffff' } })
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: '#fefefe' } })

    await waitFor(() =>
      expect(screen.getByLabelText('Palette warnings')).toHaveTextContent(/Low contrast/),
    )
  })

  it('creates a new palette', async () => {
    const gw = await createMemoryGateway()
    const graphId = await seed(gw)
    renderWithGateway(<PaletteEditor graphId={graphId} />, gw)

    await waitFor(() => expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    await waitFor(async () => {
      const palettes = await gw.listPalettes(graphId)
      expect(palettes.some((p) => p.name === 'New palette')).toBe(true)
    })
  })
})
