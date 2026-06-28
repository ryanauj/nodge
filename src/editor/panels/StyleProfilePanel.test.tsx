import { describe, it, expect } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithGateway } from './panelTestUtils'
import { StyleProfilePanel } from './StyleProfilePanel'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  return graph.id
}

describe('StyleProfilePanel — create/rename/edit/delete (§8.3)', () => {
  it('creates a style profile via the gateway', async () => {
    const gw = await createMemoryGateway()
    const graphId = await seed(gw)
    renderWithGateway(<StyleProfilePanel graphId={graphId} />, gw)

    fireEvent.change(await screen.findByLabelText('New profile name'), {
      target: { value: 'Brand' },
    })
    fireEvent.click(screen.getByLabelText('Create profile'))

    await waitFor(async () => {
      const list = await gw.listStyleProfiles(graphId)
      expect(list.some((p) => p.name === 'Brand')).toBe(true)
    })
  })

  it('edits a profile style JSON and deletes it', async () => {
    const gw = await createMemoryGateway()
    const graphId = await seed(gw)
    const sp = await gw.createStyleProfile(graphId, { name: 'Look', target: 'node' })
    renderWithGateway(<StyleProfilePanel graphId={graphId} />, gw)

    // Select the profile, edit its style, save.
    fireEvent.click(await screen.findByLabelText('Edit profile Look'))
    const styleBox = await screen.findByLabelText('Profile style')
    fireEvent.change(styleBox, { target: { value: '{"border":"#ff0000"}' } })
    fireEvent.click(screen.getByLabelText('Save profile style'))
    await waitFor(async () => {
      const list = await gw.listStyleProfiles(graphId)
      expect(list.find((p) => p.id === sp.id)?.style).toEqual({ border: '#ff0000' })
    })

    // Delete it.
    fireEvent.click(screen.getByLabelText('Delete profile Look'))
    await waitFor(async () => {
      const list = await gw.listStyleProfiles(graphId)
      expect(list.some((p) => p.id === sp.id)).toBe(false)
    })
  })
})
