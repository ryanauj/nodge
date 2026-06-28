/**
 * PaletteRoot — the CSS-variable application boundary (spec §8.1, §8.4).
 *
 * Wraps a subtree and projects a palette's tokens onto it as `--nodge-*` CSS
 * custom properties (via {@link tokensToCssVars}), plus a `data-nodge-effect`
 * attribute carrying the engine-level effect so curated effects (sketch/glass/
 * pixel/crt) apply at the boundary. Two independent boundaries use it: the app
 * chrome (top-level in `App.tsx`) and each view's canvas (per-view palette).
 *
 * Effects are CSS-only and respect `prefers-reduced-motion` (the animated ones
 * fall back to a static treatment) so the minimal reduced-motion handling the
 * spec asks for in this phase is honored without a full accessibility pass.
 */

import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { PaletteTokens } from '../model'
import { fullTokens, tokensToCssVars } from './tokens'

export interface PaletteRootProps {
  tokens: PaletteTokens
  children: ReactNode
  className?: string
  /** Optional override of the wrapping element's style. */
  style?: CSSProperties
  /** ARIA/test handle so callers can target a specific boundary. */
  testId?: string
}

export function PaletteRoot({ tokens, children, className, style, testId }: PaletteRootProps) {
  const full = useMemo(() => fullTokens(tokens), [tokens])
  const vars = useMemo(() => tokensToCssVars(full), [full])

  return (
    <div
      className={className ? `nodge-palette-root ${className}` : 'nodge-palette-root'}
      data-nodge-effect={full.effect}
      data-testid={testId}
      style={{ ...(vars as CSSProperties), ...style }}
    >
      {children}
    </div>
  )
}
