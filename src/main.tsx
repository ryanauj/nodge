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
          {/* The active diagram is reflected in the URL (spec §11 — React Router
              for graph/board/view). A single catch-all route keeps one stable
              `<App/>` instance mounted for `/` and `/board/:boardId/view/:viewId`
              alike, so switching boards/views only changes the location (never a
              remount that would reset the canvas). The editor parses the path. */}
          <Routes>
            <Route path="*" element={<App />} />
          </Routes>
        </BrowserRouter>
      </GatewayProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
