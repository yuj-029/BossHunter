import { useEffect, useRef, useState } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import DashboardPage, { JobsPage, MonitorPage } from './pages/DashboardPage'
import ConfigPage from './pages/ConfigPage'

function AppLayout() {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)

  useEffect(() => {
    setMobileNavigationOpen(false)
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar mobileOpen={mobileNavigationOpen} onNavigate={() => setMobileNavigationOpen(false)} />
      {mobileNavigationOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setMobileNavigationOpen(false)}
          aria-label="关闭导航"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenNavigation={() => setMobileNavigationOpen(true)} />
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto p-3 md:p-6">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/jobs', element: <JobsPage /> },
      { path: '/monitor', element: <MonitorPage /> },
      { path: '/config', element: <ConfigPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
