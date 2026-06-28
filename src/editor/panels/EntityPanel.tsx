/**
 * Entity properties + cross-reference panel (spec §5.4, §7.4, §12 Phase 2).
 *
 * Edits an entity's typed `links[]` and open `metadata` bag — edits go through
 * `updateEntity`, so they reflect on every node placing the entity. Below the
 * editors, the "Used in / Connections" section renders `getEntityUsages`: every
 * placement (board/node), participating relationship, and backlink.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import { EXTERNAL_LINK_KINDS, type ExternalLink, type ExternalLinkKind } from '../../model'
import type { Uuid } from '../../gateway'

export interface EntityPanelProps {
  entityId: Uuid
  /** Called after a successful edit so the canvas re-renders. */
  onChanged: () => void
}

function newLinkId(): string {
  // crypto.randomUUID is available in the browser + jsdom; fall back for safety.
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `link-${Math.random().toString(36).slice(2)}`
}

export function EntityPanel({ entityId, onChanged }: EntityPanelProps) {
  const getGateway = useGateway()

  const entity = useQuery({
    queryKey: ['entity', entityId],
    queryFn: async () => {
      const gw = await getGateway()
      const graphs = await gw.listGraphs()
      for (const g of graphs) {
        const detail = await gw.getGraph(g.id)
        const found = detail.entities.find((e) => e.id === entityId)
        if (found) return found
      }
      return null
    },
  })

  const usages = useQuery({
    queryKey: ['usages', entityId],
    queryFn: async () => (await getGateway()).getEntityUsages(entityId),
  })

  const [links, setLinks] = useState<ExternalLink[]>([])
  const [metadataText, setMetadataText] = useState('{}')
  const [metadataError, setMetadataError] = useState<string | null>(null)

  useEffect(() => {
    if (entity.data) {
      setLinks(entity.data.links)
      setMetadataText(JSON.stringify(entity.data.metadata, null, 2))
    }
  }, [entity.data])

  const afterMutation = async () => {
    await entity.refetch()
    await usages.refetch()
    onChanged()
  }

  const saveLinks = useMutation({
    mutationFn: async (next: ExternalLink[]) => (await getGateway()).updateEntity(entityId, { links: next }),
    onSuccess: afterMutation,
  })

  const saveMetadata = useMutation({
    mutationFn: async () => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(metadataText)
        setMetadataError(null)
      } catch {
        setMetadataError('Invalid JSON')
        throw new Error('Invalid JSON')
      }
      return (await getGateway()).updateEntity(entityId, { metadata: parsed })
    },
    onSuccess: afterMutation,
  })

  const renameEntity = useMutation({
    mutationFn: async (name: string) => (await getGateway()).updateEntity(entityId, { name }),
    onSuccess: afterMutation,
  })

  if (!entity.data) {
    return (
      <section className="panel" aria-label="Entity properties">
        <h2 className="panel-title">Properties</h2>
        <p className="panel-empty">{entity.isLoading ? 'Loading…' : 'No entity selected'}</p>
      </section>
    )
  }

  const addLink = () => {
    const next = [
      ...links,
      { id: newLinkId(), kind: 'url' as ExternalLinkKind, target: '', label: '' },
    ]
    setLinks(next)
  }
  const updateLink = (id: string, patch: Partial<ExternalLink>) =>
    setLinks((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const removeLink = (id: string) => {
    const next = links.filter((l) => l.id !== id)
    setLinks(next)
    saveLinks.mutate(next)
  }

  return (
    <section className="panel" aria-label="Entity properties">
      <h2 className="panel-title">Properties</h2>

      <label className="panel-field">
        <span>Name</span>
        <input
          aria-label="Entity name"
          defaultValue={entity.data.name}
          onBlur={(e) => {
            if (e.target.value !== entity.data?.name) renameEntity.mutate(e.target.value)
          }}
        />
      </label>

      <h3 className="panel-subtitle">Links</h3>
      <ul className="panel-list" aria-label="Entity links">
        {links.map((link) => (
          <li key={link.id} className="link-row">
            <select
              aria-label="Link kind"
              value={link.kind}
              onChange={(e) => updateLink(link.id, { kind: e.target.value as ExternalLinkKind })}
            >
              {EXTERNAL_LINK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              aria-label="Link target"
              placeholder="target"
              value={link.target}
              onChange={(e) => updateLink(link.id, { target: e.target.value })}
            />
            <input
              aria-label="Link label"
              placeholder="label"
              value={link.label}
              onChange={(e) => updateLink(link.id, { label: e.target.value })}
            />
            <button aria-label="Remove link" onClick={() => removeLink(link.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="panel-actions">
        <button onClick={addLink}>Add link</button>
        <button onClick={() => saveLinks.mutate(links)}>Save links</button>
      </div>

      <h3 className="panel-subtitle">Metadata</h3>
      <textarea
        className="panel-textarea"
        aria-label="Entity metadata"
        rows={4}
        value={metadataText}
        onChange={(e) => setMetadataText(e.target.value)}
      />
      {metadataError && <p className="panel-error">{metadataError}</p>}
      <div className="panel-actions">
        <button onClick={() => saveMetadata.mutate()}>Save metadata</button>
      </div>

      <h3 className="panel-subtitle">Used in / Connections</h3>
      <div aria-label="Entity usages">
        <p className="panel-meta">
          Placed on {usages.data?.placements.length ?? 0} node(s);{' '}
          {usages.data?.relationships.length ?? 0} relationship(s);{' '}
          {usages.data?.backlinks.length ?? 0} backlink(s)
        </p>
        <ul className="panel-list">
          {(usages.data?.placements ?? []).map((p) => (
            <li key={p.nodeId} className="usage-row">
              {p.label} — <em>{p.boardName}</em>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
