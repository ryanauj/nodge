import { fireEvent, render, screen } from '@testing-library/react'
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

describe('QuickPicker (drag-to-create, §9.4)', () => {
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
