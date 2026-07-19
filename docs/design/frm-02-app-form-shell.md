# FRM-02: 共通フォーム基盤 AppFormShell

全UIリニューアル（EPIC-UIC-01）の土台。マスタ/業務フォームがページ独自の `Field()`・
保存ボタン・生 input を新設せず（設計 §11.3 禁止事項）、共通の primitive を使うための基盤。
状態色は UIC-24 のトークン（success/warning/info/destructive/severity-*）に統一。

## 提供コンポーネント（第1弾）

`src/components/form/`（`@/src/components/form` から import）:

| コンポーネント | 責務（設計 §11.2） |
|---|---|
| `AppFormShell` | 最大幅・本体＋右パネル（aside）・レスポンシブ・**readonly は fieldset[disabled]**（true readonly, UIC-06 と同方針）・onSubmit・アクションバー配置 |
| `AppFormField` | ラベル / 必須・推奨・任意 / 状態Badge（導出・引用・確認済・要確認）/ 説明 / [コントロール] 単位 / エラー・警告・hint を §11.4 の順序で表示 |
| `ValidationSummary` | エラー・警告の集約。項目クリックで `fieldId` へフォーカス移動（toast だけに頼らない §11.3） |
| `StickyActionBar` | 保存状態 / 主操作 / 二重送信防止（saving 中は無効化）/ 破壊操作の隔離 |

**DataQualityPanel** は既存の `@/src/components/dataquality/CompletenessPanel` を `aside` に流用する。
**FormSection** は既存の `@/src/components/document/FormSection` を使う。

## 使い方（マスタ/業務フォームの標準形）

```tsx
import { AppFormShell, AppFormField, ValidationSummary, StickyActionBar } from "@/src/components/form";
import { Input } from "@/components/ui/input";
import { CompletenessPanel } from "@/src/components/dataquality/CompletenessPanel";

function VendorForm({ mode }: { mode: "create" | "edit" | "readonly" }) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const issues = validate(v); // ValidationIssue[]

  return (
    <AppFormShell
      mode={mode}
      aside={<CompletenessPanel entityType="vendor" entityId={v.id} />}
      onSubmit={save}
      actionBar={
        <StickyActionBar
          dirty={dirty}
          saving={saving}
          primary={{ label: "保存", onClick: save, disabled: issues.some(i => i.level === "error") }}
          danger={mode === "edit" ? { label: "削除", onClick: remove } : undefined}
        />
      }
    >
      <ValidationSummary issues={issues} />
      <AppFormField label="取引先名" htmlFor="vendor_name" required error={errof("vendor_name")}>
        <Input id="vendor_name" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} />
      </AppFormField>
    </AppFormShell>
  );
}
```

## 設計上の担保

- **true readonly**: `mode="readonly"` は `<fieldset disabled>` で入力不可（テキスト選択・コピーは可）。
- **二重送信防止**: `StickyActionBar` は `saving` 中に主操作・副操作を無効化。
- **状態を画面に残す**: `ValidationSummary` を常設し、toast だけの通知を避ける。
- **aria**: `AppFormField` は label/htmlFor・description(`-desc`)・error(`-err`, role=alert) を紐付け。

## 次（FRM-06〜11）

実フォームを段階移行して API を実地検証・洗練する:
- FRM-06: Works / Material / Work Family / Rights Source
- FRM-07: Vendor / Staff / Ringi / Routing（**Staff 済**: `StaffPanel` の page-local `Field()` を
  `AppFormField` へ、必須氏名を `ValidationSummary` へ。§11.3 の禁止パターンを解消し API を実地検証）
- FRM-08: Matter / Task / Delivery / Inspection（業務処理フォーム型）
- FRM-09: 利用許諾計算・受領・支払・分配（Finance）
- FRM-10: Import / Merge / Unlinked / Migration / Draft（管理者フォーム型）
- FRM-11: Dialog / Drawer / インライン追加（compact 版）

移行時に必要になり次第、`FormHeader` / `ContextSummary` / `EntityCombobox` / `LineEditor` /
`RelatedDataPanel` / `DangerZone` を本基盤へ追加する。
