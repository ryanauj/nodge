import { type ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GatewayProvider } from '../../app/GatewayContext'
import type { LocalGateway } from '../../gateway/LocalGateway'

/** Render a panel wired to a real in-memory gateway + a fresh React Query client. */
export function renderWithGateway(ui: ReactElement, gw: LocalGateway) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <GatewayProvider value={() => Promise.resolve(gw)}>{ui}</GatewayProvider>
    </QueryClientProvider>,
  )
}
