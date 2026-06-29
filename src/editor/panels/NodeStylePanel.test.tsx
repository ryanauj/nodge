import { describe, it, expect } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithGateway } from './panelTestUtils'
import { NodeStylePanel } from './NodeStylePanel'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'
import { DEFAULT_NODE_TOKENS } from '../tokens'
import type { ResolvedNodeStyle } from '../style'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const diagram = await gw.createDiagram(graph.id, { name: 'B' })
  const layout = await gw.createLayout(diagram.id, { name: 'V' })
  const added = await gw.addNode(diagram.id, layout.id, { name: 'N', x: 0, y: 0 })
  return { gw, graphId: graph.id, nodeId: added.node.id }
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
