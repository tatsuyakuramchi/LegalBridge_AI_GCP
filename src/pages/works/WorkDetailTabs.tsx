/**
 * WorkDetailTabs — 作品詳細 8タブの器（設計 §10.4）。
 *
 *   ①概要 ②作品系譜 ③マテリアル ④権利根源 ⑤契約・条件 ⑥製品 ⑦文書・証憑 ⑧監査・完全性
 *
 * 8タブ移行 Phase 2:
 *   - ①概要 に現状の WorkGraphPanel を embedded で内包（機能は従来どおり①の下で動く）。
 *   - 自己完結パネル（workId のみで動く）を各タブへ移設:
 *       ⑤←RightsTreePanel / ⑦←WorkAttributionsPanel / ⑧←CompletenessPanel
 *   - ②③④⑥ は移行中（EmptyState）。以降のフェーズで①から中身を移設する。
 *
 * v3 write は admin-ui 現役依存のため、各パネルの API 呼び方は一切変えない（§20）。
 */
import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { WorkGraphPanel } from "@/src/pages/master/WorkGraphPanel";
import { RightsTreePanel } from "@/src/pages/master/RightsTreePanel";
import { WorkAttributionsPanel } from "@/src/components/work/WorkAttributionsPanel";
import { CompletenessPanel } from "@/src/components/dataquality/CompletenessPanel";

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

const MigratingPlaceholder: React.FC<{ label: string }> = ({ label }) => (
  <EmptyState
    title={`${label}は移行中です`}
    description="この区画は「① 概要」タブから順次移設します。編集は当面①概要で行えます。"
  />
);

export const WorkDetailTabs: React.FC<WorkDetailTabsProps> = ({ workId }) => {
  const [tab, setTab] = React.useState<TabKey>("overview");
  const hasWork = workId != null && workId !== "";

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
      <TabsList className="flex-wrap">
        {TABS.map((t) => (
          <TabsTrigger key={t.key} value={t.key}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview" className="pt-4">
        {/* ①概要: 現状の WorkGraphPanel を内包（内部ヘッダ/移設済パネルは非表示）。 */}
        <WorkGraphPanel embedded />
      </TabsContent>

      <TabsContent value="lineage" className="pt-4">
        <MigratingPlaceholder label="作品系譜" />
      </TabsContent>

      <TabsContent value="materials" className="pt-4">
        <MigratingPlaceholder label="マテリアル" />
      </TabsContent>

      <TabsContent value="rights-source" className="pt-4">
        <MigratingPlaceholder label="権利根源" />
      </TabsContent>

      <TabsContent value="contracts" className="pt-4">
        {hasWork ? (
          <RightsTreePanel workId={workId as string | number} />
        ) : (
          <EmptyState title="作品を選択してください" />
        )}
      </TabsContent>

      <TabsContent value="products" className="pt-4">
        <MigratingPlaceholder label="製品" />
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
  );
};

export default WorkDetailTabs;
