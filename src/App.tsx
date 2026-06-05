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
import { LedgersPanel } from "./pages/master/LedgersPanel" // Phase 22.18
import { SubLicenseesPanel } from "./pages/master/SubLicenseesPanel" // Phase 22.20-C
import { RingiPanel } from "./pages/master/RingiPanel" // Phase 22.21.116
import { DraftsPanel } from "./pages/master/DraftsPanel" // Phase 22.21.81
import { ConditionsPanel } from "./pages/master/ConditionsPanel" // 統合 P3-2
import { SublicensePanel } from "./pages/master/SublicensePanel" // 統合 P3-3
import { ReceivableMapPanel } from "./pages/master/ReceivableMapPanel" // 統合 P3-4
import { WorkModelPanel } from "./pages/master/WorkModelPanel" // 統合 P3-5
import { TemplatesPage, TemplateEditorPage } from "./pages/TemplatesPage"
import { ImportPage } from "./pages/ImportPage"
import { ExcelBatchPage } from "./pages/ExcelBatchPage"
import { PendingInspectionsPage } from "./pages/PendingInspectionsPage"
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
                <Route path="excel-batches" element={<ExcelBatchPage />} />
                <Route path="pending-inspections" element={<PendingInspectionsPage />} />
                <Route path="requests" element={<RequestsPage />} />
                <Route path="archive" element={<ArchivePage />} />

                <Route path="master" element={<MasterLayout />}>
                  <Route index element={<Navigate to="contracts" replace />} />
                  <Route path="contracts" element={<ContractsPanel />} />
                  <Route path="vendors" element={<VendorsPanel />} />
                  <Route path="ledgers" element={<LedgersPanel />} />{/* Phase 22.18 */}
                  <Route path="sublicensees" element={<SubLicenseesPanel />} />{/* Phase 22.20-C */}
                  <Route path="ringi" element={<RingiPanel />} />{/* Phase 22.21.116 */}
                  <Route path="drafts" element={<DraftsPanel />} />{/* Phase 22.21.81 */}
                  <Route path="conditions" element={<ConditionsPanel />} />{/* 統合 P3-2 */}
                  <Route path="sublicense" element={<SublicensePanel />} />{/* 統合 P3-3 */}
                  <Route path="receivable-map" element={<ReceivableMapPanel />} />{/* 統合 P3-4 */}
                  <Route path="work-model" element={<WorkModelPanel />} />{/* 統合 P3-5 */}
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
