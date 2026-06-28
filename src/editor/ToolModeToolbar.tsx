/**
 * ToolModeToolbar — the thumb-reach bottom toolbar (spec §10.1, §10.2).
 *
 * A segmented Select / Connect / Add control (the lightweight tool modes) plus
 * tabs that open the responsive bottom sheets on narrow viewports. It is an ARIA
 * toolbar; the mode buttons are a `radiogroup`-style pressed set (`aria-pressed`)
 * and the sheet tabs reflect the open sheet with `aria-expanded`. All state is
 * client UI state (the Zustand tool-mode store) — never a gateway mutation.
 */

import {
  SHEET_KEYS,
  SHEET_LABELS,
  TOOL_MODES,
  TOOL_MODE_LABELS,
  useToolMode,
  type SheetKey,
} from './toolMode'

/** Which sheet tabs to show (the canvas only enables those it can populate). */
export interface ToolModeToolbarProps {
  /** Sheet keys whose backing panel currently has content (e.g. properties only
   *  when something is selected). Tabs for absent keys are disabled. */
  availableSheets: readonly SheetKey[]
}

export function ToolModeToolbar({ availableSheets }: ToolModeToolbarProps) {
  const mode = useToolMode((s) => s.mode)
  const sheet = useToolMode((s) => s.sheet)
  const setMode = useToolMode((s) => s.setMode)
  const toggleSheet = useToolMode((s) => s.toggleSheet)
  const available = new Set(availableSheets)

  return (
    <div className="tool-toolbar" role="toolbar" aria-label="Tool modes">
      <div role="group" aria-label="Tool mode" style={{ display: 'flex', gap: 4 }}>
        {TOOL_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            aria-label={`${TOOL_MODE_LABELS[m]} mode`}
            onClick={() => setMode(m)}
          >
            {TOOL_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <div className="tool-sheet-tabs" role="group" aria-label="Panels">
        {SHEET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-expanded={sheet === key}
            aria-label={`${SHEET_LABELS[key]} panel`}
            disabled={!available.has(key)}
            onClick={() => toggleSheet(key)}
          >
            {SHEET_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  )
}
