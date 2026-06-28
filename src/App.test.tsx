import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect } from 'vitest'
import App from './App'

function renderApp() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

describe('App', () => {
  it('renders the repo heading', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: 'nodes-plus-edges' })).toBeInTheDocument()
  })

  it('does not initialize the data store on first paint', () => {
    renderApp()
    // The gateway/SQLite engine is opened lazily — only after activation.
    expect(screen.getByRole('button', { name: 'Open local store' })).toBeInTheDocument()
  })
})
