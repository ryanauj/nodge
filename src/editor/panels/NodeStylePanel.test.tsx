import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithGateway } from './panelTestUtils'
import { NodeStylePanel } from './NodeStylePanel'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'
import { DEFAULT_NODE_TOKENS } from '../tokens'
import type { ResolvedNodeStyle } from '../style'

async function seed(gw: LocalGateway, opts: { withPrototype?: boolean } = {}) {
  const graph = await gw.createGraph({ name: 'G' })
  const diagram = await gw.createDiagram(graph.id, { name: 'B' })
  const layout = await gw.createLayout(diagram.id, { name: 'V' })
  const proto = opts.withPrototype
    ? await gw.createPrototype(graph.id, { kind: 'node', name: 'P' })
    : null
  const added = await gw.addNode(diagram.id, layout.id, {
    name: 'N',
    x: 0,
    y: 0,
    nodePrototypeId: proto?.id ?? null,
  })
  return { gw, graphId: graph.id, nodeId: added.node.id, prototypeId: proto?.id ?? null }
}

const RESOLVED: ResolvedNodeStyle = { ...DEFAULT_NODE_TOKENS, surface: '#ffffff' }

describe('NodeStylePanel — link/unlink (token vs pinned) (§8.3)', () => {
  it('pinning a control writes the resolved value into the node style', async () => {
    const gw = await createMemoryGateway()
    const { nodeId } = await seed(gw)
    const renders: number[] = []
    renderWithGateway(
      <NodeStylePanel nodeId={nodeId} resolved={RESOLVED} onChanged={() => renders.push(1)} />,
      gw,
    )

    // Initially the surface control follows the palette (disabled, not pinned).
    const surfaceInput = await screen.findByLabelText('surface value')
    expect(surfaceInput).toBeDisabled()

    // Pin surface → updateNode persists the resolved surface as a raw literal.
    fireEvent.click(screen.getByLabelText('Pin surface'))
    await waitFor(async () => {
      const graphId = (await gw.listGraphs())[0].id
      const detail = await gw.getDiagram((await gw.getGraph(graphId)).diagrams[0].id)
      const n = detail.nodes.find((x) => x.id === nodeId)!
      expect(n.style).toMatchObject({ surface: '#ffffff' })
    })

    // The control is now enabled (pinned) and the toggle reads "Unlink".
    await waitFor(() => expect(screen.getByLabelText('Unlink surface')).toBeInTheDocument())
    expect(renders.length).toBeGreaterThan(0)
  })

  it('unlinking removes the key so the control follows the palette again', async () => {
    const gw = await createMemoryGateway()
    const { nodeId } = await seed(gw)
    await gw.updateNode(nodeId, { style: { surface: '#abcdef' } })

    renderWithGateway(
      <NodeStylePanel nodeId={nodeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )

    // The surface control starts pinned (the override has the key).
    await waitFor(() => expect(screen.getByLabelText('Unlink surface')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Unlink surface'))

    await waitFor(async () => {
      const graphId = (await gw.listGraphs())[0].id
      const detail = await gw.getDiagram((await gw.getGraph(graphId)).diagrams[0].id)
      const n = detail.nodes.find((x) => x.id === nodeId)!
      expect(Object.prototype.hasOwnProperty.call(n.style, 'surface')).toBe(false)
    })
  })
})

describe('NodeStylePanel — row read (no diagram scan) + refresh from prototype (§10/D4)', () => {
  it('reads the node by id and never scans graphs/diagrams', async () => {
    const gw = await createMemoryGateway()
    const { nodeId } = await seed(gw)
    const getNodeSpy = vi.spyOn(gw, 'getNode')
    const listGraphsSpy = vi.spyOn(gw, 'listGraphs')
    const getGraphSpy = vi.spyOn(gw, 'getGraph')
    const getDiagramSpy = vi.spyOn(gw, 'getDiagram')

    renderWithGateway(
      <NodeStylePanel nodeId={nodeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )
    await screen.findByLabelText('surface value')

    expect(getNodeSpy).toHaveBeenCalledWith(nodeId)
    // The O(graphs×diagrams) scan is gone.
    expect(listGraphsSpy).not.toHaveBeenCalled()
    expect(getGraphSpy).not.toHaveBeenCalled()
    expect(getDiagramSpy).not.toHaveBeenCalled()
  })

  it('"Refresh from prototype" is disabled when the entity links no prototype', async () => {
    const gw = await createMemoryGateway()
    const { nodeId } = await seed(gw) // no prototype
    renderWithGateway(
      <NodeStylePanel nodeId={nodeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )
    const btn = await screen.findByLabelText('Refresh node style from prototype')
    expect(btn).toBeDisabled()
  })

  it('"Refresh from prototype" calls refreshFromPrototype with the linked prototype + node id', async () => {
    const gw = await createMemoryGateway()
    const { nodeId, prototypeId } = await seed(gw, { withPrototype: true })
    const spy = vi.spyOn(gw, 'refreshFromPrototype')
    renderWithGateway(
      <NodeStylePanel nodeId={nodeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )
    const btn = await screen.findByLabelText('Refresh node style from prototype')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ prototypeId, ids: [nodeId] })
    })
  })
})
