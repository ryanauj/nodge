import { Editor } from './editor/Editor'

/**
 * Phase 1: the app *is* the editor — a single canvas-first surface for one
 * board / one view. Data flows only through the gateway (lazily opened) and
 * every mutation through the command layer.
 */
function App() {
  return <Editor />
}

export default App
