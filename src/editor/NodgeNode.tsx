/**
 * The canvas node renderer. Applies the resolved (cascaded) style — surface,
 * content, border (color + width + style), shape (incl. diamond), background
 * pattern and elevation shadow (spec §8.2) — and exposes finger-friendly
 * source/target handles so nodes can be connected by dragging.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  elevationShadow,
  patternBackground,
  shapeRadius,
  type ResolvedNodeStyle,
} from './style'
import { DEFAULT_ELEVATION } from './tokens'

const HANDLE_STYLE = { width: 12, height: 12 } as const

export function NodgeNode({ data }: NodeProps) {
  const { label, style } = data as { label: string; style: ResolvedNodeStyle }
  const isDiamond = style.shape === 'diamond'
  const isEllipse = style.shape === 'ellipse'
  const pattern = patternBackground(style.pattern, style.border)
  const shadow = elevationShadow(DEFAULT_ELEVATION, style.elevation)

  return (
    <div
      className="nodge-node"
      data-shape={style.shape}
      data-pattern={style.pattern}
      data-elevation={style.elevation}
      style={{
        backgroundColor: style.surface,
        backgroundImage: pattern,
        backgroundSize: style.pattern === 'dots' || style.pattern === 'grid' ? '8px 8px' : undefined,
        color: style.content,
        border: `${style.borderWidth}px ${style.borderStyle} ${style.border}`,
        borderRadius: isEllipse ? '50%' : shapeRadius(style.shape),
        boxShadow: shadow === 'none' ? undefined : shadow,
        transform: isDiamond ? 'rotate(45deg)' : undefined,
        padding: '8px 14px',
        minWidth: 80,
        textAlign: 'center',
        fontSize: 13,
      }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      {/* Counter-rotate the label so a diamond's text stays upright. */}
      <span style={isDiamond ? { display: 'inline-block', transform: 'rotate(-45deg)' } : undefined}>
        {label}
      </span>
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  )
}
