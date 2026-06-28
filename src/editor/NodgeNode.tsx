/**
 * The canvas node renderer. Applies the resolved (cascaded) style and exposes
 * finger-friendly source/target handles so nodes can be connected by dragging.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { shapeRadius, type ResolvedNodeStyle } from './style'

const HANDLE_STYLE = { width: 12, height: 12 } as const

export function NodgeNode({ data }: NodeProps) {
  const { label, style } = data as { label: string; style: ResolvedNodeStyle }
  return (
    <div
      className="nodge-node"
      style={{
        background: style.surface,
        color: style.content,
        border: `${style.borderWidth}px solid ${style.border}`,
        borderRadius: shapeRadius(style.shape),
        padding: '8px 14px',
        minWidth: 80,
        textAlign: 'center',
        fontSize: 13,
      }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <span>{label}</span>
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  )
}

export const nodeTypes = { nodge: NodgeNode }
