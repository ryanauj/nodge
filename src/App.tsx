import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getGateway } from './app/gateway'
import type { Graph } from './model'
import './App.css'

/**
 * Phase 0 has no editor UI yet — this shell just proves the data spine is wired
 * end to end through React Query and the lazily-initialized gateway. The canvas
 * arrives in Phase 1.
 */
function App() {
  const [activated, setActivated] = useState(false)
  const queryClient = useQueryClient()

  const graphs = useQuery<Graph[]>({
    queryKey: ['graphs'],
    queryFn: async () => (await getGateway()).listGraphs(),
    enabled: activated,
  })

  const createGraph = useMutation({
    mutationFn: async () => (await getGateway()).createGraph({ name: 'Untitled graph' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['graphs'] }),
  })

  return (
    <div className="app">
      <h1>nodes-plus-edges</h1>
      <p>A client-side flow diagram editor. Foundations (Phase 0) are in place.</p>
      {!activated ? (
        <button onClick={() => setActivated(true)}>Open local store</button>
      ) : (
        <>
          <button onClick={() => createGraph.mutate()} disabled={createGraph.isPending}>
            New graph
          </button>
          <ul>
            {(graphs.data ?? []).map((g) => (
              <li key={g.id}>{g.name}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default App
