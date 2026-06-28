import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 4 e2e proofs (spec §12 acceptance):
 *   - the per-view canvas + the app-chrome are both wrapped in PaletteRoot
 *     boundaries that expose the palette's tokens as `--nodge-*` CSS variables;
 *   - applying a palette to the app chrome updates the chrome boundary's vars;
 *   - pinning a node's color survives a palette swap (the link/unlink affordance)
 *     while an unpinned node re-skins.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/** Open a dock panel into its bottom sheet (the single panel surface). */
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

test('palette boundaries expose CSS variables; chrome re-themes on apply', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add node' }).first()).toBeEnabled()

  // Both PaletteRoot boundaries are present and expose --nodge-* variables.
  const chromeVar = await page
    .getByTestId('app-chrome')
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--nodge-surface-raised').trim())
  expect(chromeVar).toMatch(/^#|rgb/)

  const canvasVar = await page
    .getByTestId('canvas-palette-root')
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--nodge-surface-canvas').trim())
  expect(canvasVar).toMatch(/^#|rgb/)

  // Apply a built-in palette (Midnight) to the app chrome via the palette editor
  // (hosted in the Palette sheet, opened from the dock).
  const paletteSheet = await openDockPanel(page, 'Palette', 'Palette')
  const editor = paletteSheet.getByRole('region', { name: 'Palette editor' })
  await expect(editor).toBeVisible()
  await editor.getByLabel('Edit palette').selectOption({ label: 'Midnight (built-in)' })
  await editor.getByRole('button', { name: 'Apply to chrome' }).click()

  // The chrome boundary now exposes the Midnight canvas color (#111827).
  await expect
    .poll(() =>
      page
        .getByTestId('app-chrome')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--nodge-surface-canvas').trim()),
    )
    .toBe('#111827')

  expect(errors).toEqual([])
})

test('pin a node color; it survives a palette swap while others re-skin', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')
  const addNode = page.getByRole('button', { name: 'Add node' }).first()
  await expect(addNode).toBeEnabled()

  // Two nodes; pin the first's surface, leave the second following the palette.
  await addNode.click()
  await addNode.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)

  // Select the first node → open the Properties sheet (Node style); pin surface.
  await page.locator('.react-flow__node').first().click()
  const propsSheet = await openDockPanel(page, 'Properties', 'Properties')
  const stylePanel = propsSheet.getByRole('region', { name: 'Node style' })
  await expect(stylePanel).toBeVisible()
  await stylePanel.getByLabel('Pin surface').click()
  // Set the pinned surface to a distinctive red.
  const surfaceInput = stylePanel.getByLabel('surface value')
  await expect(surfaceInput).toBeEnabled()
  await surfaceInput.fill('#ff0000')
  await expect(page.getByTestId('editor-busy')).toHaveCount(0)
  await closeSheet(page, 'Properties')

  // Swap the view palette to Midnight (unpinned nodes → #1f2937) via the Palette sheet.
  const paletteSheet = await openDockPanel(page, 'Palette', 'Palette')
  const palettePanel = paletteSheet.getByRole('region', { name: 'Palette', exact: true })
  await palettePanel.getByLabel('Canvas palette').selectOption({ label: 'Midnight' })

  // The pinned node keeps red; at least one node shows the Midnight surface.
  await expect
    .poll(async () => {
      const colors = await page
        .locator('.nodge-node')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))
      return colors
    })
    .toEqual(expect.arrayContaining(['rgb(255, 0, 0)', 'rgb(31, 41, 55)']))

  expect(errors).toEqual([])
})
