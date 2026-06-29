import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QuickPicker } from './QuickPicker'
import type { Entity, Prototype } from '../../model'

function entity(id: string, name: string): Entity {
  return {
    id,
    graphId: 'g',
    name,
    nodePrototypeId: null,
    links: [],
    metadata: {},
    createdAt: '',
    updatedAt: '',
    version: 1,
  }
}

function prototype(id: string, name: string): Prototype {
  return {
    id,
    graphId: 'g',
    kind: 'node',
    name,
    shape: null,
    defaultLabel: '',
    style: {},
    metadata: {},
    linkScaffold: [],
    createdAt: '',
    updatedAt: '',
    version: 1,
  }
}

// QuickPicker is now a thin wrapper over the shared EntityPicker (§9 / D6): it
// supplies the "Connect to" framing and filters `prototypes` to node prototypes.
describe('QuickPicker (drag-to-create, §9.4)', () => {
  it('renders the shared picker dialog with the edge-drop "Connect to" title', () => {
    render(
      <QuickPicker
        entities={[]}
        prototypes={[]}
        onUseExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Connect to' })).toBeInTheDocument()
  })

  it('offers only node prototypes (edge prototypes are filtered out)', () => {
    const edgeProto: Prototype = { ...prototype('p2', 'DependsOn'), kind: 'edge' }
    render(
      <QuickPicker
        entities={[]}
        prototypes={[prototype('p1', 'Service'), edgeProto]}
        onUseExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Create new' }))
    const select = screen.getByLabelText('Prototype to link')
    expect(within(select).getByRole('option', { name: 'Service' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'DependsOn' })).not.toBeInTheDocument()
  })

  it('path a: searches and picks an existing entity', () => {
    const onUseExisting = vi.fn()
    render(
      <QuickPicker
        entities={[entity('e1', 'Alpha'), entity('e2', 'Beta')]}
        prototypes={[]}
        onUseExisting={onUseExisting}
        onCreateNew={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Search entities'), { target: { value: 'bet' } })
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Beta'))
    expect(onUseExisting).toHaveBeenCalledWith('e2')
  })

  it('path b: creates a new entity with a chosen prototype', () => {
    const onCreateNew = vi.fn()
    render(
      <QuickPicker
        entities={[]}
        prototypes={[prototype('p1', 'Service')]}
        onUseExisting={vi.fn()}
        onCreateNew={onCreateNew}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Create new' }))
    fireEvent.change(screen.getByLabelText('New entity name'), { target: { value: 'Cache' } })
    fireEvent.change(screen.getByLabelText('Prototype to link'), { target: { value: 'p1' } })
    fireEvent.click(screen.getByRole('button', { name: /Create & connect/ }))
    expect(onCreateNew).toHaveBeenCalledWith('Cache', 'p1')
  })
})
