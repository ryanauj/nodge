import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 5 mobile smoke (spec §12 acceptance). At a phone viewport (the Pixel 5
 * project, touch enabled) this exercises the full touch interaction model:
 *   - loads with no console errors;
 *   - switches tool mode (Select → Add → Connect) via the floating dock's slim bar;
 *   - adds two nodes by tapping empty canvas in Add mode (gesture model, no FAB);
 *   - connects them in Connect mode by tapping source then target (tap→tap edge);
 *   - expands the dock, opens a bottom-sheet panel and dismisses it (swipe/close);
 *   - reloads and the diagram is restored from OPFS + the pointer.
 *
 * Also a no-gesture-conflict proof: in Add mode tapping empty canvas adds a node
 * (it is not swallowed by a pan); in Connect mode two taps make an edge.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/** Tap a point in the React Flow pane (empty canvas), avoiding the chrome. */
async function tapPane(page: Page, x: number, y: number) {
  await page.locator('.react-flow__pane').tap({ position: { x, y } })
}

test('mobile touch model: switch mode, add + connect via taps, sheet, reload', async ({
  page,
}) => {
  const errors = trackErrors(page)

  await page.goto('/')

  // Bootstrap completes → the floating dock's slim bar is present (mobile only).
  const dock = page.getByRole('region', { name: 'Canvas controls' })
  const toolbar = dock.getByRole('toolbar', { name: 'Canvas tools' })
  await expect(toolbar).toBeVisible()
  const selectMode = dock.getByRole('button', { name: 'Select mode' })
  const addMode = dock.getByRole('button', { name: 'Add mode' })
  const connectMode = dock.getByRole('button', { name: 'Connect mode' })
  await expect(selectMode).toHaveAttribute('aria-pressed', 'true')

  // Wait until the canvas is ready (the dock's add-node button enables).
  await expect(dock.getByRole('button', { name: 'Add node' })).toBeEnabled()
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // ── Switch to Add mode and add two nodes by tapping empty canvas. ──
  await addMode.tap()
  await expect(addMode).toHaveAttribute('aria-pressed', 'true')

  await tapPane(page, 100, 160)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)
  await tapPane(page, 100, 420)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // ── Switch to Connect mode; tap source node then target node = an edge. ──
  await connectMode.tap()
  await expect(connectMode).toHaveAttribute('aria-pressed', 'true')

  const nodes = page.locator('.react-flow__node')
  await nodes.nth(0).tap()
  await nodes.nth(1).tap()
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // ── Expand the dock, open a bottom-sheet panel (Palette) and dismiss it. ──
  await dock.getByRole('button', { name: 'Show more controls' }).tap()
  const paletteTab = dock.getByRole('button', { name: 'Palette panel' })
  await paletteTab.tap()
  const sheet = page.getByRole('dialog', { name: 'Palette' })
  await expect(sheet).toBeVisible()
  // The side-panel column is hidden on mobile; the sheet hosts the panels.
  await expect(sheet.getByRole('region', { name: 'Diagrams and layouts' })).toBeVisible()

  await sheet.getByRole('button', { name: 'Close Palette' }).tap()
  await expect(page.getByRole('dialog', { name: 'Palette' })).toHaveCount(0)

  // ── Reload: the diagram is restored from OPFS + the localStorage pointer. ──
  await page.reload()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)

  expect(errors).toEqual([])
})

test('mobile: in Select mode a one-finger pane drag pans (no stray edge/node)', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/')
  const dock = page.getByRole('region', { name: 'Canvas controls' })
  await expect(dock.getByRole('button', { name: 'Add node' })).toBeEnabled()

  // Add one node so there is something to (not) disturb.
  await dock.getByRole('button', { name: 'Add node' }).tap()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // Select mode is the default. A drag across empty canvas pans — it must not
  // create a node or an edge (gesture disambiguation, spec §10.2).
  await expect(dock.getByRole('button', { name: 'Select mode' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const pane = page.locator('.react-flow__pane')
  const box = await pane.boundingBox()
  if (!box) throw new Error('pane not found')
  await page.mouse.move(box.x + 80, box.y + 120)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 240, { steps: 8 })
  await page.mouse.up()

  // Still exactly one node, no edge — the pan did not draw anything.
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge')).toHaveCount(0)

  expect(errors).toEqual([])
})
