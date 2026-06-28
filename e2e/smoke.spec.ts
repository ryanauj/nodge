import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 1 smoke (spec §12 acceptance): the page loads with no console errors,
 * and a user can add two nodes and connect them.
 */

/** Collect console errors and uncaught page errors for an assertion at the end. */
function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test('loads, adds two nodes and connects them with no console errors', async ({ page }) => {
  const errors = trackErrors(page)

  await page.goto('/')

  // Bootstrap completes → the Add node button enables.
  const addNode = page.getByRole('button', { name: 'Add node' }).first()
  await expect(addNode).toBeEnabled()

  await addNode.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await addNode.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)

  // Drag from the first node's source handle to the second node's target handle.
  const source = page.locator('.react-flow__node').nth(0).locator('.react-flow__handle.source')
  const target = page.locator('.react-flow__node').nth(1).locator('.react-flow__handle.target')
  const s = await source.boundingBox()
  const t = await target.boundingBox()
  if (!s || !t) throw new Error('handles not found')

  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move((s.x + t.x) / 2, (s.y + t.y) / 2, { steps: 6 })
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 6 })
  await page.mouse.up()

  // An edge placement is created and rendered.
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)

  expect(errors).toEqual([])
})

test('restores the diagram from OPFS + the pointer after a reload', async ({ page }) => {
  await page.goto('/')
  const addNode = page.getByRole('button', { name: 'Add node' }).first()
  await expect(addNode).toBeEnabled()

  await addNode.click()
  await addNode.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)

  // Reload: the active graph is reopened from the localStorage pointer and the
  // OPFS-persisted SQLite store — the nodes survive.
  await page.reload()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
})
