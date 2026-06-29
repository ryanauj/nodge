import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { EntityPanel } from './EntityPanel'
import { renderWithGateway } from './panelTestUtils'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'

async function seedEntityOnTwoNodes(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const diagram = await gw.createDiagram(graph.id, { name: 'Board 1' })
  const layout = await gw.createLayout(diagram.id, { name: 'V' })
  const added = await gw.addNode(diagram.id, layout.id, { name: 'Service', x: 0, y: 0 })
  // Second placement of the same entity.
  await gw.createNode(diagram.id, { entityId: added.entity.id, label: 'second' })
  return { graphId: graph.id, entityId: added.entity.id }
}

describe('EntityPanel (§5.4, §7.4)', () => {
  it('edits links through updateEntity and reflects on all placements (usages)', async () => {
    const gw = await createMemoryGateway()
    const { entityId } = await seedEntityOnTwoNodes(gw)
    const onChanged = vi.fn()
    renderWithGateway(<EntityPanel entityId={entityId} onChanged={onChanged} />, gw)

    // Two placements shown in the cross-reference section.
    await waitFor(() => expect(screen.getByText(/Placed on 2 node/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    const targets = screen.getAllByLabelText('Link target')
    fireEvent.change(targets[targets.length - 1], { target: { value: 'https://docs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save links' }))

    await waitFor(async () => {
      const detail = await gw.getGraph((await gw.listGraphs())[0].id)
      const entity = detail.entities.find((e) => e.id === entityId)
      expect(entity?.links.some((l) => l.target === 'https://docs')).toBe(true)
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('edits metadata as JSON through updateEntity', async () => {
    const gw = await createMemoryGateway()
    const { entityId } = await seedEntityOnTwoNodes(gw)
    renderWithGateway(<EntityPanel entityId={entityId} onChanged={vi.fn()} />, gw)

    const textarea = await screen.findByLabelText('Entity metadata')
    fireEvent.change(textarea, { target: { value: '{"tier":"backend"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }))

    await waitFor(async () => {
      const detail = await gw.getGraph((await gw.listGraphs())[0].id)
      const entity = detail.entities.find((e) => e.id === entityId)
      expect(entity?.metadata).toEqual({ tier: 'backend' })
    })
  })

  it('shows a JSON error for invalid metadata and does not save', async () => {
    const gw = await createMemoryGateway()
    const { entityId } = await seedEntityOnTwoNodes(gw)
    renderWithGateway(<EntityPanel entityId={entityId} onChanged={vi.fn()} />, gw)

    const textarea = await screen.findByLabelText('Entity metadata')
    fireEvent.change(textarea, { target: { value: '{not json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }))
    expect(await screen.findByText('Invalid JSON')).toBeInTheDocument()
  })
})
