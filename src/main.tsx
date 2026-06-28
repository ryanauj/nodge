import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import App from './App.tsx'
import { GatewayProvider } from './app/GatewayContext'
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <GatewayProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            {/* The active diagram is reflected in the URL (spec §11 — React Router
                for graph/board/view). `/` bootstraps/opens the active graph and
                redirects to its board/view; deep links open a specific one. */}
            <Route path="/" element={<App />} />
            <Route path="/board/:boardId/view/:viewId" element={<App />} />
          </Routes>
        </BrowserRouter>
      </GatewayProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
