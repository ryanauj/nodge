/**
 * Node quick-style templates panel (spec §8.3 — quick styling a node).
 *
 * Shows the curated {@link NODE_STYLE_TEMPLATES} as a grid of preview swatches,
 * grouped by {@link NODE_TEMPLATE_GROUPS}. Clicking a swatch writes that
 * template's **complete** style snapshot onto the selected node in one undoable
 * `updateNode({ style })` command — the fast path for reskinning a node while
 * sketching, without opening every control in {@link NodeStylePanel}. It is
 * purely visual (no entity/prototype is created), and non-destructive to the
 * cascade model: the snapshot simply replaces the node's pinned style keys.
 *
 * Each swatch is a live preview — it paints itself with the template's surface,
 * content, border and shape so the look is legible before it is applied. Every
 * swatch is a real ≥44px `<button>` with an `aria-label` (spec §10.2).
 */

import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Uuid } from '../../gateway'
import type { StyleDelta } from '../../model'
import { shapeRadius } from '../tokens'
import {
  NODE_STYLE_TEMPLATES,
  NODE_TEMPLATE_GROUPS,
  type NodeStyleTemplate,
} from '../nodeTemplates'

export interface NodeTemplatesPanelProps {
  /** The node the chosen template is applied to. */
  nodeId: Uuid
  /** Called after the style is written so the canvas/queries refresh. */
  onChanged: () => void
}

/** Border-radius (px) for a swatch preview; ellipse/pill read as fully round. */
function previewRadius(template: NodeStyleTemplate): number {
  if (template.style.shape === 'ellipse' || template.style.shape === 'pill') return 999
  return shapeRadius(template.style.shape)
}

export function NodeTemplatesPanel({ nodeId, onChanged }: NodeTemplatesPanelProps) {
  const getGateway = useGateway()
  const queryClient = useQueryClient()

  // Group the flat template list once for the section-per-group layout.
  const byGroup = useMemo(
    () =>
      NODE_TEMPLATE_GROUPS.map((group) => ({
        group,
        templates: NODE_STYLE_TEMPLATES.filter((t) => t.group === group),
      })),
    [],
  )

  const apply = useMutation({
    mutationFn: async (template: NodeStyleTemplate) =>
      (await getGateway()).updateNode(nodeId, { style: { ...template.style } as StyleDelta }),
    onSuccess: async () => {
      // Refresh the node-style panel's own read of the pin state, then the canvas.
      await queryClient.invalidateQueries({ queryKey: ['node-style', nodeId] })
      onChanged()
    },
  })

  return (
    <section className="panel" aria-label="Node templates">
      <h2 className="panel-title">Quick styles</h2>
      <p className="panel-meta">Apply a ready-made look to the selected node.</p>
      {byGroup.map(({ group, templates }) => (
        <div key={group} className="template-group">
          <h3 className="panel-subtitle">{group}</h3>
          <ul className="template-grid" aria-label={`${group} templates`}>
            {templates.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  className="template-swatch"
                  aria-label={`Apply ${template.name} style`}
                  title={template.description}
                  disabled={apply.isPending}
                  onClick={() => apply.mutate(template)}
                  style={{
                    backgroundColor: template.style.surface,
                    color: template.style.content,
                    border: `${template.style.borderWidth}px ${template.style.borderStyle} ${template.style.border}`,
                    borderRadius: previewRadius(template),
                  }}
                >
                  {template.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
