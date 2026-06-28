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

  // Let the canvas settle (background diagram refetch done) before the drag, so
  // a refetch can't replace the nodes just as React Flow starts the connection.
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // Drag from the LEFT node's right-facing source handle to the RIGHT node's
  // left-facing target handle. The DOM order of `.react-flow__node` follows the
  // node id, not screen position, so pick by x-position to drag handles that
  // actually face each other (a backward drag is unreliable in React Flow).
  const box0 = await page.locator('.react-flow__node').nth(0).boundingBox()
  const box1 = await page.locator('.react-flow__node').nth(1).boundingBox()
  if (!box0 || !box1) throw new Error('nodes not found')
  const leftIndex = box0.x <= box1.x ? 0 : 1
  const rightIndex = leftIndex === 0 ? 1 : 0
  const source = page
    .locator('.react-flow__node')
    .nth(leftIndex)
    .locator('.react-flow__handle.source')
  const target = page
    .locator('.react-flow__node')
    .nth(rightIndex)
    .locator('.react-flow__handle.target')
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

test('Phase 2: prototype library stamps a node and selection opens properties', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/')

  // The prototype library panel renders with the seeded built-ins.
  const protoPanel = page.getByRole('region', { name: 'Prototype library' })
  await expect(protoPanel).toBeVisible()
  await expect(protoPanel.getByText('Service')).toBeVisible()

  // Stamp a node from the Service prototype → a placement appears on the canvas.
  await protoPanel.getByRole('button', { name: 'Create from Service' }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)

  // Selecting the node opens the entity properties / cross-reference panel.
  await page.locator('.react-flow__node').first().click()
  await expect(page.getByRole('region', { name: 'Entity properties' })).toBeVisible()
  await expect(page.getByText(/Used in \/ Connections/)).toBeVisible()

  expect(errors).toEqual([])
})

test('Phase 3: create a second board, switch boards, swap the palette', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')

  // The URL reflects the active board/view (React Router, §11).
  await expect(page).toHaveURL(/\/board\/.+\/view\/.+/)
  const firstUrl = page.url()

  // The boards/views switcher is present with the seeded board + view.
  const boardsPanel = page.getByRole('region', { name: 'Boards and views' })
  await expect(boardsPanel).toBeVisible()
  await expect(boardsPanel.getByLabel('Open board Board 1')).toBeVisible()

  // Create a second board → navigation moves to its (new) board/view URL and
  // Board 2 becomes the active board.
  await boardsPanel.getByLabel('New board name').fill('Board 2')
  await boardsPanel.getByLabel('Create board').click()
  await expect.poll(() => page.url()).not.toBe(firstUrl)
  await expect(page).toHaveURL(/\/board\/.+\/view\/.+/)
  await expect(boardsPanel.getByLabel('Open board Board 2')).toHaveAttribute('aria-current', 'true')

  // Add a node on the new board, then switch back to Board 1 (separate subgraph).
  const addNode = page.getByRole('button', { name: 'Add node' }).first()
  await expect(addNode).toBeEnabled()
  await addNode.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)

  await boardsPanel.getByLabel('Open board Board 1').click()
  await expect(boardsPanel.getByLabel('Open board Board 1')).toHaveAttribute('aria-current', 'true')
  // Board 1 has its own (empty) membership.
  await expect(page.locator('.react-flow__node')).toHaveCount(0)

  // Add a node on Board 1, then re-skin via the per-view palette switcher (§8.4).
  await addNode.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  const palettePanel = page.getByRole('region', { name: 'Palette' })
  await expect(palettePanel).toBeVisible()
  await palettePanel.getByLabel('Canvas palette').selectOption({ label: 'Midnight' })
  // The node re-skins to the Midnight surface (#1f2937 → rgb(31, 41, 55)).
  await expect
    .poll(() =>
      page
        .locator('.nodge-node')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe('rgb(31, 41, 55)')

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
