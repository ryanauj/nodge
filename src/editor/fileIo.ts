/**
 * Save-to-file / load-from-file (spec §6.4, Decision 13).
 *
 * "Save" serializes the active graph to a downloadable `.nodge.json`. "Load"
 * reads a `.nodge.json` (migrating + validating it), imports it into the live
 * SQLite runtime, and returns the new active graph id so the canvas can reopen
 * it. The DOM-touching bits (anchor download, file read) are thin wrappers over
 * the pure gateway/io functions, which the tests exercise directly.
 */

import type { DataGateway, Uuid } from '../gateway'
import { readDocument, serializeDocument } from '../io'

/** Suggested filename for a graph's export. */
export function exportFileName(graphName: string): string {
  const slug = graphName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug || 'diagram'}.nodge.json`
}

/** Serialize a graph to the `.nodge.json` text payload. */
export async function exportGraphText(gw: DataGateway, graphId: Uuid): Promise<string> {
  return serializeDocument(await gw.exportJson(graphId))
}

/**
 * Import a `.nodge.json` text payload into the gateway's live store, replacing
 * its contents, and return the imported graph's id (the new active graph).
 */
export async function importGraphText(gw: DataGateway, text: string): Promise<Uuid> {
  const doc = readDocument(JSON.parse(text))
  const graph = await gw.importJson(doc)
  return graph.id
}

/** Trigger a browser download of the given text as a file. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Open the OS file picker and resolve with the chosen file's text (or null). */
export function pickTextFile(accept = '.json,.nodge.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    }
    input.click()
  })
}
