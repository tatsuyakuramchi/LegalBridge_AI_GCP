import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"

import { ToastProvider } from "@/components/ui/toast"
import { AppDataProvider, DocumentSessionProvider } from "./context/AppDataContext"
import { AppShell } from "./layout/AppShell"
import { DashboardPage } from "./pages/DashboardPage"
import { DocumentEditorPage } from "./pages/DocumentEditorPage"
import { RequestsPage } from "./pages/RequestsPage"
import { ArchivePage } from "./pages/ArchivePage"
import { MasterLayout } from "./pages/master/MasterLayout"
import { ContractsPanel } from "./pages/master/ContractsPanel"
import { VendorsPanel } from "./pages/master/VendorsPanel"
import { StaffPanel } from "./pages/master/StaffPanel"
import { RulesPanel } from "./pages/master/RulesPanel"
import { TemplatesPage, TemplateEditorPage } from "./pages/TemplatesPage"
import { ImportPage } from "./pages/ImportPage"
import { SettingsPage } from "./pages/SettingsPage"

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppDataProvider>
          <DocumentSessionProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="documents/new" element={<DocumentEditorPage />} />
                <Route path="imports" element={<ImportPage />} />
                <Route path="requests" element={<RequestsPage />} />
                <Route path="archive" element={<ArchivePage />} />

                <Route path="master" element={<MasterLayout />}>
                  <Route index element={<Navigate to="contracts" replace />} />
                  <Route path="contracts" element={<ContractsPanel />} />
                  <Route path="vendors" element={<VendorsPanel />} />
                  <Route path="staff" element={<StaffPanel />} />
                  <Route path="rules" element={<RulesPanel />} />
                </Route>

                <Route path="templates" element={<TemplatesPage />} />
                <Route path="templates/:id" element={<TemplateEditorPage />} />

                <Route path="settings" element={<SettingsPage />} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </DocumentSessionProvider>
        </AppDataProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
