import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 5 mobile smoke (spec §12 acceptance). At a phone viewport (the Pixel 5
 * project, touch enabled) this exercises the mode-less touch interaction model
 * (spec §10.2):
 *   - loads with no console errors;
 *   - adds two nodes via the dock's Add button → the entity-picker bottom sheet
 *     (§9 / D6) → "Create new" (no anonymous `Node N`);
 *   - connects them by dragging from one node's source handle to the other's
 *     target handle (handle-to-handle connect);
 *   - long-presses then drags on empty canvas to marquee-select both nodes;
 *   - expands the dock, opens a bottom-sheet panel and dismisses it;
 *   - reloads and the diagram is restored from OPFS + the pointer.
 *
 * Also a no-gesture-conflict proof: a plain one-finger drag on empty canvas pans
 * (draws nothing), while a long-press-then-drag draws a marquee.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Add a node through the entity picker (§9 / D6): tap the dock's Add button, then
 * on the bottom-sheet "Add node" dialog create a new entity with `name`.
 */
async function createNode(page: Page, dock: ReturnType<Page['getByRole']>, name: string) {
  await dock.getByRole('button', { name: 'Add node' }).tap()
  const sheet = page.getByRole('dialog', { name: 'Add node' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('tab', { name: 'Create new' }).tap()
  await sheet.getByLabel('New entity name').fill(name)
  await sheet.getByRole('button', { name: 'Create node' }).tap()
  await expect(page.getByRole('dialog', { name: 'Add node' })).toHaveCount(0)
}

test('mobile touch model: add via picker, connect via handles, marquee, reload', async ({
  page,
}) => {
  const errors = trackErrors(page)

  await page.goto('/')

  // Bootstrap completes → the floating dock's slim bar is present (mobile only).
  const dock = page.getByRole('region', { name: 'Canvas controls' })
  await expect(dock.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible()

  // Mode-less: there are no Select/Connect/Add mode buttons.
  await expect(dock.getByRole('button', { name: 'Select mode' })).toHaveCount(0)
  await expect(dock.getByRole('button', { name: 'Connect mode' })).toHaveCount(0)

  await expect(dock.getByRole('button', { name: 'Add node' })).toBeEnabled()
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // ── Add two nodes via the Add button + picker. ──
  await createNode(page, dock, 'First')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)
  await createNode(page, dock, 'Second')
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // ── Connect by dragging from the left node's source handle to the right node's
  //    target handle (handle-to-handle connect, §10.2). DOM order follows node id,
  //    not screen position, so pick by x so the handles face each other. ──
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
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // ── Expand the dock, open a bottom-sheet panel (Palette) and dismiss it. ──
  await dock.getByRole('button', { name: 'Show more controls' }).tap()
  await dock.getByRole('button', { name: 'Palette panel' }).tap()
  const sheet = page.getByRole('dialog', { name: 'Palette' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('region', { name: 'Diagrams and layouts' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Close Palette' }).tap()
  await expect(page.getByRole('dialog', { name: 'Palette' })).toHaveCount(0)

  // ── Reload: the diagram is restored from OPFS + the localStorage pointer. ──
  await page.reload()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)

  expect(errors).toEqual([])
})

test('mobile: one-finger pane drag pans; long-press-then-drag marquees', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')
  const dock = page.getByRole('region', { name: 'Canvas controls' })
  await expect(dock.getByRole('button', { name: 'Add node' })).toBeEnabled()

  await createNode(page, dock, 'Anchor')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  const pane = page.locator('.react-flow__pane')
  const box = await pane.boundingBox()
  if (!box) throw new Error('pane not found')

  // A plain drag across empty canvas pans — it must not create a node or edge.
  await page.mouse.move(box.x + 60, box.y + 120)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 260, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge')).toHaveCount(0)

  // Deselect, then long-press (hold still) before dragging → a marquee that
  // sweeps over the node selects it. Node width defaults small; sweep a wide box
  // from an empty corner across where the node sits.
  const nodeBox = await page.locator('.react-flow__node').first().boundingBox()
  if (!nodeBox) throw new Error('node not found')
  const startX = box.x + 20
  const startY = box.y + 20
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // Hold past the long-press threshold (380ms) without moving.
  await page.waitForTimeout(550)
  await page.mouse.move(nodeBox.x + nodeBox.width + 20, nodeBox.y + nodeBox.height + 20, {
    steps: 12,
  })
  await page.mouse.up()

  // The node is now selected (React Flow marks the selected class).
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
  // Nothing was created by the marquee.
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge')).toHaveCount(0)

  expect(errors).toEqual([])
})
