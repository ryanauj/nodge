import { useQuery } from '@tanstack/react-query'
import { useGateway } from './app/GatewayContext'
import { Editor } from './editor/Editor'
import { PaletteRoot } from './editor/PaletteRoot'
import { getChromePaletteId } from './editor/appSettings'
import { ACTIVE_GRAPH_KEY } from './editor/bootstrap'
import { DEFAULT_PALETTE_TOKENS } from './editor/style'
import type { PaletteTokens } from './model'
import './App.css'

/**
 * Phase 4: the app is wrapped in an **app-chrome `PaletteRoot`** (spec §8.4 —
 * the second of the two palette boundaries). The chrome palette is resolved from
 * an app-settings pointer (`nodge.chromePaletteId`, mirroring `activeGraphId`);
 * its tokens are projected as `--nodge-*` CSS variables so toolbars, panels and
 * dialogs theme from the palette. The per-view canvas palette is the other
 * boundary, applied inside the `<Editor/>`. Data still flows only through the
 * lazily-opened gateway and every mutation through the command layer.
 */
function App() {
  const getGateway = useGateway()

  // Resolve the chrome palette's tokens: the settings pointer if set, else the
  // active graph's first palette, else the built-in default. Lazy + tolerant so
  // first paint is never blocked and a missing pointer/graph still themes.
  const chrome = useQuery<PaletteTokens>({
    queryKey: ['chrome-palette'],
    queryFn: async () => {
      const gw = await getGateway()
      let graphId: string | null = null
      try {
        graphId = localStorage.getItem(ACTIVE_GRAPH_KEY)
      } catch {
        graphId = null
      }
      if (!graphId) {
        const graphs = await gw.listGraphs()
        graphId = graphs[0]?.id ?? null
      }
      if (!graphId) return DEFAULT_PALETTE_TOKENS
      const palettes = await gw.listPalettes(graphId)
      const pointer = getChromePaletteId()
      const chosen =
        (pointer && palettes.find((p) => p.id === pointer)) || palettes[0]
      return chosen?.tokens ?? DEFAULT_PALETTE_TOKENS
    },
    staleTime: 0,
  })

  return (
    <PaletteRoot
      tokens={chrome.data ?? DEFAULT_PALETTE_TOKENS}
      className="app-chrome"
      testId="app-chrome"
    >
      <Editor />
    </PaletteRoot>
  )
}

export default App
