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

/**
 * Open a panel from the floating dock: expand it if needed, then tap the panel
 * opener, which raises the matching bottom sheet (the single panel surface on
 * every viewport now). Returns the sheet dialog locator.
 */
async function openDockPanel(page: Page, label: string, title: string) {
  const dock = page.getByRole('region', { name: 'Canvas controls' })
  const expand = dock.getByRole('button', { name: /more controls/ })
  if ((await expand.getAttribute('aria-expanded')) !== 'true') await expand.click()
  await dock.getByRole('button', { name: `${label} panel` }).click()
  return page.getByRole('dialog', { name: title })
}

/** Dismiss an open bottom sheet via its close button. */
async function closeSheet(page: Page, title: string) {
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: `Close ${title}` }).click()
  await expect(page.getByRole('dialog', { name: title })).toHaveCount(0)
}

/**
 * Add a node through the entity picker (§9 / D6): click the dock's Add button to
 * open the picker dialog, then create a new entity with `name`. On desktop the
 * picker is a centered modal; no anonymous `Node N`.
 */
async function addNodeViaPicker(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add node' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add node' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Create new' }).click()
  await dialog.getByLabel('New entity name').fill(name)
  await dialog.getByRole('button', { name: 'Create node' }).click()
  await expect(page.getByRole('dialog', { name: 'Add node' })).toHaveCount(0)
}

test('loads, adds two nodes and connects them with no console errors', async ({ page }) => {
  const errors = trackErrors(page)

  await page.goto('/')

  // Bootstrap completes → the Add node button enables.
  const addNode = page.getByRole('button', { name: 'Add node' }).first()
  await expect(addNode).toBeEnabled()

  // Each add goes through the entity picker (§9 / D6): create-new places a node.
  await addNodeViaPicker(page, 'Alpha')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await addNodeViaPicker(page, 'Beta')
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

test('mode-less selection: tap selects one, double-tap adds/removes (⌘-click parity)', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add node' }).first()).toBeEnabled()

  await addNodeViaPicker(page, 'One')
  await addNodeViaPicker(page, 'Two')
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  const nodes = page.locator('.react-flow__node')

  // A single tap selects exactly one node.
  await nodes.nth(0).click()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

  // Double-tapping the OTHER node adds it to the selection (both selected).
  await nodes.nth(1).dblclick()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)

  // Double-tapping it again removes it (back to just the first).
  await nodes.nth(1).dblclick()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

  expect(errors).toEqual([])
})

test('Phase 2: prototype library stamps a node and selection opens properties', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add node' }).first()).toBeEnabled()

  // The prototype library panel (in the Prototypes sheet) renders the built-ins.
  const protoSheet = await openDockPanel(page, 'Prototypes', 'Prototypes')
  const protoPanel = protoSheet.getByRole('region', { name: 'Prototype library' })
  await expect(protoPanel).toBeVisible()
  await expect(protoPanel.getByText('Service')).toBeVisible()

  // Stamp a node from the Service prototype → a placement appears on the canvas.
  await protoPanel.getByRole('button', { name: 'Create from Service' }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  // Close the sheet so the node is selectable on the (uncovered) canvas.
  await closeSheet(page, 'Prototypes')

  // Selecting the node makes the cross-reference panel available; open it.
  await page.locator('.react-flow__node').first().click()
  const crossSheet = await openDockPanel(page, 'Cross-reference', 'Cross-reference')
  await expect(crossSheet.getByRole('region', { name: 'Entity properties' })).toBeVisible()
  await expect(crossSheet.getByText(/Used in \/ Connections/)).toBeVisible()

  expect(errors).toEqual([])
})

test('Phase 3: create a second diagram, switch diagrams', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')

  // The URL reflects the active diagram/layout (React Router, §11).
  await expect(page).toHaveURL(/\/diagram\/.+\/layout\/.+/)
  const firstUrl = page.url()

  // The diagrams/layouts switcher (in the Palette sheet) shows the seeded diagram.
  const addNode = page.getByRole('button', { name: 'Add node' }).first()
  await expect(addNode).toBeEnabled()
  let paletteSheet = await openDockPanel(page, 'Palette', 'Palette')
  let diagramsPanel = paletteSheet.getByRole('region', { name: 'Diagrams and layouts' })
  await expect(diagramsPanel).toBeVisible()
  await expect(diagramsPanel.getByLabel('Open diagram Diagram 1')).toBeVisible()

  // Create a second diagram → navigation moves to its (new) URL and Diagram 2
  // becomes the active diagram.
  await diagramsPanel.getByLabel('New diagram name').fill('Diagram 2')
  await diagramsPanel.getByLabel('Create diagram').click()
  await expect.poll(() => page.url()).not.toBe(firstUrl)
  await expect(page).toHaveURL(/\/diagram\/.+\/layout\/.+/)
  await expect(diagramsPanel.getByLabel('Open diagram Diagram 2')).toHaveAttribute(
    'aria-current',
    'true',
  )

  // Add a node on the new diagram (close the sheet so the dock is reachable),
  // then switch back to Diagram 1 (a separate subgraph).
  await closeSheet(page, 'Palette')
  await addNodeViaPicker(page, 'D2 Node')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)

  paletteSheet = await openDockPanel(page, 'Palette', 'Palette')
  diagramsPanel = paletteSheet.getByRole('region', { name: 'Diagrams and layouts' })
  await diagramsPanel.getByLabel('Open diagram Diagram 1').click()
  await expect(diagramsPanel.getByLabel('Open diagram Diagram 1')).toHaveAttribute(
    'aria-current',
    'true',
  )
  await closeSheet(page, 'Palette')
  // Diagram 1 has its own (empty) membership.
  await expect(page.locator('.react-flow__node')).toHaveCount(0)

  // Add a node on Diagram 1 — it renders with the seeded default style.
  await addNodeViaPicker(page, 'D1 Node')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)

  expect(errors).toEqual([])
})

test('restores the diagram from OPFS + the pointer after a reload', async ({ page }) => {
  await page.goto('/')
  const addNode = page.getByRole('button', { name: 'Add node' }).first()
  await expect(addNode).toBeEnabled()

  await addNodeViaPicker(page, 'Keep 1')
  await addNodeViaPicker(page, 'Keep 2')
  await expect(page.locator('.react-flow__node')).toHaveCount(2)

  // Reload: the active graph is reopened from the localStorage pointer and the
  // OPFS-persisted SQLite store — the nodes survive.
  await page.reload()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
})
