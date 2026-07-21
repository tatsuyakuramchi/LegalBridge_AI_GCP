/**
 * WorkDetailTabs — 作品詳細 8タブの器（設計 §10.4）。
 *
 *   ①概要 ②作品系譜 ③マテリアル ④権利根源 ⑤契約・条件 ⑥製品 ⑦文書・証憑 ⑧監査・完全性
 *
 * 8タブ移行 Phase 6:
 *   旧 WorkGraphPanel（3カード 1866 行）を WorkDetailContext（state 基盤）＋タブ別 section へ
 *   分解し、各タブに中身を物理配置した。
 *     ①概要=WorkOverviewSection（基本情報＋系譜・派生の編集／原作の uses・新規）
 *     ②作品系譜=WorkLineageSection（派生元／派生作品の read ビュー）
 *     ③マテリアル=WorkMaterialsSection（履行条件サマリ／原作構成ツリー／素材一覧・追加）
 *     ④権利根源=WorkRightsSourceSection（原作/調達＝支払 upstream／原作新規）
 *     ⑤契約・条件=RightsTreePanel＋WorkConditionsSection（原作ピッカー／条件明細参照リンク）
 *     ⑥製品=WorkProductsSection（製品一覧・追加／受取 downstream）
 *     ⑦文書・証憑=WorkAttributionsPanel（自己完結）
 *     ⑧監査・完全性=CompletenessPanel（自己完結）
 *
 * v3 write は admin-ui 現役依存のため、各 section の API 呼び方は一切変えない（§20）。
 */
import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { RightsTreePanel } from "@/src/pages/master/RightsTreePanel";
import { WorkAttributionsPanel } from "@/src/components/work/WorkAttributionsPanel";
import { CompletenessPanel } from "@/src/components/dataquality/CompletenessPanel";
import { WorkDetailProvider } from "./WorkDetailContext";
import { WorkOverviewSection } from "./sections/WorkOverviewSection";
import { WorkLineageSection } from "./sections/WorkLineageSection";
import { WorkMaterialsSection } from "./sections/WorkMaterialsSection";
import { WorkRightsSourceSection } from "./sections/WorkRightsSourceSection";
import { WorkConditionsSection } from "./sections/WorkConditionsSection";
import { WorkProductsSection } from "./sections/WorkProductsSection";

export interface WorkDetailTabsProps {
  workId?: string | number;
}

type TabKey =
  | "overview"
  | "lineage"
  | "materials"
  | "rights-source"
  | "contracts"
  | "products"
  | "documents"
  | "audit";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "① 概要" },
  { key: "lineage", label: "② 作品系譜" },
  { key: "materials", label: "③ マテリアル" },
  { key: "rights-source", label: "④ 権利根源" },
  { key: "contracts", label: "⑤ 契約・条件" },
  { key: "products", label: "⑥ 製品" },
  { key: "documents", label: "⑦ 文書・証憑" },
  { key: "audit", label: "⑧ 監査・完全性" },
];

export const WorkDetailTabs: React.FC<WorkDetailTabsProps> = ({ workId }) => {
  const [tab, setTab] = React.useState<TabKey>("overview");
  const hasWork = workId != null && workId !== "";

  return (
    <WorkDetailProvider routeId={workId != null ? String(workId) : undefined}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <WorkOverviewSection />
        </TabsContent>

        <TabsContent value="lineage" className="pt-4">
          <WorkLineageSection />
        </TabsContent>

        <TabsContent value="materials" className="pt-4">
          <WorkMaterialsSection />
        </TabsContent>

        <TabsContent value="rights-source" className="pt-4">
          <WorkRightsSourceSection />
        </TabsContent>

        <TabsContent value="contracts" className="pt-4 space-y-5">
          {hasWork ? (
            <RightsTreePanel workId={workId as string | number} />
          ) : (
            <EmptyState title="作品を選択してください" />
          )}
          <WorkConditionsSection />
        </TabsContent>

        <TabsContent value="products" className="pt-4">
          <WorkProductsSection />
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          {hasWork ? (
            <WorkAttributionsPanel workId={workId as string | number} />
          ) : (
            <EmptyState title="作品を選択してください" />
          )}
        </TabsContent>

        <TabsContent value="audit" className="pt-4">
          {hasWork ? (
            <CompletenessPanel entityType="work" entityId={workId} />
          ) : (
            <EmptyState title="作品を選択してください" />
          )}
        </TabsContent>
      </Tabs>
    </WorkDetailProvider>
  );
};

export default WorkDetailTabs;
