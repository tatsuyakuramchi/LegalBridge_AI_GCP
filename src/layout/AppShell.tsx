import { Outlet } from "react-router-dom"

import { Sidebar } from "./Sidebar"
import { Topbar } from "./Topbar"
import { SkinProvider } from "@/src/lib/skin"

export function AppShell() {
  return (
    <SkinProvider>
      <div className="flex min-h-screen bg-background text-foreground">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-x-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SkinProvider>
  )
}
