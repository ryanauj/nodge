/**
 * NodeTemplatesPanel component test (spec §8.3). Real in-memory gateway. Proves
 * the panel lists the quick-style templates and that clicking one writes that
 * template's full style snapshot onto the node in a single command.
 */

import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithGateway } from './panelTestUtils'
import { NodeTemplatesPanel } from './NodeTemplatesPanel'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'
import { NODE_STYLE_TEMPLATES } from '../nodeTemplates'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const diagram = await gw.createDiagram(graph.id, { name: 'B' })
  const layout = await gw.createLayout(diagram.id, { name: 'V' })
  const added = await gw.addNode(diagram.id, layout.id, { name: 'N', x: 0, y: 0 })
  return { graphId: graph.id, diagramId: diagram.id, nodeId: added.node.id }
}

describe('NodeTemplatesPanel — quick styling (§8.3)', () => {
  it('renders every template as an apply button', async () => {
    const gw = await createMemoryGateway()
    const { nodeId } = await seed(gw)
    renderWithGateway(<NodeTemplatesPanel nodeId={nodeId} onChanged={() => {}} />, gw)

    for (const t of NODE_STYLE_TEMPLATES) {
      expect(screen.getByLabelText(`Apply ${t.name} style`)).toBeInTheDocument()
    }
  })

  it('applying a template writes its full style snapshot onto the node', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, nodeId } = await seed(gw)
    const onChanged = vi.fn()
    renderWithGateway(<NodeTemplatesPanel nodeId={nodeId} onChanged={onChanged} />, gw)

    const template = NODE_STYLE_TEMPLATES.find((t) => t.id === 'neubrutalist')!
    fireEvent.click(screen.getByLabelText(`Apply ${template.name} style`))

    await waitFor(async () => {
      const detail = await gw.getDiagram(diagramId)
      const node = detail.nodes.find((n) => n.id === nodeId)!
      expect(node.style).toEqual(template.style)
    })
    expect(onChanged).toHaveBeenCalled()
    // The style is scoped to the node, not the graph's palettes.
    expect((await gw.getGraph(graphId)).palettes).toEqual([])
  })
})
