/**
 * StyleProfile browser/editor (spec §8.3, §12 Phase 4).
 *
 * A StyleProfile is a named bundle of style overrides — a shared "look" that
 * prototypes/entities/nodes can reference. This panel lists the graph's
 * profiles and lets the user create a new one (node or edge target), rename it,
 * edit its style JSON, and delete it — all through the gateway/command layer
 * (`createStyleProfile`/`updateStyleProfile`/`deleteStyleProfile`), undoable.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import { STYLE_PROFILE_TARGETS, type StyleProfileTarget } from '../../model'
import type { Uuid } from '../../gateway'

export interface StyleProfilePanelProps {
  graphId: Uuid
  onChanged?: () => void
}

export function StyleProfilePanel({ graphId, onChanged }: StyleProfilePanelProps) {
  const getGateway = useGateway()

  const profiles = useQuery({
    queryKey: ['style-profiles', graphId],
    queryFn: async () => (await getGateway()).listStyleProfiles(graphId),
  })

  const [selectedId, setSelectedId] = useState<Uuid | null>(null)
  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState<StyleProfileTarget>('node')
  const [styleText, setStyleText] = useState('{}')
  const [styleError, setStyleError] = useState<string | null>(null)

  const selected = profiles.data?.find((p) => p.id === selectedId) ?? null
  useEffect(() => {
    if (selected) setStyleText(JSON.stringify(selected.style, null, 2))
  }, [selected])

  const refresh = async () => {
    await profiles.refetch()
    onChanged?.()
  }

  const create = useMutation({
    mutationFn: async () =>
      (await getGateway()).createStyleProfile(graphId, {
        name: newName || 'Profile',
        target: newTarget,
      }),
    onSuccess: async (p) => {
      setNewName('')
      setSelectedId(p.id)
      await refresh()
    },
  })

  const rename = useMutation({
    mutationFn: async (name: string) => {
      if (!selected) return
      return (await getGateway()).updateStyleProfile(selected.id, { name })
    },
    onSuccess: refresh,
  })

  const saveStyle = useMutation({
    mutationFn: async () => {
      if (!selected) return
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(styleText)
        setStyleError(null)
      } catch {
        setStyleError('Invalid JSON')
        throw new Error('Invalid JSON')
      }
      return (await getGateway()).updateStyleProfile(selected.id, { style: parsed })
    },
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: async (id: Uuid) => (await getGateway()).deleteStyleProfile(id),
    onSuccess: async () => {
      setSelectedId(null)
      await refresh()
    },
  })

  return (
    <section className="panel" aria-label="Style profiles">
      <h2 className="panel-title">Style profiles</h2>

      <ul className="panel-list" aria-label="Style profile list">
        {(profiles.data ?? []).map((p) => (
          <li key={p.id} className="panel-list-item">
            <button
              className={p.id === selectedId ? 'switch-active' : undefined}
              aria-label={`Edit profile ${p.name}`}
              aria-current={p.id === selectedId}
              onClick={() => setSelectedId(p.id)}
            >
              {p.name} <span className="proto-kind">({p.target})</span>
            </button>
            <button aria-label={`Delete profile ${p.name}`} onClick={() => remove.mutate(p.id)}>
              ✕
            </button>
          </li>
        ))}
        {(profiles.data?.length ?? 0) === 0 && <li className="panel-empty">No profiles yet</li>}
      </ul>

      <h3 className="panel-subtitle">New profile</h3>
      <div className="panel-actions">
        <input
          aria-label="New profile name"
          placeholder="name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select
          aria-label="New profile target"
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value as StyleProfileTarget)}
        >
          {STYLE_PROFILE_TARGETS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button aria-label="Create profile" onClick={() => create.mutate()}>
          Add
        </button>
      </div>

      {selected && (
        <>
          <h3 className="panel-subtitle">Edit “{selected.name}”</h3>
          <label className="panel-field">
            <span>Name</span>
            <input
              aria-label="Profile name"
              defaultValue={selected.name}
              key={selected.id}
              onBlur={(e) => {
                if (e.target.value !== selected.name) rename.mutate(e.target.value)
              }}
            />
          </label>
          <label className="panel-field">
            <span>Style (JSON)</span>
            <textarea
              className="panel-textarea"
              aria-label="Profile style"
              rows={4}
              value={styleText}
              onChange={(e) => setStyleText(e.target.value)}
            />
          </label>
          {styleError && <p className="panel-error">{styleError}</p>}
          <div className="panel-actions">
            <button aria-label="Save profile style" onClick={() => saveStyle.mutate()}>
              Save style
            </button>
          </div>
        </>
      )}
    </section>
  )
}
