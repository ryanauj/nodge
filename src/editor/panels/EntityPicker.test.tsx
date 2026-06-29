import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { EntityPicker } from './EntityPicker'
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

/** Drive `matchMedia` so the picker renders the desktop dialog or the bottom sheet. */
function setViewport(phone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

const renderDesktop = (props: Partial<Parameters<typeof EntityPicker>[0]> = {}) =>
  render(
    <EntityPicker
      entities={[entity('e1', 'Alpha'), entity('e2', 'Beta')]}
      nodePrototypes={[prototype('p1', 'Service')]}
      onUseExisting={vi.fn()}
      onCreateNew={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  )

describe('EntityPicker (shared add-node / edge-drop picker, §9 / D6)', () => {
  beforeEach(() => setViewport(false))
  afterEach(() => vi.restoreAllMocks())

  it('renders a labelled dialog with a proper tablist', () => {
    renderDesktop({ title: 'Add node' })
    const dialog = screen.getByRole('dialog', { name: 'Add node' })
    expect(dialog).toBeInTheDocument()
    const tabs = within(dialog).getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    // Roving tabindex: only the selected tab is in the Tab order.
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
  })

  it('derives the tablist label from the title (edge-drop reuse)', () => {
    renderDesktop({ title: 'Connect to' })
    expect(screen.getByRole('tablist', { name: 'Connect to by' })).toBeInTheDocument()
  })

  it('Arrow keys switch the active tab and move focus to it (WAI-ARIA tabs)', () => {
    renderDesktop()
    const existingTab = screen.getByRole('tab', { name: 'Use existing' })
    const newTab = screen.getByRole('tab', { name: 'Create new' })
    existingTab.focus()
    expect(existingTab).toHaveFocus()

    // ArrowRight → the "Create new" tab is selected, focused, and Tab-reachable.
    fireEvent.keyDown(existingTab, { key: 'ArrowRight' })
    expect(newTab).toHaveAttribute('aria-selected', 'true')
    expect(newTab).toHaveFocus()
    expect(newTab).toHaveAttribute('tabindex', '0')
    expect(existingTab).toHaveAttribute('tabindex', '-1')
    // The "Create new" panel is now shown.
    expect(screen.getByLabelText('New entity name')).toBeInTheDocument()

    // ArrowLeft → back to "Use existing", focus follows.
    fireEvent.keyDown(newTab, { key: 'ArrowLeft' })
    expect(existingTab).toHaveAttribute('aria-selected', 'true')
    expect(existingTab).toHaveFocus()

    // Home/End jump to the first/last tab.
    fireEvent.keyDown(existingTab, { key: 'End' })
    expect(newTab).toHaveFocus()
    fireEvent.keyDown(newTab, { key: 'Home' })
    expect(existingTab).toHaveFocus()
  })

  it('path a: searches and picks an existing entity', () => {
    const onUseExisting = vi.fn()
    renderDesktop({ onUseExisting })
    fireEvent.change(screen.getByLabelText('Search entities'), { target: { value: 'bet' } })
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Beta'))
    expect(onUseExisting).toHaveBeenCalledWith('e2')
  })

  it('path b: creates a new entity with a chosen node prototype', () => {
    const onCreateNew = vi.fn()
    renderDesktop({ onCreateNew, createLabel: 'Create node' })
    fireEvent.click(screen.getByRole('tab', { name: 'Create new' }))
    expect(screen.getByRole('tab', { name: 'Create new' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.change(screen.getByLabelText('New entity name'), { target: { value: 'Cache' } })
    fireEvent.change(screen.getByLabelText('Prototype to link'), { target: { value: 'p1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create node' }))
    expect(onCreateNew).toHaveBeenCalledWith('Cache', 'p1')
  })

  it('creates with a null prototype when none is chosen', () => {
    const onCreateNew = vi.fn()
    renderDesktop({ onCreateNew })
    fireEvent.click(screen.getByRole('tab', { name: 'Create new' }))
    fireEvent.change(screen.getByLabelText('New entity name'), { target: { value: 'Plain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreateNew).toHaveBeenCalledWith('Plain', null)
  })

  it('disables Create until a name is entered', () => {
    renderDesktop()
    fireEvent.click(screen.getByRole('tab', { name: 'Create new' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('New entity name'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('Escape dismisses the dialog (keyboard parity)', () => {
    const onCancel = vi.fn()
    renderDesktop({ onCancel })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('clicking the backdrop cancels but clicking inside does not', () => {
    const onCancel = vi.fn()
    const { container } = renderDesktop({ onCancel })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.entity-picker-backdrop')!)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the dialog on open and returns it to the trigger on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    const { unmount } = renderDesktop()
    // autoFocus lands on the search field inside the dialog.
    expect(screen.getByLabelText('Search entities')).toHaveFocus()
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('renders as a swipe-to-dismiss bottom sheet on a phone viewport', () => {
    setViewport(true)
    const onCancel = vi.fn()
    render(
      <EntityPicker
        entities={[entity('e1', 'Alpha')]}
        nodePrototypes={[]}
        onUseExisting={vi.fn()}
        onCreateNew={vi.fn()}
        onCancel={onCancel}
        title="Add node"
      />,
    )
    // The bottom sheet is a labelled dialog with a swipe drag handle.
    expect(screen.getByRole('dialog', { name: 'Add node' })).toHaveClass('bottom-sheet')
    expect(screen.getByTestId('bottom-sheet-handle')).toBeInTheDocument()
    // The shared body (tabs + search) is still present.
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByLabelText('Search entities')).toBeInTheDocument()
  })
})
