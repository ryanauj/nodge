import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PrototypePanel } from './PrototypePanel'
import { renderWithGateway } from './panelTestUtils'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  await gw.createPrototype(graph.id, { kind: 'node', name: 'Service' })
  await gw.createPrototype(graph.id, { kind: 'relationship', name: 'Calls' })
  return graph.id
}

describe('PrototypePanel (§9.1)', () => {
  it('lists prototypes and filters by search', async () => {
    const gw = await createMemoryGateway()
    const graphId = await seed(gw)
    renderWithGateway(
      <PrototypePanel
        graphId={graphId}
        selectedNodeId={null}
        selectedEdgeId={null}
        onStampPrototype={vi.fn()}
        onChanged={vi.fn()}
      />,
      gw,
    )
    expect(await screen.findByText(/Service/)).toBeInTheDocument()
    expect(screen.getByText(/Calls/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search prototypes'), { target: { value: 'serv' } })
    expect(screen.queryByText(/Calls/)).not.toBeInTheDocument()
  })

  it('duplicates a prototype through the gateway', async () => {
    const gw = await createMemoryGateway()
    const graphId = await seed(gw)
    const onChanged = vi.fn()
    renderWithGateway(
      <PrototypePanel
        graphId={graphId}
        selectedNodeId={null}
        selectedEdgeId={null}
        onStampPrototype={vi.fn()}
        onChanged={onChanged}
      />,
      gw,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Service' }))
    await waitFor(async () => {
      const protos = await gw.listPrototypes(graphId)
      expect(protos.filter((p) => p.name.includes('Service'))).toHaveLength(2)
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('stamps a node prototype via the onStampPrototype callback', async () => {
    const gw = await createMemoryGateway()
    const graphId = await seed(gw)
    const onStamp = vi.fn()
    renderWithGateway(
      <PrototypePanel
        graphId={graphId}
        selectedNodeId={null}
        selectedEdgeId={null}
        onStampPrototype={onStamp}
        onChanged={vi.fn()}
      />,
      gw,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Create from Service' }))
    expect(onStamp).toHaveBeenCalledWith(expect.objectContaining({ name: 'Service' }))
  })

  it('saves a selected node as a prototype', async () => {
    const gw = await createMemoryGateway()
    const graph = await gw.createGraph({ name: 'G' })
    const board = await gw.createBoard(graph.id, { name: 'B' })
    const view = await gw.createView(board.id, { name: 'V' })
    const added = await gw.addNode(board.id, view.id, { name: 'My Node', x: 0, y: 0 })

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Saved Proto')
    renderWithGateway(
      <PrototypePanel
        graphId={graph.id}
        selectedNodeId={added.node.id}
        selectedEdgeId={null}
        onStampPrototype={vi.fn()}
        onChanged={vi.fn()}
      />,
      gw,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Save node as prototype' }))
    await waitFor(async () => {
      const protos = await gw.listPrototypes(graph.id)
      expect(protos.some((p) => p.name === 'Saved Proto')).toBe(true)
    })
    promptSpy.mockRestore()
  })
})
