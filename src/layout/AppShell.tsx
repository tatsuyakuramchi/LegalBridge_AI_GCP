import { Outlet } from "react-router-dom"

import { Sidebar } from "./Sidebar"
import { Topbar } from "./Topbar"
import { SkinProvider } from "@/src/lib/skin"
import { MergeCartPanel } from "@/src/components/backlog/MergeCartPanel"
import { MatterMergeCartPanel } from "@/src/components/matter/MatterMergeCartPanel"

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
        {/* 課題統合カート: どの画面からでも籠の中身を見ながら統合できる常駐パネル */}
        <MergeCartPanel />
        {/* 案件統合カート: 重複案件を集めて統合先を選び一括統合する常駐パネル */}
        <MatterMergeCartPanel />
      </div>
    </SkinProvider>
  )
}
