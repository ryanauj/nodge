import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PrototypePanel } from './PrototypePanel'
import { renderWithGateway } from './panelTestUtils'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const diagram = await gw.createDiagram(graph.id, { name: 'D' })
  await gw.createLayout(diagram.id, { name: 'L' })
  await gw.createPrototype(graph.id, { kind: 'node', name: 'Service' })
  await gw.createPrototype(graph.id, { kind: 'edge', name: 'Calls' })
  return { graphId: graph.id, diagramId: diagram.id }
}

function renderPanel(
  gw: LocalGateway,
  graphId: string,
  diagramId: string,
  overrides: Partial<{
    selectedNodeId: string | null
    selectedEdgeId: string | null
    onStampPrototype: (p: unknown) => void
    onChanged: () => void
  }> = {},
) {
  return renderWithGateway(
    <PrototypePanel
      graphId={graphId}
      diagramId={diagramId}
      selectedNodeId={overrides.selectedNodeId ?? null}
      selectedEdgeId={overrides.selectedEdgeId ?? null}
      onStampPrototype={overrides.onStampPrototype ?? vi.fn()}
      onChanged={overrides.onChanged ?? vi.fn()}
    />,
    gw,
  )
}

describe('PrototypePanel — two libraries (§10 / D4)', () => {
  it('renders node and edge prototypes in separate libraries, filtered by kind', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    renderPanel(gw, graphId, diagramId)

    // The Node library is active by default: Service shows, Calls (edge) does not.
    expect(await screen.findByText('Service')).toBeInTheDocument()
    expect(screen.queryByText('Calls')).not.toBeInTheDocument()

    // Switch to the Edge library: Calls shows, Service does not.
    fireEvent.click(screen.getByRole('tab', { name: 'Edge prototypes' }))
    expect(await screen.findByText('Calls')).toBeInTheDocument()
    expect(screen.queryByText('Service')).not.toBeInTheDocument()
  })

  it('the tablist supports the full keyboard pattern (Arrow/Home/End switch + move focus)', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    renderPanel(gw, graphId, diagramId)

    const nodeTab = await screen.findByRole('tab', { name: 'Node prototypes' })
    const edgeTab = screen.getByRole('tab', { name: 'Edge prototypes' })

    nodeTab.focus()
    expect(nodeTab).toHaveFocus()
    expect(nodeTab).toHaveAttribute('aria-selected', 'true')

    // ArrowRight selects + focuses the edge library.
    fireEvent.keyDown(nodeTab, { key: 'ArrowRight' })
    expect(edgeTab).toHaveFocus()
    expect(edgeTab).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Calls')).toBeInTheDocument()

    // Home returns to the first (node) library, focus and selection together.
    fireEvent.keyDown(edgeTab, { key: 'Home' })
    expect(nodeTab).toHaveFocus()
    expect(await screen.findByText('Service')).toBeInTheDocument()

    // End jumps to the last (edge) library.
    fireEvent.keyDown(nodeTab, { key: 'End' })
    expect(edgeTab).toHaveFocus()

    // Roving tabindex: only the selected tab is in the Tab order.
    expect(edgeTab).toHaveAttribute('tabindex', '0')
    expect(nodeTab).toHaveAttribute('tabindex', '-1')
  })

  it('filters within the active library by search', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    await gw.createPrototype(graphId, { kind: 'node', name: 'Database' })
    renderPanel(gw, graphId, diagramId)

    expect(await screen.findByText('Service')).toBeInTheDocument()
    expect(screen.getByText('Database')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search prototypes'), { target: { value: 'serv' } })
    expect(screen.getByText('Service')).toBeInTheDocument()
    expect(screen.queryByText('Database')).not.toBeInTheDocument()
  })

  it('duplicates a prototype through the gateway', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    const onChanged = vi.fn()
    renderPanel(gw, graphId, diagramId, { onChanged })
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Service' }))
    await waitFor(async () => {
      const protos = await gw.listPrototypes(graphId)
      expect(protos.filter((p) => p.name.includes('Service'))).toHaveLength(2)
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('stamps a node prototype via the onStampPrototype callback', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    const onStamp = vi.fn()
    renderPanel(gw, graphId, diagramId, { onStampPrototype: onStamp })
    fireEvent.click(await screen.findByRole('button', { name: 'Create from Service' }))
    expect(onStamp).toHaveBeenCalledWith(expect.objectContaining({ name: 'Service' }))
  })

  it('"Refresh all" calls the gateway scoped to the active diagram, per library', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    const spy = vi.spyOn(gw, 'refreshFromPrototype')
    const service = (await gw.listPrototypes(graphId)).find((p) => p.name === 'Service')!
    const calls = (await gw.listPrototypes(graphId)).find((p) => p.name === 'Calls')!
    renderPanel(gw, graphId, diagramId)

    // Node library refresh.
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh all of Service' }))
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ prototypeId: service.id, all: true, diagramId })
    })

    // Edge library refresh.
    fireEvent.click(screen.getByRole('tab', { name: 'Edge prototypes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh all of Calls' }))
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ prototypeId: calls.id, all: true, diagramId })
    })
  })

  it('saves a selected node as a prototype', async () => {
    const gw = await createMemoryGateway()
    const graph = await gw.createGraph({ name: 'G' })
    const diagram = await gw.createDiagram(graph.id, { name: 'B' })
    const layout = await gw.createLayout(diagram.id, { name: 'V' })
    const added = await gw.addNode(diagram.id, layout.id, { name: 'My Node', x: 0, y: 0 })

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Saved Proto')
    renderPanel(gw, graph.id, diagram.id, { selectedNodeId: added.node.id })
    fireEvent.click(await screen.findByRole('button', { name: 'Save node as prototype' }))
    await waitFor(async () => {
      const protos = await gw.listPrototypes(graph.id)
      expect(protos.some((p) => p.name === 'Saved Proto')).toBe(true)
    })
    promptSpy.mockRestore()
  })

  it('the active library list is labelled by kind', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    renderPanel(gw, graphId, diagramId)
    await screen.findByText('Service')
    const nodeList = screen.getByRole('list', { name: 'Node prototypes' })
    expect(within(nodeList).getByText('Service')).toBeInTheDocument()
  })
})
