/**
 * React context for the {@link DataGateway} (spec §6.1: "the UI consumes the
 * gateway via React context + React Query"). The default provider hands out the
 * lazily-initialized OPFS-backed LocalGateway; tests inject an in-memory one.
 * The value is a *getter* returning a promise so first paint is never blocked by
 * the WASM download.
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { DataGateway } from '../gateway'
import { getGateway } from './gateway'

export type GatewayGetter = () => Promise<DataGateway>

const GatewayContext = createContext<GatewayGetter>(getGateway)

export function GatewayProvider({
  value = getGateway,
  children,
}: {
  value?: GatewayGetter
  children: ReactNode
}) {
  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook colocated with its provider
export function useGateway(): GatewayGetter {
  return useContext(GatewayContext)
}
