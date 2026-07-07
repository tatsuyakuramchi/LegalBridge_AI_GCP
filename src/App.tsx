import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"

import { ToastProvider } from "@/components/ui/toast"
import { AppDataProvider, DocumentSessionProvider } from "./context/AppDataContext"
import { MergeCartProvider } from "./context/MergeCartContext" // 課題統合カート
import { AppShell } from "./layout/AppShell"
import { DashboardPage } from "./pages/DashboardPage"
import { DocumentEditorPage } from "./pages/DocumentEditorPage"
import { RequestsPage } from "./pages/RequestsPage"
import { IssueDetailPage } from "./pages/IssueDetailPage" // データ構造刷新 Phase A
import { UnifiedIssuePage } from "./pages/UnifiedIssuePage" // 新課題(統一課題)UI
import { UnifiedIssuesListPage } from "./pages/UnifiedIssuesListPage" // 新課題 一覧
import { MattersListPage } from "./pages/MattersListPage" // 案件管理 一覧
import { MatterDetailPage } from "./pages/MatterDetailPage" // 案件管理 詳細
import { ConditionsHubPage } from "./pages/ConditionsHubPage" // データ構造刷新: 条件明細 統合ハブ
import { ConditionLineDetailPage } from "./pages/ConditionLineDetailPage" // データ構造刷新 Phase F
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
import { ReceivableMapPanel } from "./pages/master/ReceivableMapPanel" // 統合 P3-4
import { WorkModelPanel } from "./pages/master/WorkModelPanel" // 統合 P3-5
import { MaterialEntryPanel } from "./pages/master/MaterialEntryPanel" // 原作マテリアル登録
import { WorkGraphPanel } from "./pages/master/WorkGraphPanel" // 統合 Phase3c → /works/:id へ移設
import { WorksListPanel } from "./pages/works/WorksListPanel" // 作品統合 増分④: 統一一覧
import { TemplatesPage, TemplateEditorPage } from "./pages/TemplatesPage"
import { ImportPage } from "./pages/ImportPage"
import { GenericImportPage } from "./pages/GenericImportPage"
import { ExcelBatchPage } from "./pages/ExcelBatchPage"
import { DataLinkagePanel } from "./pages/DataLinkagePanel"
import { SettingsPage } from "./pages/SettingsPage"

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppDataProvider>
          <DocumentSessionProvider>
            <MergeCartProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="documents/new" element={<DocumentEditorPage />} />
                <Route path="imports" element={<ImportPage />} />
                <Route path="data-import" element={<GenericImportPage />} />
                <Route path="excel-batches" element={<ExcelBatchPage />} />
                {/* データ構造刷新: 検収待ちは条件明細ハブの検収待ちタブへ集約(旧URL温存) */}
                <Route path="pending-inspections" element={<Navigate to="/condition-lines?tab=inspections" replace />} />
                <Route path="requests" element={<RequestsPage />} />
                <Route path="issues/:issueKey" element={<IssueDetailPage />} />{/* データ構造刷新 Phase A */}
                <Route path="unified" element={<UnifiedIssuesListPage />} />{/* 新課題 一覧 */}
                <Route path="unified/:capabilityId" element={<UnifiedIssuePage />} />{/* 新課題(統一課題)UI */}
                <Route path="matters" element={<MattersListPage />} />{/* 案件管理 一覧 */}
                <Route path="matters/:matterId" element={<MatterDetailPage />} />{/* 案件管理 詳細 */}
                <Route path="condition-lines" element={<ConditionsHubPage />} />{/* データ構造刷新: 統合ハブ(Cockpit/検収待ち/横断検索) */}
                <Route path="condition-lines/:lineCode" element={<ConditionLineDetailPage />} />{/* データ構造刷新 Phase F */}
                <Route path="archive" element={<ArchivePage />} />

                <Route path="master" element={<MasterLayout />}>
                  <Route index element={<Navigate to="contracts" replace />} />
                  <Route path="contracts" element={<ContractsPanel />} />
                  <Route path="vendors" element={<VendorsPanel />} />
                  <Route path="materials" element={<MaterialEntryPanel />} />{/* 原作マテリアル登録 */}
                  <Route path="ledgers" element={<LedgersPanel />} />{/* Phase 22.18 */}
                  <Route path="sublicensees" element={<SubLicenseesPanel />} />{/* Phase 22.20-C */}
                  <Route path="ringi" element={<RingiPanel />} />{/* Phase 22.21.116 */}
                  <Route path="drafts" element={<DraftsPanel />} />{/* Phase 22.21.81 */}
                  {/* データ構造刷新: 条件明細 横断検索は条件明細ハブの検索タブへ集約(旧URL温存) */}
                  <Route path="conditions" element={<Navigate to="/condition-lines?tab=search" replace />} />
                  <Route path="receivable-map" element={<ReceivableMapPanel />} />{/* 統合 P3-4 */}
                  <Route path="work-model" element={<WorkModelPanel />} />{/* 統合 P3-5 */}
                  {/* 統合 増分④: 3カードエディタは /works/:id へ移設。旧URLは温存リダイレクト */}
                  <Route path="work-graph" element={<Navigate to="/works" replace />} />
                  <Route path="staff" element={<StaffPanel />} />
                  <Route path="rules" element={<RulesPanel />} />
                </Route>

                {/* 作品統合 増分④: 原作/自社作品 統一一覧 → 3カードエディタ(/works/:id) */}
                <Route path="works" element={<WorksListPanel />} />
                <Route path="works/:id" element={<WorkGraphPanel />} />

                <Route path="templates" element={<TemplatesPage />} />
                <Route path="templates/:id" element={<TemplateEditorPage />} />

                <Route path="data-linkage" element={<DataLinkagePanel />} />
                <Route path="settings" element={<SettingsPage />} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
            </MergeCartProvider>
          </DocumentSessionProvider>
        </AppDataProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
