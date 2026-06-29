import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithGateway } from './panelTestUtils'
import { EdgeStylePanel } from './EdgeStylePanel'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'
import { DEFAULT_EDGE_TOKENS } from '../tokens'
import type { ResolvedEdgeStyle } from '../style'

/** Seed a graph with two connected nodes and return the edge placement id. */
async function seed(gw: LocalGateway, opts: { withPrototype?: boolean } = {}) {
  const graph = await gw.createGraph({ name: 'G' })
  const diagram = await gw.createDiagram(graph.id, { name: 'B' })
  const layout = await gw.createLayout(diagram.id, { name: 'V' })
  const a = await gw.addNode(diagram.id, layout.id, { name: 'A', x: 0, y: 0 })
  const b = await gw.addNode(diagram.id, layout.id, { name: 'B', x: 100, y: 0 })
  const proto = opts.withPrototype
    ? await gw.createPrototype(graph.id, { kind: 'edge', name: 'P' })
    : null
  const { edge } = await gw.connectNodes(diagram.id, {
    sourceNodeId: a.node.id,
    targetNodeId: b.node.id,
    edgePrototypeId: proto?.id ?? null,
  })
  return { gw, edgeId: edge.id, prototypeId: proto?.id ?? null }
}

const RESOLVED: ResolvedEdgeStyle = { ...DEFAULT_EDGE_TOKENS, stroke: '#123456' }

describe('EdgeStylePanel — link/unlink (token vs pinned) (§8.3, §12 Phase 4)', () => {
  it('pinning a control writes the resolved value into the edge style', async () => {
    const gw = await createMemoryGateway()
    const { edgeId } = await seed(gw)
    const renders: number[] = []
    renderWithGateway(
      <EdgeStylePanel edgeId={edgeId} resolved={RESOLVED} onChanged={() => renders.push(1)} />,
      gw,
    )

    // Initially the stroke control follows the palette (disabled, not pinned).
    const strokeInput = await screen.findByLabelText('stroke value')
    expect(strokeInput).toBeDisabled()

    // Pin stroke → updateEdge persists the resolved stroke as a raw literal.
    fireEvent.click(screen.getByLabelText('Pin stroke'))
    await waitFor(async () => {
      const graphId = (await gw.listGraphs())[0].id
      const detail = await gw.getDiagram((await gw.getGraph(graphId)).diagrams[0].id)
      const e = detail.edges.find((x) => x.id === edgeId)!
      expect(e.style).toMatchObject({ stroke: '#123456' })
    })

    // The control is now enabled (pinned) and the toggle reads "Unlink".
    await waitFor(() => expect(screen.getByLabelText('Unlink stroke')).toBeInTheDocument())
    expect(renders.length).toBeGreaterThan(0)
  })

  it('unlinking removes the key so the control follows the palette again', async () => {
    const gw = await createMemoryGateway()
    const { edgeId } = await seed(gw)
    await gw.updateEdge(edgeId, { style: { stroke: '#abcdef' } })

    renderWithGateway(
      <EdgeStylePanel edgeId={edgeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )

    // The stroke control starts pinned (the override has the key).
    await waitFor(() => expect(screen.getByLabelText('Unlink stroke')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Unlink stroke'))

    await waitFor(async () => {
      const graphId = (await gw.listGraphs())[0].id
      const detail = await gw.getDiagram((await gw.getGraph(graphId)).diagrams[0].id)
      const e = detail.edges.find((x) => x.id === edgeId)!
      expect(Object.prototype.hasOwnProperty.call(e.style, 'stroke')).toBe(false)
    })
  })
})

describe('EdgeStylePanel — row read (no diagram scan) + refresh from prototype (§10/D4)', () => {
  it('reads the edge by id and never scans graphs/diagrams', async () => {
    const gw = await createMemoryGateway()
    const { edgeId } = await seed(gw)
    const getEdgeSpy = vi.spyOn(gw, 'getEdge')
    const listGraphsSpy = vi.spyOn(gw, 'listGraphs')
    const getGraphSpy = vi.spyOn(gw, 'getGraph')
    const getDiagramSpy = vi.spyOn(gw, 'getDiagram')

    renderWithGateway(
      <EdgeStylePanel edgeId={edgeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )
    await screen.findByLabelText('stroke value')

    expect(getEdgeSpy).toHaveBeenCalledWith(edgeId)
    expect(listGraphsSpy).not.toHaveBeenCalled()
    expect(getGraphSpy).not.toHaveBeenCalled()
    expect(getDiagramSpy).not.toHaveBeenCalled()
  })

  it('"Refresh from prototype" is disabled when the relationship links no prototype', async () => {
    const gw = await createMemoryGateway()
    const { edgeId } = await seed(gw) // no prototype
    renderWithGateway(
      <EdgeStylePanel edgeId={edgeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )
    const btn = await screen.findByLabelText('Refresh edge style from prototype')
    expect(btn).toBeDisabled()
  })

  it('"Refresh from prototype" calls refreshFromPrototype with the linked prototype + edge id', async () => {
    const gw = await createMemoryGateway()
    const { edgeId, prototypeId } = await seed(gw, { withPrototype: true })
    const spy = vi.spyOn(gw, 'refreshFromPrototype')
    renderWithGateway(
      <EdgeStylePanel edgeId={edgeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )
    const btn = await screen.findByLabelText('Refresh edge style from prototype')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ prototypeId, ids: [edgeId] })
    })
  })
})
