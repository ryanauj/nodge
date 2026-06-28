/**
 * Palette editor — token-level authoring (spec §8.4, §12 Phase 4).
 *
 * Lists the graph's palettes; lets the user duplicate one, create a new one,
 * rename it, edit a curated set of its tokens (surface/content/border colors,
 * geometry, node shape/border-style/pattern/elevation, and the whole-canvas
 * effect), save via `updatePalette`/`duplicatePalette`/`createPalette`, delete
 * it, and assign it (to a view and/or the app chrome via the parent's hooks).
 *
 * Edits run against the *full* resolved token set (so a legacy palette upgrades
 * its in-memory edit shape without losing its raw stored JSON until saved), and
 * the editor surfaces the palette validators (shape completeness + WCAG AA
 * contrast) so failing pairs are flagged before assignment (§8.2, §10.4).
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Palette } from '../../model'
import type { Uuid } from '../../gateway'
import {
  BACKGROUND_PATTERNS,
  BORDER_STYLES,
  EFFECTS,
  ELEVATIONS,
  NODE_SHAPES,
  fullTokens,
  toPaletteTokens,
  type FullPaletteTokens,
} from '../tokens'
import { validatePalette } from '../paletteValidation'

export interface PaletteEditorProps {
  graphId: Uuid
  /** Assign the edited/selected palette to the active view. */
  onAssignToView?: (paletteId: Uuid) => void
  /** Assign the edited/selected palette as the app-chrome theme. */
  onAssignToChrome?: (paletteId: Uuid) => void
  /** Called after any palette mutation so callers re-skin. */
  onChanged?: () => void
}

