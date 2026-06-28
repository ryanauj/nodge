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
  const board = await gw.createBoard(graph.id, { name: 'B' })
  const view = await gw.createView(board.id, { name: 'V' })
  const added = await gw.addNode(board.id, view.id, { name: 'N', x: 0, y: 0 })
  return { gw, graphId: graph.id, nodeId: added.node.id }
}

const RESOLVED: ResolvedNodeStyle = { ...DEFAULT_NODE_TOKENS, surface: '#ffffff' }

describe('NodeStylePanel — link/unlink (token vs pinned) (§8.3)', () => {
  it('pinning a control writes the resolved value into the node styleOverride', async () => {
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
      const detail = await gw.getBoard((await gw.getGraph(graphId)).boards[0].id)
      const n = detail.nodes.find((x) => x.id === nodeId)!
      expect(n.styleOverride).toMatchObject({ surface: '#ffffff' })
    })

    // The control is now enabled (pinned) and the toggle reads "Unlink".
    await waitFor(() => expect(screen.getByLabelText('Unlink surface')).toBeInTheDocument())
    expect(renders.length).toBeGreaterThan(0)
  })

  it('unlinking removes the key so the control follows the palette again', async () => {
    const gw = await createMemoryGateway()
    const { nodeId } = await seed(gw)
    await gw.updateNode(nodeId, { styleOverride: { surface: '#abcdef' } })

    renderWithGateway(
      <NodeStylePanel nodeId={nodeId} resolved={RESOLVED} onChanged={() => {}} />,
      gw,
    )

    // The surface control starts pinned (the override has the key).
    await waitFor(() => expect(screen.getByLabelText('Unlink surface')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Unlink surface'))

    await waitFor(async () => {
      const graphId = (await gw.listGraphs())[0].id
      const detail = await gw.getBoard((await gw.getGraph(graphId)).boards[0].id)
      const n = detail.nodes.find((x) => x.id === nodeId)!
      expect(Object.prototype.hasOwnProperty.call(n.styleOverride, 'surface')).toBe(false)
    })
  })

  it('applying a style profile sets styleProfileId on the node (§8.3)', async () => {
    const gw = await createMemoryGateway()
    const { graphId, nodeId } = await seed(gw)
    const profile = await gw.createStyleProfile(graphId, {
      name: 'Brand',
      target: 'node',
      style: { surface: '#ff00aa' },
    })

    renderWithGateway(
      <NodeStylePanel nodeId={nodeId} resolved={RESOLVED} graphId={graphId} onChanged={() => {}} />,
      gw,
    )

    // The "apply profile" selector lists the graph's profiles; choosing one
    // writes styleProfileId through updateNode (one undoable command).
    const select = await screen.findByLabelText('Apply style profile')
    fireEvent.change(select, { target: { value: profile.id } })
    await waitFor(async () => {
      const detail = await gw.getBoard((await gw.getGraph(graphId)).boards[0].id)
      expect(detail.nodes.find((x) => x.id === nodeId)!.styleProfileId).toBe(profile.id)
    })

    // Clearing it back to "(none)" removes the reference.
    fireEvent.change(screen.getByLabelText('Apply style profile'), { target: { value: '' } })
    await waitFor(async () => {
      const detail = await gw.getBoard((await gw.getGraph(graphId)).boards[0].id)
      expect(detail.nodes.find((x) => x.id === nodeId)!.styleProfileId).toBeNull()
    })
  })
})
