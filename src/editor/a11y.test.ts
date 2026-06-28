/**
 * Accessibility guards (spec §10.4). Two anti-regressions over the chrome CSS:
 *
 *  1. **Reduced motion disables animation.** Every animated treatment we add
 *     (the bottom-sheet slide-up and the engine CRT flicker) lives inside a
 *     `@media (prefers-reduced-motion: no-preference)` block, so a user who
 *     prefers reduced motion gets a static UI. We assert no `animation:` rule
 *     leaks outside such a block.
 *  2. **Focus-visible rings come from the palette's `border.focus`.** The
 *     focus-visible rule sources its color from `--nodge-border-focus`, the CSS
 *     variable the PaletteRoot projects from the palette's `border.focus` token.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'editor.css'),
  'utf8',
)

/** Strip the bodies of every `@media (prefers-reduced-motion: no-preference)`
 *  block so what remains is the "always applied" CSS. */
function withoutReducedMotionGuardedBlocks(source: string): string {
  let out = ''
  const marker = '@media (prefers-reduced-motion: no-preference)'
  let i = 0
  while (i < source.length) {
    const at = source.indexOf(marker, i)
    if (at === -1) {
      out += source.slice(i)
      break
    }
    out += source.slice(i, at)
    // Skip to the matching closing brace of the @media block.
    const open = source.indexOf('{', at)
    let depth = 0
    let j = open
    for (; j < source.length; j++) {
      if (source[j] === '{') depth++
      else if (source[j] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    i = j + 1
  }
  return out
}

describe('reduced-motion respects (spec §10.4)', () => {
  it('no animation: rule is applied outside a prefers-reduced-motion guard', () => {
    const unguarded = withoutReducedMotionGuardedBlocks(css)
    // `animation-name`/`animation:` shorthands must not appear unguarded.
    expect(unguarded).not.toMatch(/\banimation\s*:/)
  })

  it('the bottom-sheet slide-up animation IS present (but only behind the guard)', () => {
    // Sanity: the animation exists in the file (it is gated, asserted above).
    expect(css).toMatch(/nodge-sheet-up/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/)
  })
})

describe('focus-visible rings from the palette (spec §10.4)', () => {
  it('focus-visible rules source their outline color from --nodge-border-focus', () => {
    expect(css).toMatch(/:focus-visible\s*[,{]/)
    expect(css).toMatch(/outline:[^;]*var\(--nodge-border-focus/)
  })
})