export function PaletteEditor({
  graphId,
  onAssignToView,
  onAssignToChrome,
  onChanged,
}: PaletteEditorProps) {
  const getGateway = useGateway()

  const palettes = useQuery({
    queryKey: ['palettes', graphId],
    queryFn: async () => (await getGateway()).listPalettes(graphId),
  })

  const [selectedId, setSelectedId] = useState<Uuid | null>(null)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<FullPaletteTokens | null>(null)

  // Resolve the selected palette into the editable full-token draft.
  const selected: Palette | undefined = useMemo(
    () => palettes.data?.find((p) => p.id === selectedId) ?? palettes.data?.[0],
    [palettes.data, selectedId],
  )
  useEffect(() => {
    if (selected) {
      setName(selected.name)
      setDraft(fullTokens(selected.tokens))
    }
  }, [selected])

  const refresh = async () => {
    await palettes.refetch()
    onChanged?.()
  }

  const create = useMutation({
    mutationFn: async () =>
      (await getGateway()).createPalette(graphId, {
        name: 'New palette',
        tokens: toPaletteTokens(fullTokens({})),
      }),
    onSuccess: async (p) => {
      setSelectedId(p.id)
      await refresh()
    },
  })

  const duplicate = useMutation({
    mutationFn: async (id: Uuid) => (await getGateway()).duplicatePalette(id),
    onSuccess: async (p) => {
      setSelectedId(p.id)
      await refresh()
    },
  })

  const saveEdits = useMutation({
    mutationFn: async () => {
      if (!selected || !draft) return
      return (await getGateway()).updatePalette(selected.id, {
        name,
        tokens: toPaletteTokens(draft),
      })
    },
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: async (id: Uuid) => (await getGateway()).deletePalette(id),
    onSuccess: async () => {
      setSelectedId(null)
      await refresh()
    },
  })

  const validation = useMemo(
    () => (draft ? validatePalette(toPaletteTokens(draft)) : null),
    [draft],
  )

  const patch = (fn: (d: FullPaletteTokens) => FullPaletteTokens) =>
    setDraft((d) => (d ? fn(d) : d))

  return (
    <section className="panel" aria-label="Palette editor">
      <h2 className="panel-title">Palette editor</h2>

      <label className="panel-field">
        <span>Palette</span>
        <select
          aria-label="Edit palette"
          value={selected?.id ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {(palettes.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtin ? ' (built-in)' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="panel-actions">
        <button onClick={() => create.mutate()}>New</button>
        <button
          disabled={!selected}
          onClick={() => selected && duplicate.mutate(selected.id)}
        >
          Duplicate
        </button>
        <button
          disabled={!selected}
          aria-label="Delete palette"
          onClick={() => selected && remove.mutate(selected.id)}
        >
          Delete
        </button>
      </div>

      {selected && draft && (
        <>
          <label className="panel-field">
            <span>Name</span>
            <input
              aria-label="Palette name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <h3 className="panel-subtitle">Node</h3>
          <ColorField
            label="Surface"
            value={draft.node.surface}
            onChange={(v) => patch((d) => ({ ...d, node: { ...d.node, surface: v }, surface: { ...d.surface, base: v, raised: v } }))}
          />
          <ColorField
            label="Content"
            value={draft.node.content}
            onChange={(v) => patch((d) => ({ ...d, node: { ...d.node, content: v }, content: { ...d.content, primary: v } }))}
          />
          <ColorField
            label="Border"
            value={draft.node.border}
            onChange={(v) => patch((d) => ({ ...d, node: { ...d.node, border: v }, border: { ...d.border, default: v } }))}
          />
          <EnumField
            label="Shape"
            value={draft.node.shape}
            options={NODE_SHAPES}
            onChange={(v) => patch((d) => ({ ...d, node: { ...d.node, shape: v }, stroke: { ...d.stroke, shape: v } }))}
          />
          <EnumField
            label="Border style"
            value={draft.node.borderStyle}
            options={BORDER_STYLES}
            onChange={(v) => patch((d) => ({ ...d, node: { ...d.node, borderStyle: v }, stroke: { ...d.stroke, borderStyle: v } }))}
          />
          <EnumField
            label="Pattern"
            value={draft.node.pattern}
            options={BACKGROUND_PATTERNS}
            onChange={(v) => patch((d) => ({ ...d, node: { ...d.node, pattern: v }, stroke: { ...d.stroke, pattern: v } }))}
          />
          <EnumField
            label="Elevation"
            value={draft.node.elevation}
            options={ELEVATIONS}
            onChange={(v) => patch((d) => ({ ...d, node: { ...d.node, elevation: v } }))}
          />

          <h3 className="panel-subtitle">Canvas</h3>
          <ColorField
            label="Canvas"
            value={draft.surface.canvas}
            onChange={(v) => patch((d) => ({ ...d, surface: { ...d.surface, canvas: v } }))}
          />
          <ColorField
            label="Edge stroke"
            value={draft.edge.stroke}
            onChange={(v) => patch((d) => ({ ...d, edge: { ...d.edge, stroke: v } }))}
          />
          <EnumField
            label="Effect"
            value={draft.effect}
            options={EFFECTS}
            onChange={(v) => patch((d) => ({ ...d, effect: v }))}
          />

          {validation && !validation.ok && (
            <div className="palette-warnings" role="alert" aria-label="Palette warnings">
              {validation.contrast.map((c) => (
                <p key={c.pair} className="panel-error">
                  Low contrast: {c.pair} ({c.ratio}:1, needs {c.threshold}:1)
                </p>
              ))}
              {validation.missing.length > 0 && (
                <p className="panel-error">Missing tokens: {validation.missing.join(', ')}</p>
              )}
            </div>
          )}

          <div className="panel-actions">
            <button aria-label="Save palette" onClick={() => saveEdits.mutate()}>
              Save
            </button>
            {onAssignToView && (
              <button onClick={() => onAssignToView(selected.id)}>Apply to view</button>
            )}
            {onAssignToChrome && (
              <button onClick={() => onAssignToChrome(selected.id)}>Apply to chrome</button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="panel-field style-row">
      <span>{label}</span>
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function EnumField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}) {
  return (
    <label className="panel-field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}
