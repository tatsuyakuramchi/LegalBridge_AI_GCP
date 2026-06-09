import * as React from "react"
import { Plus, Search, Edit2, Trash2, ExternalLink, RefreshCw } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { NativeSelect } from "@/components/ui/native-select"
// Phase 22.21.115: 稟議番号 selector (発注書・個別利用許諾と同 UI)
import { RingiSelector } from "@/src/components/document/RingiSelector"
import {
  CALC_TYPE_OPTIONS,
  calcMethodFromType,
  buildFormulaText,
} from "@/src/components/document/FinancialConditionTable"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// Phase 22.21.46: DB から返ってきた auto_renewal の型ゆらぎ ('t'/'f'/'true'/1/etc)
//   を Boolean に正規化する。Switch 等の制御コンポーネントが期待する型に揃える。
const toBool = (v: any): boolean =>
  v === true || v === "t" || v === "true" || v === 1 || v === "1";

// Phase 22.21.66: contract_status (5 段階) を日本語ラベル + Badge variant に。
//   draft               作成中
//   awaiting_signature  締結待ち
//   executed            締結中 (= 締結済)
//   expired             満了
//   terminated          解約済
const STATUS_OPTIONS = [
  { value: "draft", label: "作成中" },
  { value: "awaiting_signature", label: "締結待ち" },
  { value: "executed", label: "締結中" },
  { value: "expired", label: "満了" },
  { value: "terminated", label: "解約済" },
] as const

const statusToLabel = (v: any): string => {
  const opt = STATUS_OPTIONS.find((o) => o.value === v)
  return opt?.label || String(v || "—")
}
const statusToVariant = (v: any): "success" | "phosphor" | "warning" | "destructive" | "outline" => {
  switch (v) {
    case "executed": return "success"
    case "awaiting_signature": return "warning" as any
    case "draft": return "phosphor"
    case "expired": return "outline"
    case "terminated": return "destructive"
    default: return "outline"
  }
}

// Phase 22.21.51 / 22.21.52: worker と完全に同じロジックで prefix を予測表示。
//   ledger_code が紐付いた license + 個別/単独 の場合は新フォーマット
//   "LIC-{ledger_code}-ILT-NNNN" を返す。それ以外は従来通り ARC-<TYPE>-YYYY-NNNN
//   の prefix 文字列を返す。
const previewDocPrefix = (
  category: any,
  recordType: any,
  ledgerCode?: any
): string => {
  const cat = String(category || "").toLowerCase();
  const isIndividualLike =
    recordType === "individual_contract" ||
    recordType === "standalone_contract" ||
    recordType === "license_condition";
  const ledger = String(ledgerCode || "").trim();
  if (cat === "license" && isIndividualLike && ledger) {
    // ledger ベース ILT 採番
    return `LIC-${ledger}-ILT-NNNN`;
  }
  if (cat === "license") return isIndividualLike ? "ILT" : "LIC";
  if (cat === "publication") return "PUB";
  // service or unknown
  return isIndividualLike ? "OUT" : "SVC";
};

// Phase 22.21.46: alert_slack_channels / alert_slack_mentions は DB で JSONB 配列
//   として保存される。fetched 値は array で来るが、フォーム編集中は string[] と
//   array を行き来する。表示用テキスト ↔ 配列の往復用 helper。
const arrToText = (v: any): string => {
  if (!v) return "";
  if (Array.isArray(v)) return v.join("\n");
  // 既に string ならそのまま返す (PG の jsonb -> string になっているケース対策)
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed.join("\n") : String(v);
  } catch {
    return String(v);
  }
};
const textToArr = (s: string): string[] =>
  String(s || "")
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

const empty = {
  vendor_id: "",
  record_type: "master_contract",
  contract_category: "service",
  contract_type: "service_basic",
  contract_title: "",
  document_number: "",
  contract_status: "executed",
  effective_date: "",
  expiration_date: "",
  auto_renewal: false,
  // Phase 20: 自動更新契約の通告期限アラート用 (auto_renewal=true のみ意味あり)
  renewal_notice_months: "",
  alert_lead_months: "",
  original_work: "",
  product_name: "",
  work_name: "",
  media: "",
  territory: "",
  language: "",
  document_url: "",
  condition_number: "",
  // Phase 22.9: 有効/無効。発注書/個別利用許諾条件書/個別出版条件書の
  // 自動補完で参照される基本契約の候補に含むかどうか (= primary filter)。
  is_active: true,
  // Phase 22.21.46: Slack アラート設定 (複数チャンネル / 複数メンション)
  alert_slack_channels: [] as string[],
  alert_slack_mentions: [] as string[],
  // Phase 22.21.49: 強制再発番フラグ。「🔄 再発番」ボタンで true にセットして
  // 保存すると、worker は document_number の値を無視して新規発番する。
  // 保存後に worker レスポンスから受け取った新番号で reset。
  regenerate_document_number: false,
  // Phase 22.21.52: 原作 (ledger) 紐付け。ライセンス系の 個別/単独 契約で
  // 設定すると、LIC-{ledger_code}-ILT-NNNN 形式で採番される。
  ledger_code: "",
  // Phase 22.21.91: 金銭条件 (ライセンス系の単独/個別契約で「個別利用許諾条件書」
  //   と同形の条件配列)。区分は方向中立(条件 1=製造ベース / 2=サブライセンス・再許諾 / 3=プロダクト)。
  //   後段の「利用許諾計算書」フォームから自動補完用に参照される。
  financial_conditions: [] as any[],
  // Phase 22.21.112: 業務明細 (業務委託系の単独/個別契約で「発注書 業務明細」
  //   と同形の明細配列)。後段の「検収書」フォームから order_lines_for_inspection
  //   として自動補完用に参照される。
  line_items: [] as any[],
  // Phase 23.6.14: 経費 (capability_expenses) / その他手数料 (capability_other_fees)。
  //   業務委託系の単独/個別契約で、発注書フォームと同 shape の経費・手数料を
  //   入力できる。検収書フォームの「ステップ2-b 経費精算」「ステップ2-c その他手数料」
  //   で自動補完用に参照される。
  expenses: [] as any[],
  other_fees: [] as any[],
  // Phase 22.21.115: 稟議番号 (発注書・個別利用許諾と同じ shape: 5 桁数字の配列)。
  //   保存時に Worker 側で ringi_documents テーブルに N:N リンクされる。
  ringi_numbers: [] as string[],
  // 請求の向き(2択)。文書作成フォームと同じ in/out。保存時に
  //   contract_capabilities.flow_direction へ記録する(out=当社受領→請求台帳)。
  //   purpose_code は後方互換のため残置(UI からは設定しない)。
  purpose_code: "",
  flow_direction: "",
  // 成果物の権利帰属(当社/相手方/共有)。帰属=相手方のとき利用許諾料の入力を促す。
  deliverable_ownership: "",
}

// 金銭条件エディタの区分は「条件番号 + 任意の条件名称」で表す。
//   旧来の固定意味(1=製造ベース / 2=サブライセンス / 3=プロダクト)は廃止し、
//   出版/電子出版のように同じ計算ロジックの条件を複数並べられるようにした。
//   condition_no は付番(順序・一意キー)であり、意味は condition_name で表現する。

const PERIOD_KIND_OPTIONS = [
  { value: "MANUFACTURING", label: "製造ごと" },
  { value: "MONTHLY", label: "月次" },
  { value: "QUARTERLY", label: "四半期" },
  { value: "SEMIANNUAL", label: "半期" },
  { value: "ANNUAL", label: "年次" },
] as const

export function ContractsPanel() {
  const { contracts, vendors, ledgers, refreshContracts, showNotification } = useAppData()
  const [search, setSearch] = React.useState("")
  const [editing, setEditing] = React.useState<any>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(empty)


  const filtered = contracts.filter((c) => {
    const q = search.toLowerCase()
    return (
      (c.contract_title && c.contract_title.toLowerCase().includes(q)) ||
      (c.vendor_name && c.vendor_name.toLowerCase().includes(q)) ||
      (c.document_number && c.document_number.toLowerCase().includes(q)) ||
      (c.original_work && c.original_work.toLowerCase().includes(q)) ||
      (c.product_name && c.product_name.toLowerCase().includes(q))
    )
  })

  const open = !!editing || creating
  const data = creating ? draft : editing
  const set = (patch: any) => {
    if (creating) setDraft({ ...draft, ...patch })
    else setEditing({ ...editing, ...patch })
  }
  const close = () => {
    setEditing(null)
    setCreating(false)
    setDraft(empty)
  }

  const [saving, setSaving] = React.useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const isEdit = !!data?.id
      const url = isEdit ? `/api/master/contracts/${data.id}` : "/api/master/contracts"
      // Phase 22.21.49: 再発番フラグの正規化。boolean のまま送れば worker は
      //   regenerate_document_number === true で判定する。
      const payload = {
        ...data,
        regenerate_document_number: !!data?.regenerate_document_number,
      }
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        // Phase 22.21.49: worker レスポンスに新規発番された document_number が
        //   含まれていれば、ユーザーに通知して何番が振られたか視覚化する。
        let savedDoc: any = null
        try {
          savedDoc = await res.json()
        } catch {}
        const newDocNo = savedDoc?.document_number || ""
        const wasAuto = !!savedDoc?.document_number_auto
        const wasRegen = !!savedDoc?.document_number_regenerated;
        // Phase 22.21.60: archive_propagation を toast に反映。
        //   - 成功 (documents_updated > 0) → 通知に件数を併記
        //   - conflict 発生 → エラー風の警告通知で詳細を表示
        const propag = savedDoc?.archive_propagation as
          | {
              old: string
              new: string
              documents_updated: number
              assets_updated: number
              conflict?: string
            }
          | null
          | undefined
        let propagSuffix = ""
        if (propag && propag.old && propag.new && propag.old !== propag.new) {
          if (propag.conflict) {
            propagSuffix = ` (⚠ ${propag.old} → ${propag.new}: ${propag.conflict})`
          } else if (propag.documents_updated > 0 || propag.assets_updated > 0) {
            propagSuffix =
              ` (アーカイブ同期: ${propag.old} → ${propag.new}, ` +
              `documents ${propag.documents_updated} 件 / external_assets ${propag.assets_updated} 件)`
          }
        }
        if (wasAuto || wasRegen) {
          showNotification(
            `${isEdit ? "契約情報を更新しました" : "契約情報を追加しました"}` +
              (newDocNo ? ` (文書番号: ${newDocNo}${wasRegen ? " ← 再発番" : " ← 自動発番"})` : "") +
              propagSuffix,
            propag?.conflict ? "error" : "success"
          )
        } else {
          showNotification(
            (isEdit ? "契約情報を更新しました" : "契約情報を追加しました") +
              propagSuffix,
            propag?.conflict ? "error" : "success"
          )
        }
        await refreshContracts()
        close()
      } else {
        // Phase 22.21.102: 409 = document_number 重複。専用メッセージで分かりやすく
        let body: any = null
        try {
          body = await res.json()
        } catch {}
        if (res.status === 409 && body?.code === "DOC_NUMBER_DUPLICATE") {
          showNotification(
            body.error ||
              `文書番号 ${body.document_number} は既に登録されています`,
            "error"
          )
        } else {
          const detail = body?.error ? `: ${body.error}` : ""
          showNotification(
            `保存に失敗しました (HTTP ${res.status})${detail}`,
            "error"
          )
        }
      }
    } catch (e: any) {
      showNotification(`サーバーエラー: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    if (!confirm("この契約情報を削除しますか？")) return
    const res = await fetch(`/api/master/contracts/${id}`, { method: "DELETE" })
    if (res.ok) {
      showNotification("削除しました", "success")
      await refreshContracts()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="契約タイトル、取引先、原作、管理番号で検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          onClick={() => {
            setDraft({ ...empty, vendor_id: vendors[0]?.id || "" })
            setCreating(true)
            setEditing(null)
          }}
        >
          <Plus />
          契約情報を追加
        </Button>
      </div>

      <div className="border border-border rounded-md overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>契約タイトル / 管理番号</TableHead>
              <TableHead>取引先</TableHead>
              <TableHead>区分</TableHead>
              <TableHead>スコープ</TableHead>
              <TableHead>有効期限</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={`contract-${c.id}`}>
                <TableCell>
                  <div className="font-bold truncate max-w-[280px]">{c.contract_title}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge variant="outline" className="h-4">
                      {c.document_number || "N/A"}
                    </Badge>
                    <Badge
                      variant={statusToVariant(c.contract_status)}
                      className="h-4"
                    >
                      {statusToLabel(c.contract_status)}
                    </Badge>
                    {/* Phase 22.9: 有効/無効バッジ — 自動補完候補に含まれるかどうか */}
                    <Badge
                      variant={c.is_active === false ? "phosphor" : "success"}
                      className={c.is_active === false ? "h-4 opacity-60" : "h-4"}
                    >
                      {c.is_active === false ? "無効" : "有効"}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="font-bold">{c.vendor_name || "未設定"}</TableCell>
                <TableCell className="space-y-1 text-[10px]">
                  <Badge variant="info" className="h-4">{c.record_type}</Badge>
                  <div>
                    <Badge variant="phosphor" className="h-4">{c.contract_category}</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-[10px] space-y-0.5 text-muted-foreground">
                  {c.original_work && (
                    <div>
                      <span className="opacity-50">作品:</span>{" "}
                      <span className="font-bold">{c.original_work}</span>
                    </div>
                  )}
                  {c.product_name && (
                    <div>
                      <span className="opacity-50">製品:</span> {c.product_name}
                    </div>
                  )}
                  {c.territory && (
                    <div>
                      <span className="opacity-50">地域:</span> {c.territory}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-[10px]">
                  <div className="font-mono">
                    {c.effective_date ? c.effective_date.substring(0, 10) : "未設定"}
                  </div>
                  <div className="font-mono">
                    〜 {c.expiration_date ? c.expiration_date.substring(0, 10) : "無期限"}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        c.auto_renewal ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                    />
                    <span className="text-muted-foreground">
                      {c.auto_renewal ? "自動更新あり" : "更新なし"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {c.document_url && (
                      <a
                        href={c.document_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center border border-border rounded-sm hover:bg-muted text-muted-foreground"
                        title="原本"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(c)
                        setCreating(false)
                      }}
                    >
                      <Edit2 />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      onClick={() => remove(c.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="p-12 text-center text-muted-foreground">
                  登録された契約情報がありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {creating ? "新規契約情報の登録" : "契約情報の編集"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto">
            <Field label="取引先 *">
              {/* Phase 22.21.111: vendor が多くてプルダウンが辛い問題に対処。
                  検索可能なインライン picker に置き換え。 */}
              <VendorPicker
                value={data?.vendor_id || ""}
                onChange={(id) => set({ vendor_id: id })}
                vendors={vendors}
              />
            </Field>
            {/* Phase 22.21.50: レコード区分の整理
                - 基本契約: 親契約 (top-level)。単体では発注書/計算書を発行しない。
                - 個別契約: 基本契約の子。利用許諾計算書/検収書の発行ロジック対象。
                - 単独契約: 親契約を持たない単独構成。個別契約と同じく計算/発行可能。
                旧 license_condition は legacy として個別契約扱いで読み込む。 */}
            <Field label="レコード区分">
              <NativeSelect
                value={
                  // legacy license_condition は表示上 individual_contract と同じ
                  // "個別契約" 系として扱う。保存時はそのまま legacy 値で出ていく。
                  data?.record_type === "license_condition"
                    ? "license_condition"
                    : data?.record_type || "master_contract"
                }
                onChange={(e) => set({ record_type: e.target.value })}
              >
                <option value="master_contract">基本契約 (親)</option>
                <option value="individual_contract">個別契約 (子)</option>
                <option value="standalone_contract">単独契約 (単体)</option>
                {/* 旧データを上書き表示で消さないよう、選択中だけ legacy 候補を出す */}
                {data?.record_type === "license_condition" && (
                  <option value="license_condition">個別契約 (旧: 個別ライセンス)</option>
                )}
              </NativeSelect>
              <p className="text-[10px] font-mono text-muted-foreground mt-1 leading-relaxed">
                <strong>基本契約</strong>: 親(top-level)。発注書の参照元。<br />
                <strong>個別契約</strong>: 基本契約の子。利用許諾計算書/検収書 発行可能。<br />
                <strong>単独契約</strong>: 親無し。個別契約と同じく計算/発行可能。
              </p>
            </Field>
            <Field label="カテゴリ">
              <NativeSelect
                value={data?.contract_category || "service"}
                onChange={(e) => set({ contract_category: e.target.value })}
              >
                <option value="service">業務委託・サービス</option>
                <option value="license">ライセンス・知的財産</option>
                <option value="mixed">複合（業務委託＋ライセンス）</option>
                <option value="sales">売買・プロダクト</option>
                <option value="publication">出版関連</option>
                <option value="nda">NDA・機密保持</option>
              </NativeSelect>
              <p className="text-[10px] font-mono text-muted-foreground mt-1 leading-relaxed">
                <strong>複合</strong>: 制作対価(業務明細)と利用許諾料(金銭条件)を
                1 本で扱う場合に選択。両方のエディタが表示されます。
              </p>
            </Field>
            {/* 請求の向き(2択) — 文書作成フォームと同じ in/out。
                out=当社受領→請求台帳。purpose マスターの多数選択は廃止し2択に統一。 */}
            <Field label="請求の向き">
              <NativeSelect
                value={data?.flow_direction || ""}
                onChange={(e) => set({ flow_direction: e.target.value })}
              >
                <option value="">— 請求の向きを選択 —</option>
                <option value="in">当社が払う（支払・仕入・ライセンスイン）</option>
                <option value="out">当社が受け取る（請求・販売・ライセンスアウト）</option>
              </NativeSelect>
              <p className="text-[10px] font-mono text-muted-foreground mt-1 leading-relaxed">
                方向:{" "}
                {data?.flow_direction === "in"
                  ? "IN（当社が支払う側）"
                  : data?.flow_direction === "out"
                  ? "OUT（当社が受領する側 → 請求台帳へ）"
                  : "未設定"}
              </p>
            </Field>
            {/* 成果物の権利帰属。帰属=相手方のとき、当社は利用許諾料を払って使う
                構図になりやすいので利用許諾料(金銭条件)の入力を促す。 */}
            <Field label="成果物の権利帰属">
              <NativeSelect
                value={data?.deliverable_ownership || ""}
                onChange={(e) => set({ deliverable_ownership: e.target.value })}
              >
                <option value="">— 未設定 —</option>
                <option value="company">当社に帰属</option>
                <option value="counterparty">相手方に帰属</option>
                <option value="shared">共有</option>
              </NativeSelect>
              {data?.deliverable_ownership === "counterparty" && (
                <p className="text-[10px] font-mono text-amber-700 mt-1 leading-relaxed">
                  成果物が相手方帰属です。制作対価に加えて<strong>利用許諾料</strong>が
                  発生する場合は、カテゴリを「複合」にして金銭条件にも登録してください。
                </p>
              )}
            </Field>
            <Field label="契約書名 *" className="col-span-2">
              <Input
                value={data?.contract_title || ""}
                onChange={(e) => set({ contract_title: e.target.value })}
                placeholder="例：基本システム開発業務委託契約書"
              />
            </Field>
            <Field label="管理番号">
              <div className="flex items-center gap-2">
                <Input
                  value={data?.document_number || ""}
                  onChange={(e) =>
                    set({
                      document_number: e.target.value,
                      // 手動で値を編集したら再発番フラグは降ろす
                      regenerate_document_number: false,
                    })
                  }
                  placeholder="空欄なら自動発番 (例 ARC-SVC-2026-0001)"
                  disabled={!!data?.regenerate_document_number}
                  className={
                    data?.regenerate_document_number
                      ? "line-through opacity-60"
                      : ""
                  }
                />
                {/* Phase 22.21.49: 「🔄 再発番」ボタン。
                    クリックすると document_number = "" にした上で
                    regenerate_document_number=true をセット。
                    保存時に worker は強制的に新しい番号を採番する。
                    既に未保存の番号を入れていても、このボタンで上書きできる。 */}
                <Button
                  type="button"
                  variant={data?.regenerate_document_number ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    set({
                      document_number: "",
                      regenerate_document_number: !data?.regenerate_document_number,
                    })
                  }
                  title="保存時に新しい文書番号を採番します。既存番号も上書きされます。"
                  className="flex-shrink-0"
                >
                  <RefreshCw className={data?.regenerate_document_number ? "animate-spin" : ""} />
                  {data?.regenerate_document_number ? "再発番 ON" : "再発番"}
                </Button>
              </div>
              {/* Phase 22.21.46 / 22.21.51: 空欄 or 再発番 ON で worker が
                  contract_category + record_type から prefix を導出して自動採番。
                    ライセンス 基本 → LIC / 個別・単独 → ILT
                    業務委託   基本 → SVC / 個別・単独 → OUT
                    出版       基本 → PUB / 個別・単独 → PUB
                  形式は ARC-<TYPE>-<YEAR>-<NNNN> (発注書/検収書と同じ採番系統)。 */}
              <p className="text-[10px] font-mono text-muted-foreground mt-1 leading-relaxed">
                {data?.regenerate_document_number ? (
                  <span className="text-amber-700 font-bold">
                    🔄 保存すると新規発番されます (現在の番号は破棄)
                    <br />
                    予測 prefix: {previewDocPrefix(data?.contract_category, data?.record_type, data?.ledger_code)}
                  </span>
                ) : (
                  <>
                    空欄で保存するとカテゴリ × 区分から prefix を引いて自動発番。
                    予測 prefix: <strong>{previewDocPrefix(data?.contract_category, data?.record_type, data?.ledger_code)}</strong>
                    <br />
                    既存番号を振り直すには「再発番」ボタンを ON。
                  </>
                )}
              </p>
            </Field>
            {/* Phase 22.21.115: 稟議番号 (発注書 / 個別利用許諾と同 UI)。
                保存時に Worker 側で documents 行を upsert + ringi_documents
                テーブルに N:N リンク。GET 時にも array_agg で復元される。 */}
            <Field
              label="稟議番号 (任意・複数可)"
              className="col-span-2 md:col-span-3"
            >
              <RingiSelector
                value={
                  Array.isArray(data?.ringi_numbers) ? data.ringi_numbers : []
                }
                onChange={(next) => set({ ringi_numbers: next })}
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                Phase 22.21.118: 任意項目です。稟議マスタに登録済みの番号
                (R-NNNNN / B-NNNNN / 5 桁数字) を選択すると、保存時に N:N で
                紐付き、ダッシュボード等で「この稟議に紐づく契約」として
                参照可能になります。
              </p>
            </Field>
            {/* Phase 22.21.61: 過去のアーカイブをマスター番号に合わせる手動同期セクション。
                Phase 22.21.60 の自動同期は「保存時に旧→新を同時 rename」する仕組みだが、
                過去にドリフトしたケース (= 既に master と archive がズレている) は
                対象 archive 番号を知っている人が手動マッピングで rename する必要がある。 */}
            {!creating && data?.id && (
              <Field label="アーカイブと番号を合わせる (手動同期)" className="col-span-2 md:col-span-3">
                <ArchiveSyncSection
                  masterId={Number(data.id)}
                  masterDocNumber={String(data.document_number || "")}
                  showNotification={showNotification}
                />
              </Field>
            )}
            <Field label="ステータス">
              {/* Phase 22.21.66: 5 段階に整理。draft → 作成中、新規 awaiting_signature。 */}
              <NativeSelect
                value={data?.contract_status || "draft"}
                onChange={(e) => set({ contract_status: e.target.value })}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-[10px] font-mono text-muted-foreground mt-1 leading-relaxed">
                <strong>作成中</strong>: 編集中 / <strong>締結待ち</strong>: 相手方サイン待ち /
                <strong>締結中</strong>: 両者署名済み / <strong>満了</strong>: expiration_date 経過
                (cron で自動遷移) / <strong>解約済</strong>: 早期解約
              </p>
            </Field>
            {/* Phase 22.9: 有効/無効フラグ — 発注書/個別利用許諾条件書/個別出版条件書の
                自動補完候補に含めるかどうかを切替。
                例: 旧契約は executed のまま is_active=false にして候補から外す。 */}
            <Field label="有効 / 無効">
              {/* Phase 22.21.50: Switch だけだと状態がパッと分からないので、
                  状態テキストを大きめ + 色付きで表示する。 */}
              <div className="flex items-center gap-2 h-9">
                <Switch
                  checked={data?.is_active !== false}
                  onCheckedChange={(v) => set({ is_active: v })}
                />
                <span
                  className={cn(
                    "text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm",
                    data?.is_active !== false
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-muted text-muted-foreground border border-input"
                  )}
                >
                  {data?.is_active !== false ? "● 有効" : "○ 無効"}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {data?.is_active !== false
                    ? "自動補完候補に含む"
                    : "自動補完で無視"}
                </span>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                発注書 / 個別利用許諾条件書 / 個別出版条件書を作成するとき、
                取引先 × 区分 (業務委託 / ライセンス / 出版) の組み合わせから
                自動で基本契約を引いてくる。無効にすると候補に出てこない。
              </p>
            </Field>
            <Field label="発効日">
              <Input
                type="date"
                value={
                  data?.effective_date
                    ? String(data.effective_date).substring(0, 10)
                    : ""
                }
                onChange={(e) => set({ effective_date: e.target.value })}
              />
            </Field>
            <Field label="満了日">
              <Input
                type="date"
                value={
                  data?.expiration_date
                    ? String(data.expiration_date).substring(0, 10)
                    : ""
                }
                onChange={(e) => set({ expiration_date: e.target.value })}
              />
            </Field>
            <Field label="自動更新">
              {/* Phase 22.21.46: DB から 't'/'f' で返ってくるケースに対応するため
                  toBool で正規化。Switch のクリックは boolean を返す。
                  Phase 22.21.50: ON/OFF をテキストバッジで強調表示。 */}
              <div className="flex items-center gap-2 h-9">
                <Switch
                  checked={toBool(data?.auto_renewal)}
                  onCheckedChange={(v) => set({ auto_renewal: !!v })}
                />
                <span
                  className={cn(
                    "text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm",
                    toBool(data?.auto_renewal)
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-muted text-muted-foreground border border-input"
                  )}
                >
                  {toBool(data?.auto_renewal) ? "● あり" : "○ なし"}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {toBool(data?.auto_renewal)
                    ? "満期で自動延長"
                    : "満期で終了"}
                </span>
              </div>
            </Field>
            {/* Phase 20: 自動更新契約の通告期限アラート */}
            <Field label="解約通告期限 (カ月前)">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="例: 1"
                value={
                  data?.renewal_notice_months == null
                    ? ""
                    : String(data.renewal_notice_months)
                }
                onChange={(e) =>
                  set({ renewal_notice_months: e.target.value })
                }
                disabled={!toBool(data?.auto_renewal)}
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                満期の何カ月前までに通告が必要か (自動更新あり時のみ)
              </p>
            </Field>
            <Field label="アラート前倒し (カ月)">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="例: 2"
                value={
                  data?.alert_lead_months == null
                    ? ""
                    : String(data.alert_lead_months)
                }
                onChange={(e) => set({ alert_lead_months: e.target.value })}
                disabled={!toBool(data?.auto_renewal)}
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                通告期限の何カ月前にアラートを出すか
              </p>
            </Field>
            {/* Phase 22.21.93: 金銭条件 (= 個別利用許諾条件と同じ shape) を
                上部に移動。ライセンス系の単独/個別契約ではメイン情報なので、
                Slack 設定や原作紐付けより前に表示する。 */}
            {["license", "mixed"].includes(
              String(data?.contract_category || "").toLowerCase()
            ) && (
              <Field
                label="▍ 個別利用許諾条件 (金銭条件)"
                className="col-span-2 md:col-span-3"
              >
                <p className="text-[10px] font-mono text-muted-foreground mb-2 leading-relaxed border-l-2 border-emerald-500 pl-2">
                  <strong>個別利用許諾条件書と同じ内容</strong>を直接入力できます。
                  単独契約 / 個別契約に登録した条件は、後で「利用許諾計算書」を
                  作成するときに自動補完されます (別途 ILT 文書を発行する必要なし)。
                  <br />
                  各条件は「条件名称（任意）＋計算式タイプ」で表します。出版/電子出版の
                  ように同じ計算ロジックの条件を必要な数だけ追加できます。
                </p>
                <FinancialConditionsEditor
                  value={
                    Array.isArray(data?.financial_conditions)
                      ? data.financial_conditions
                      : []
                  }
                  onChange={(v) => set({ financial_conditions: v })}
                  recordType={String(data?.record_type || "")}
                />
              </Field>
            )}
            {/* Phase 22.21.112: 業務委託カテゴリで業務明細 (= 検収書 自動補完用) を編集。
                個別契約 / 単独契約に登録した明細は、検収書フォームから
                「業務委託マスタから読み込む」で order_lines_for_inspection に
                自動補完される。発注書 (purchase_order) フォームの items[] と同 shape。 */}
            {["service", "mixed"].includes(
              String(data?.contract_category || "").toLowerCase()
            ) && (
              <Field
                label="▍ 業務明細 (検収書 自動補完用)"
                className="col-span-2 md:col-span-3"
              >
                <p className="text-[10px] font-mono text-muted-foreground mb-2 leading-relaxed border-l-2 border-emerald-500 pl-2">
                  <strong>発注書の業務明細と同じ内容</strong>を直接入力できます。
                  単独契約 / 個別契約に登録した業務明細は、後で「検収書」を
                  作成するときに自動補完されます (毎回 PO を起票しなくても
                  マスタから直接検収書を出せる)。
                </p>
                <LineItemsEditor
                  value={
                    Array.isArray(data?.line_items)
                      ? data.line_items
                      : []
                  }
                  onChange={(v) => set({ line_items: v })}
                  recordType={String(data?.record_type || "")}
                />
              </Field>
            )}
            {/* Phase 23.6.14: 経費 (capability_expenses) — 発注書フォーム IV-b と同 shape。
                検収書フォームの「ステップ2-b 経費精算」で親契約連動として参照される。 */}
            {["service", "mixed"].includes(
              String(data?.contract_category || "").toLowerCase()
            ) && (
              <Field
                label="▍ 経費（交通費等・税込み / 検収書 自動補完用）"
                className="col-span-2 md:col-span-3"
              >
                <p className="text-[10px] font-mono text-muted-foreground mb-2 leading-relaxed border-l-2 border-emerald-500 pl-2">
                  領収書額面（税込み）をそのまま入力します。ここで登録した経費は
                  検収書フォームの「ステップ2-b 経費精算」で親契約から自動補完されます。
                </p>
                <ExpensesEditor
                  value={
                    Array.isArray(data?.expenses) ? data.expenses : []
                  }
                  onChange={(v) => set({ expenses: v })}
                  recordType={String(data?.record_type || "")}
                />
              </Field>
            )}
            {/* Phase 23.6.14: その他手数料 (capability_other_fees) — 発注書フォーム IV-a と同 shape。
                検収書フォームの「ステップ2-c その他手数料」で参照される (税抜)。 */}
            {["service", "mixed"].includes(
              String(data?.contract_category || "").toLowerCase()
            ) && (
              <Field
                label="▍ その他手数料（税抜 / 検収書 自動補完用）"
                className="col-span-2 md:col-span-3"
              >
                <p className="text-[10px] font-mono text-muted-foreground mb-2 leading-relaxed border-l-2 border-emerald-500 pl-2">
                  コーディネート費・振込手数料 等（税抜）。経費（税込・別精算）とは区別します。
                  検収書フォームの「ステップ2-c その他手数料」で親契約から自動補完されます。
                </p>
                <OtherFeesEditor
                  value={
                    Array.isArray(data?.other_fees) ? data.other_fees : []
                  }
                  onChange={(v) => set({ other_fees: v })}
                  recordType={String(data?.record_type || "")}
                />
              </Field>
            )}
            {/* Phase 22.21.46: Slack アラート通知設定 ─────────────────────────
                自動更新・満期アラート発火時に投稿する Slack チャンネルと
                メンションを契約ごとに設定。複数指定可 (カンマ または 改行区切り)。
                空欄なら env LEGAL_BRIDGE_DEFAULT_ALERT_CHANNEL にフォールバック、
                メンションは空ならメンションなし。 */}
            <Field
              label="Slack 通知チャンネル (複数可)"
              className="col-span-2 md:col-span-3"
            >
              <textarea
                value={arrToText(data?.alert_slack_channels)}
                onChange={(e) =>
                  set({ alert_slack_channels: textToArr(e.target.value) })
                }
                placeholder={"#legal-alerts\n#operations\nC0123ABCD"}
                rows={2}
                className="w-full text-xs font-mono px-2 py-1 border border-input rounded-sm bg-transparent focus:outline-none focus:border-foreground"
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                <code>#channel-name</code> または Slack の channel ID
                (C で始まる). 改行・カンマで複数指定。空欄なら env デフォルトを使用。
              </p>
            </Field>
            <Field
              label="Slack メンション (複数可)"
              className="col-span-2 md:col-span-3"
            >
              <textarea
                value={arrToText(data?.alert_slack_mentions)}
                onChange={(e) =>
                  set({ alert_slack_mentions: textToArr(e.target.value) })
                }
                placeholder={
                  "<!channel>\n<@U0123ABCD>\n<!subteam^S0123ABCD|@legal-team>"
                }
                rows={2}
                className="w-full text-xs font-mono px-2 py-1 border border-input rounded-sm bg-transparent focus:outline-none focus:border-foreground"
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                Slack の生メンション形式 <code>&lt;@U…&gt;</code> /{" "}
                <code>&lt;!subteam^S…&gt;</code> / <code>&lt;!channel&gt;</code> 等。
                改行・カンマ区切りで複数。空欄ならメンションなし。
              </p>
            </Field>
            <Field label="作品 / 原作 (任意)">
              <Input
                value={data?.original_work || ""}
                onChange={(e) => set({ original_work: e.target.value })}
                placeholder="自由入力"
              />
            </Field>
            {/* Phase 22.21.52: 原作マスタ (ledgers) との紐付け。
                ライセンス系の 個別 / 単独 契約で ledger を選ぶと、文書番号が
                LIC-{ledger_code}-ILT-NNNN 形式 (原作通算連番) で発番される。
                未選択時は ARC-ILT-YYYY-NNNN (年単位連番) にフォールバック。 */}
            <Field label="原作 (ledger 紐付け)">
              <NativeSelect
                value={data?.ledger_code || ""}
                onChange={(e) => set({ ledger_code: e.target.value })}
              >
                <option value="">— 紐付けなし (年単位連番) —</option>
                {ledgers.map((l: any) => (
                  <option key={`ledger-${l.id}`} value={l.ledger_code}>
                    {l.ledger_code} — {l.title || l.original_work || "(無題)"}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                {data?.ledger_code ? (
                  <span className="text-emerald-700 font-bold">
                    📚 原作 {data.ledger_code} に紐付け → 発番形式:
                    LIC-{data.ledger_code}-ILT-NNNN (原作通算)
                  </span>
                ) : (
                  <>
                    紐付けると ILT 番号が原作単位の通算連番になります
                    (ライセンス × 個別/単独 のみ有効)。
                  </>
                )}
              </p>
            </Field>
            <Field label="製品名">
              <Input
                value={data?.product_name || ""}
                onChange={(e) => set({ product_name: e.target.value })}
              />
            </Field>
            <Field label="メディア">
              <Input
                value={data?.media || ""}
                onChange={(e) => set({ media: e.target.value })}
              />
            </Field>
            <Field label="地域">
              <Input
                value={data?.territory || ""}
                onChange={(e) => set({ territory: e.target.value })}
              />
            </Field>
            <Field label="言語">
              <Input
                value={data?.language || ""}
                onChange={(e) => set({ language: e.target.value })}
              />
            </Field>
            <Field label="文書 URL" className="col-span-2 md:col-span-3">
              <Input
                value={data?.document_url || ""}
                onChange={(e) => set({ document_url: e.target.value })}
                placeholder="https://drive.google.com/…"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              キャンセル
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存して同期"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-1 ${className || ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

/**
 * Phase 22.21.111: 取引先 (vendors) を検索 + 選択する小さな picker。
 *
 *   旧実装の <NativeSelect> は vendors が増えてくると数百〜数千行の
 *   プルダウンになり、目視で探すのが現実的でなくなる問題に対処。
 *
 *   UX:
 *     - 未選択時: 検索 input + 候補リスト (max 30 件)
 *       検索対象: vendor_name / vendor_code / trade_name / pen_name / aliases
 *     - 選択済み時: 取引先名 + コードを表示し、[変更] / [×] ボタン
 *     - 検索は NFKC + 小文字化で全角/半角・大文字小文字を吸収
 *     - Enter で先頭候補を即選択 (キーボード派向け)
 */
function VendorPicker({
  value,
  onChange,
  vendors,
}: {
  value: string | number
  onChange: (id: string) => void
  vendors: any[]
}) {
  const [search, setSearch] = React.useState("")
  const [forceOpen, setForceOpen] = React.useState(false)
  const selected = vendors.find(
    (v) => String(v.id) === String(value || "")
  )

  // ── 選択済み表示モード ──
  if (selected && !forceOpen) {
    return (
      <div className="flex items-center gap-1.5">
        <div
          className={cn(
            "flex-1 min-w-0 px-2.5 py-1.5 rounded-sm border",
            "border-emerald-300 bg-emerald-50/50"
          )}
        >
          <div className="text-xs font-mono font-bold truncate">
            {selected.vendor_name || "(無名)"}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {selected.vendor_code}
            {selected.entity_type ? ` · ${selected.entity_type}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setSearch("")
            setForceOpen(true)
          }}
          className="text-[10px] font-mono px-2 py-1 border border-input rounded-sm hover:bg-muted flex-shrink-0"
          title="別の取引先に変更"
        >
          変更
        </button>
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-[10px] font-mono px-2 py-1 border border-input rounded-sm hover:bg-muted text-muted-foreground flex-shrink-0"
          title="選択解除"
        >
          ×
        </button>
      </div>
    )
  }

  // ── 検索モード ──
  const normalize = (s: any): string =>
    String(s || "")
      .normalize("NFKC")
      .toLowerCase()
  const q = normalize(search)
  const filtered = !q
    ? vendors
    : vendors.filter((v: any) => {
        const hay = [
          v.vendor_name,
          v.vendor_code,
          v.trade_name,
          v.pen_name,
          v.aliases,
          v.vendor_rep,
          v.contact_name,
        ]
          .map(normalize)
          .join(" ")
        return hay.includes(q)
      })
  const visible = filtered.slice(0, 30)

  const applyFirst = () => {
    if (visible[0]) {
      onChange(String(visible[0].id))
      setSearch("")
      setForceOpen(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              applyFirst()
            }
          }}
          placeholder="取引先名・コード・別名で検索…"
          className="text-xs font-mono flex-1"
        />
        {selected && (
          <button
            type="button"
            onClick={() => {
              setSearch("")
              setForceOpen(false)
            }}
            className="text-[10px] font-mono px-2 py-1 border border-input rounded-sm hover:bg-muted text-muted-foreground flex-shrink-0"
            title="変更を中止 (現在の選択を維持)"
          >
            戻る
          </button>
        )}
      </div>
      <div className="text-[10px] font-mono text-muted-foreground px-1 flex items-center justify-between">
        <span>
          {filtered.length} / 全 {vendors.length} 件
          {filtered.length > visible.length && ` (上位 ${visible.length} 件表示)`}
        </span>
        {q && (
          <span className="text-foreground/60">Enter で先頭を選択</span>
        )}
      </div>
      <div className="max-h-[220px] overflow-y-auto border border-input rounded-sm divide-y divide-input bg-background">
        {visible.map((v: any) => (
          <button
            key={`vp-${v.id}`}
            type="button"
            onClick={() => {
              onChange(String(v.id))
              setSearch("")
              setForceOpen(false)
            }}
            className={cn(
              "w-full text-left px-2.5 py-1.5 hover:bg-emerald-50/60 transition-colors",
              String(v.id) === String(value) && "bg-emerald-50"
            )}
          >
            <div className="text-xs font-mono font-bold truncate">
              {v.vendor_name || "(無名)"}
            </div>
            <div className="text-[11px] font-mono text-muted-foreground truncate">
              {v.vendor_code}
              {v.entity_type ? ` · ${v.entity_type}` : ""}
              {v.aliases ? ` · 別名: ${v.aliases}` : ""}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="p-3 text-center text-[10px] font-mono text-muted-foreground">
            該当する取引先が見つかりません
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Phase 22.21.91: 契約マスタの金銭条件エディタ。
 *
 *   ライセンス系 (contract_category=license) の単独/個別契約で、
 *   個別利用許諾条件書と同じ shape (1..3 条件) の金銭条件を入力できる。
 *   後段の「利用許諾計算書」フォームから defaults として参照される。
 *
 *   - 条件は最大 3 行 (condition_no: 1=製造ベース / 2=サブライセンス・再許諾 / 3=プロダクト。方向中立)
 *   - 行追加時は未使用の最小番号を自動採番
 *   - 行削除は完全削除 (保存時に DB 側からも消える)
 */
function FinancialConditionsEditor({
  value,
  onChange,
  recordType,
}: {
  value: any[]
  onChange: (v: any[]) => void
  recordType: string
}) {
  const usedNos = new Set(value.map((c) => Number(c.condition_no)))
  // 次の条件番号 = 未使用の最小番号(上限なし)。出版/電子出版など同ロジックの
  //   条件を複数並べられるよう、従来の 1〜3 固定を撤廃。
  const nextNo = (() => {
    let n = 1
    while (usedNos.has(n)) n++
    return n
  })()
  // 区分(条件番号)プルダウンの選択肢。現在の最大番号 +2 まで出して付け替え可能に。
  const maxNo = Math.max(3, ...value.map((c) => Number(c.condition_no) || 0))
  const numOptions = Array.from({ length: maxNo + 2 }, (_, i) => i + 1)

  // 基本契約 (master_contract) で金銭条件を入れる意味は薄いので軽い警告を出す。
  // ただし入力自体は許す (将来の柔軟性のため)。
  const isIndividualLike =
    recordType === "individual_contract" ||
    recordType === "standalone_contract" ||
    recordType === "license_condition"

  const update = (idx: number, patch: any) => {
    onChange(value.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }
  // 構造化フィールド変更時: calc_method(互換) と計算式テキストを自動再計算。
  const recalc = (idx: number, patch: any) => {
    const merged = { ...value[idx], ...patch }
    update(idx, {
      ...patch,
      calc_method: calcMethodFromType(merged.calc_type),
      formula_text: buildFormulaText(merged),
    })
  }
  const isBaseRate = (t?: string) =>
    t === "BASE_QTY_RATE" || t === "BASE_RATE"
  const add = () => {
    if (!nextNo) return
    onChange([
      ...value,
      {
        condition_no: nextNo,
        condition_name: "",
        calc_type: "BASE_QTY_RATE",
        calc_method: "ROYALTY",
        guarantee_type: "NONE",
        currency: "JPY",
        rate_pct: "",
        mg_amount: "",
        ag_amount: "",
        unit_amount: "",
        fixed_kind: "LUMP",
        subscription_cycle: "MONTHLY",
        region_language_label: "",
        base_price_label: "上代",
        calc_period: "",
        calc_period_kind: "",
        calc_period_close_month: "",
        formula_text: "",
        payment_terms: "",
      },
    ])
  }
  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      {!isIndividualLike && value.length > 0 && (
        <div className="text-[10px] font-mono text-amber-700 border border-amber-300 bg-amber-50/40 rounded-sm px-2 py-1">
          ⚠ 「基本契約」では金銭条件は通常使われません。単独契約 / 個別契約への
          切替を検討してください。
        </div>
      )}
      {value.length === 0 && (
        <div className="text-[10px] font-mono text-muted-foreground border border-dashed border-border rounded-sm p-3">
          金銭条件が未設定です。「条件を追加」で必要な数だけ登録できます。
          単独契約/個別契約で入力しておくと、利用許諾計算書 を作成するときに
          自動補完されます。
        </div>
      )}
      {value.map((c, idx) => (
        <div
          key={`cond-${idx}`}
          className="border border-border rounded-sm p-3 bg-muted/30 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <Badge variant="info" className="h-5">
              {c.condition_name && String(c.condition_name).trim()
                ? `条件 ${c.condition_no}：${c.condition_name}`
                : `条件 ${c.condition_no}`}
            </Badge>
            <Button
              type="button"
              size="icon-sm"
              variant="destructive"
              onClick={() => remove(idx)}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="col-span-2 md:col-span-4 space-y-0.5">
              <Label className="text-[10px]">条件名称 (任意)</Label>
              <Input
                value={c.condition_name || ""}
                onChange={(e) =>
                  update(idx, { condition_name: e.target.value })
                }
                placeholder="任意の条件名称 (空欄なら標準見出し)"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">条件番号</Label>
              <NativeSelect
                value={String(c.condition_no || "")}
                onChange={(e) =>
                  update(idx, { condition_no: Number(e.target.value) })
                }
              >
                {numOptions.map((n) => (
                  <option key={n} value={n}>
                    条件 {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="col-span-2 space-y-0.5">
              <Label className="text-[10px]">計算式タイプ</Label>
              <NativeSelect
                value={c.calc_type || ""}
                onChange={(e) =>
                  recalc(idx, { calc_type: e.target.value || undefined })
                }
              >
                <option value="">—</option>
                {CALC_TYPE_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">通貨</Label>
              <Input
                value={c.currency || "JPY"}
                onChange={(e) => update(idx, { currency: e.target.value })}
              />
            </div>

            {/* ①② 基準価格×(個数×)料率: 料率 + 基準価格ラベル */}
            {isBaseRate(c.calc_type) && (
              <>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">料率 (%)</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={c.rate_pct ?? ""}
                    onChange={(e) => recalc(idx, { rate_pct: e.target.value })}
                    placeholder="例: 5.0"
                  />
                </div>
                <div className="col-span-2 space-y-0.5">
                  <Label className="text-[10px]">基準価格ラベル</Label>
                  <Input
                    value={c.base_price_label || ""}
                    onChange={(e) =>
                      recalc(idx, { base_price_label: e.target.value })
                    }
                    placeholder="例: 上代 (MSRP)"
                  />
                </div>
              </>
            )}

            {/* ③ 固定値: 支払区分(一括/分割) + 固定額 */}
            {c.calc_type === "FIXED" && (
              <>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">支払区分</Label>
                  <NativeSelect
                    value={c.fixed_kind || "LUMP"}
                    onChange={(e) =>
                      recalc(idx, { fixed_kind: e.target.value })
                    }
                  >
                    <option value="LUMP">一括</option>
                    <option value="INSTALLMENT">分割</option>
                  </NativeSelect>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">固定額</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={c.unit_amount ?? ""}
                    onChange={(e) =>
                      recalc(idx, { unit_amount: e.target.value })
                    }
                  />
                </div>
              </>
            )}

            {/* ④ サブスク: 課金サイクル(月/年) + 単価 */}
            {c.calc_type === "SUBSCRIPTION" && (
              <>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">課金サイクル</Label>
                  <NativeSelect
                    value={c.subscription_cycle || "MONTHLY"}
                    onChange={(e) =>
                      recalc(idx, { subscription_cycle: e.target.value })
                    }
                  >
                    <option value="MONTHLY">月払い</option>
                    <option value="ANNUAL">年払い</option>
                  </NativeSelect>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">
                    単価 ({c.subscription_cycle === "ANNUAL" ? "年額" : "月額"})
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={c.unit_amount ?? ""}
                    onChange={(e) =>
                      recalc(idx, { unit_amount: e.target.value })
                    }
                  />
                </div>
              </>
            )}
            <div className="space-y-0.5">
              <Label className="text-[10px]">計算期間 種別</Label>
              <NativeSelect
                value={c.calc_period_kind || ""}
                onChange={(e) =>
                  update(idx, { calc_period_kind: e.target.value })
                }
              >
                <option value="">—</option>
                {PERIOD_KIND_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">締め月 (1-12)</Label>
              <Input
                type="number"
                min="1"
                max="12"
                step="1"
                value={c.calc_period_close_month ?? ""}
                onChange={(e) =>
                  update(idx, { calc_period_close_month: e.target.value })
                }
              />
            </div>
            <div className="col-span-2 space-y-0.5">
              <Label className="text-[10px]">地域・言語ラベル</Label>
              <Input
                value={c.region_language_label || ""}
                onChange={(e) =>
                  update(idx, { region_language_label: e.target.value })
                }
                placeholder="例: 国内・日本語"
              />
            </div>
            {/* MG/AG 保証 (①②型のみ・排他)。MG=floor(mg_amount), AG=前払い(ag_amount)。 */}
            {isBaseRate(c.calc_type) && (
              <>
                <div className="col-span-1 space-y-0.5">
                  <Label className="text-[10px]">保証 (MG/AG)</Label>
                  <NativeSelect
                    value={c.guarantee_type || "NONE"}
                    onChange={(e) => {
                      const g = e.target.value
                      if (g === "MG")
                        update(idx, { guarantee_type: "MG", ag_amount: "" })
                      else if (g === "AG")
                        update(idx, { guarantee_type: "AG", mg_amount: "" })
                      else
                        update(idx, {
                          guarantee_type: "NONE",
                          mg_amount: "",
                          ag_amount: "",
                        })
                    }}
                  >
                    <option value="NONE">なし</option>
                    <option value="MG">MG (最低保証)</option>
                    <option value="AG">AG (前払い保証)</option>
                  </NativeSelect>
                </div>
                <div className="col-span-1 space-y-0.5">
                  <Label className="text-[10px]">
                    {c.guarantee_type === "AG" ? "AG (前払い保証額)" : "MG (最低保証額)"}
                  </Label>
                  {c.guarantee_type === "MG" || c.guarantee_type === "AG" ? (
                    <>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={
                          (c.guarantee_type === "AG"
                            ? c.ag_amount
                            : c.mg_amount) ?? ""
                        }
                        onChange={(e) =>
                          update(
                            idx,
                            c.guarantee_type === "AG"
                              ? { ag_amount: e.target.value }
                              : { mg_amount: e.target.value }
                          )
                        }
                      />
                      <p className="text-[11px] font-mono text-muted-foreground">
                        {c.guarantee_type === "AG"
                          ? "前払い済み額。各計算で消化していく"
                          : "ロイヤリティ < MG なら MG を採用 (毎期 floor)"}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] font-mono text-muted-foreground">
                      保証なし
                    </p>
                  )}
                </div>
              </>
            )}
            <div className="col-span-2 md:col-span-4 space-y-0.5">
              <Label className="text-[10px]">計算式テキスト</Label>
              <Input
                value={c.formula_text || ""}
                onChange={(e) => update(idx, { formula_text: e.target.value })}
                placeholder="例: 上代 × 5.0% × 製造数"
              />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-0.5">
              <Label className="text-[10px]">支払条件</Label>
              <textarea
                value={c.payment_terms || ""}
                onChange={(e) =>
                  update(idx, { payment_terms: e.target.value })
                }
                rows={2}
                className="w-full text-xs font-mono px-2 py-1 border border-input rounded-sm bg-transparent focus:outline-none focus:border-foreground"
                placeholder="例: 締め月翌月末払い"
              />
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
        >
          <Plus />
          条件を追加 (条件 {nextNo})
        </Button>
        <p className="text-[10px] font-mono text-muted-foreground">
          単独契約/個別契約で入力した条件は、利用許諾計算書 フォームで
          contract_capability から自動補完されます。
        </p>
      </div>
    </div>
  )
}

/**
 * Phase 22.21.112: 業務委託マスタの業務明細エディタ。
 *
 *   業務委託 (service) カテゴリの単独/個別契約で、発注書の業務明細と同じ
 *   shape の業務明細 (1..N 行) を入力できる。後段の「検収書」フォームから
 *   defaults として参照される。
 *
 *   - 行追加は line_no を 1 から自動採番
 *   - 各行: カテゴリ / 業務内容 / 仕様 / 計算方式 / 数量 / 単価 /
 *     金額(税抜) / 納期 / 支払日
 *   - calc_method = FIXED / SUBSCRIPTION / ROYALTY
 *   - SUBSCRIPTION 用 (cycle / billing_day / term_start / term_end) は
 *     折り畳みで表示
 *   - 金額(税抜) = 数量 × 単価 を入力ヘルパー
 */
function LineItemsEditor({
  value,
  onChange,
  recordType,
}: {
  value: any[]
  onChange: (v: any[]) => void
  recordType: string
}) {
  const isIndividualLike =
    recordType === "individual_contract" ||
    recordType === "standalone_contract" ||
    recordType === "license_condition"

  const nextLineNo = (value.reduce(
    (max: number, c: any) => Math.max(max, Number(c?.line_no) || 0),
    0
  )) + 1

  const update = (idx: number, patch: any) => {
    onChange(
      value.map((c, i) => {
        if (i !== idx) return c
        const next = { ...c, ...patch }
        // 数量 × 単価 → 金額 (税抜) を自動計算 (ユーザーが触ったら上書き)
        if (
          ("quantity" in patch || "unit_price" in patch) &&
          !("amount_ex_tax" in patch)
        ) {
          const qty = Number(next.quantity) || 0
          const unit = Number(next.unit_price) || 0
          if (qty > 0 && unit > 0) {
            next.amount_ex_tax = Math.round(qty * unit)
          }
        }
        return next
      })
    )
  }

  const add = () => {
    onChange([
      ...value,
      {
        line_no: nextLineNo,
        // 費目区分。既定は制作対価。複合契約では利用許諾料/その他も選べる。
        fee_type: "production",
        item_name: "",
        spec: "",
        calc_method: "FIXED",
        // Phase 22.21.114: 発注書 LineItemTable と整合。
        //   payment_terms は契約種別 (請負/準委任) の 2 択。
        //   旧 category / payment_method は UI から削除。
        payment_terms: "",
        quantity: "",
        unit_price: "",
        amount_ex_tax: "",
        delivery_date: "",
        payment_date: "",
        cycle: "",
        billing_day: "",
        term_start: "",
        term_end: "",
      },
    ])
  }

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      {!isIndividualLike && value.length > 0 && (
        <div className="text-[10px] font-mono text-amber-700 border border-amber-300 bg-amber-50/40 rounded-sm px-2 py-1">
          ⚠ 「基本契約」では業務明細は通常使われません。単独契約 / 個別契約への
          切替を検討してください。
        </div>
      )}
      {value.length === 0 && (
        <div className="text-[10px] font-mono text-muted-foreground border border-dashed border-border rounded-sm p-3">
          業務明細が未設定です。「明細を追加」で 1 件以上登録できます。
          単独契約 / 個別契約で入力しておくと、検収書フォームから
          一括 auto-fill されます。
        </div>
      )}
      {value.map((c: any, idx: number) => (
        <div
          key={`line-${idx}`}
          className="border border-border rounded-sm p-3 bg-muted/30 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <Badge variant="info" className="h-5">
              明細 {c.line_no || idx + 1}
            </Badge>
            <div className="flex items-center gap-1">
              <Label className="text-[10px]">費目区分</Label>
              <NativeSelect
                className="h-7 text-[11px]"
                value={c.fee_type || "production"}
                onChange={(e) => update(idx, { fee_type: e.target.value })}
              >
                <option value="production">制作対価</option>
                <option value="royalty">利用許諾料</option>
                <option value="other">その他</option>
              </NativeSelect>
              <Button
                type="button"
                size="icon-sm"
                variant="destructive"
                onClick={() => remove(idx)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          {/* Phase 22.21.114: 発注書 LineItemTable と項目を揃える。
              ・カテゴリ / 支払方法 を撤去
              ・契約種別 (= payment_terms) を 請負/準委任 の 2 択に */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
            <div className="col-span-2 md:col-span-3 space-y-0.5">
              <Label className="text-[10px]">業務内容・成果物</Label>
              <Input
                value={c.item_name || ""}
                onChange={(e) => update(idx, { item_name: e.target.value })}
                placeholder="例: イラスト 5 点制作"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">計算方式</Label>
              <NativeSelect
                value={c.calc_method || "FIXED"}
                onChange={(e) => update(idx, { calc_method: e.target.value })}
              >
                <option value="FIXED">FIXED (固定額)</option>
                <option value="SUBSCRIPTION">SUBSCRIPTION (期間契約)</option>
                <option value="ROYALTY">ROYALTY (歩合)</option>
              </NativeSelect>
            </div>
            <div className="col-span-2 space-y-0.5">
              <Label className="text-[10px]">契約種別</Label>
              <NativeSelect
                value={c.payment_terms || ""}
                onChange={(e) => update(idx, { payment_terms: e.target.value })}
              >
                <option value="">— 未選択 —</option>
                <option value="請負">請負 (成果物の引渡しが報酬の対価 — 民法 632 条)</option>
                <option value="準委任">準委任 (業務遂行が報酬の対価 — 民法 656 条)</option>
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <div className="space-y-0.5">
              <Label className="text-[10px]">数量</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={c.quantity ?? ""}
                onChange={(e) => update(idx, { quantity: e.target.value })}
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">単価</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={c.unit_price ?? ""}
                onChange={(e) => update(idx, { unit_price: e.target.value })}
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">金額 (税抜)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={c.amount_ex_tax ?? ""}
                onChange={(e) =>
                  update(idx, { amount_ex_tax: e.target.value })
                }
                placeholder="数量×単価を自動計算"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">納期</Label>
              <Input
                type="date"
                value={c.delivery_date || ""}
                onChange={(e) => update(idx, { delivery_date: e.target.value })}
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">支払日</Label>
              <Input
                type="date"
                value={c.payment_date || ""}
                onChange={(e) => update(idx, { payment_date: e.target.value })}
              />
            </div>
          </div>
          {/* SUBSCRIPTION 用 (折り畳み) */}
          {c.calc_method === "SUBSCRIPTION" && (
            <details className="border-t border-input pt-2 mt-1">
              <summary className="text-[10px] font-mono uppercase tracking-wider cursor-pointer text-muted-foreground hover:text-foreground">
                ▶ SUBSCRIPTION 詳細 (周期 / 締日 / 期間)
              </summary>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
                <div className="space-y-0.5">
                  <Label className="text-[10px]">周期</Label>
                  <NativeSelect
                    value={c.cycle || ""}
                    onChange={(e) => update(idx, { cycle: e.target.value })}
                  >
                    <option value="">—</option>
                    <option value="monthly">月次</option>
                    <option value="quarterly">四半期</option>
                    <option value="yearly">年次</option>
                  </NativeSelect>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">締日</Label>
                  <Input
                    type="number"
                    min="1"
                    max="31"
                    value={c.billing_day ?? ""}
                    onChange={(e) =>
                      update(idx, { billing_day: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">期間 (開始)</Label>
                  <Input
                    type="date"
                    value={c.term_start || ""}
                    onChange={(e) => update(idx, { term_start: e.target.value })}
                  />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">期間 (終了)</Label>
                  <Input
                    type="date"
                    value={c.term_end || ""}
                    onChange={(e) => update(idx, { term_end: e.target.value })}
                  />
                </div>
              </div>
            </details>
          )}
          <div className="space-y-0.5">
            <Label className="text-[10px]">仕様 (詳細)</Label>
            <textarea
              value={c.spec || ""}
              onChange={(e) => update(idx, { spec: e.target.value })}
              rows={2}
              className="w-full text-xs font-mono px-2 py-1 border border-input rounded-sm bg-transparent focus:outline-none focus:border-foreground"
              placeholder="納品物の詳細仕様 (任意)"
            />
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus />
        明細を追加
      </Button>
    </div>
  )
}

/**
 * Phase 23.6.14: 契約マスタの経費エディタ (capability_expenses)。
 *
 *   業務委託 (service) カテゴリの単独/個別契約で、発注書フォーム IV-b. 経費 と
 *   同 shape の経費 (税込み額) を入力できる。後段の「検収書」フォームの
 *   ステップ2-b 経費精算で親契約から自動補完される。
 *   semantics は LineItemsEditor と同じ (undefined→維持 / []→全削除)。
 */
function ExpensesEditor({
  value,
  onChange,
  recordType,
}: {
  value: any[]
  onChange: (v: any[]) => void
  recordType: string
}) {
  const isIndividualLike =
    recordType === "individual_contract" ||
    recordType === "standalone_contract" ||
    recordType === "license_condition"

  const nextLineNo =
    value.reduce((m: number, c: any) => Math.max(m, Number(c?.line_no) || 0), 0) + 1

  const update = (idx: number, patch: any) =>
    onChange(value.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  const add = () =>
    onChange([
      ...value,
      {
        line_no: nextLineNo,
        expense_name: "",
        spec: "",
        spent_date: "",
        amount_inc_tax: "",
        remarks: "",
      },
    ])
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx))
  const total = value.reduce(
    (s: number, e: any) => s + (Number(e?.amount_inc_tax) || 0),
    0
  )

  return (
    <div className="space-y-3">
      {!isIndividualLike && value.length > 0 && (
        <div className="text-[10px] font-mono text-amber-700 border border-amber-300 bg-amber-50/40 rounded-sm px-2 py-1">
          ⚠ 「基本契約」では経費は通常使われません。単独契約 / 個別契約への
          切替を検討してください。
        </div>
      )}
      {value.length === 0 && (
        <div className="text-[10px] font-mono text-muted-foreground border border-dashed border-border rounded-sm p-3">
          経費が未設定です。「経費を追加」で 1 件以上登録できます (税込み額)。
          単独契約 / 個別契約で入力しておくと、検収書フォームの
          「ステップ2-b 経費精算」で自動補完されます。
        </div>
      )}
      {value.map((c: any, idx: number) => (
        <div
          key={`exp-${idx}`}
          className="border border-border rounded-sm p-3 bg-muted/30 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <Badge variant="info" className="h-5">
              経費 {c.line_no || idx + 1}
            </Badge>
            <Button
              type="button"
              size="icon-sm"
              variant="destructive"
              onClick={() => remove(idx)}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="col-span-2 space-y-0.5">
              <Label className="text-[10px]">費目</Label>
              <Input
                value={c.expense_name || ""}
                onChange={(e) => update(idx, { expense_name: e.target.value })}
                placeholder="例: 交通費 / 宿泊費"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">発生日</Label>
              <Input
                type="date"
                value={c.spent_date || ""}
                onChange={(e) => update(idx, { spent_date: e.target.value })}
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">金額 (税込)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={c.amount_inc_tax ?? ""}
                onChange={(e) =>
                  update(idx, { amount_inc_tax: e.target.value })
                }
              />
            </div>
            <div className="col-span-2 space-y-0.5">
              <Label className="text-[10px]">仕様 / 区間 等</Label>
              <Input
                value={c.spec || ""}
                onChange={(e) => update(idx, { spec: e.target.value })}
                placeholder="例: 東京〜大阪 新幹線"
              />
            </div>
            <div className="col-span-2 space-y-0.5">
              <Label className="text-[10px]">摘要</Label>
              <Input
                value={c.remarks || ""}
                onChange={(e) => update(idx, { remarks: e.target.value })}
                placeholder="領収書 No 等 (任意)"
              />
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus />
          経費を追加
        </Button>
        {value.length > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground">
            経費合計 (税込): ¥ {total.toLocaleString("ja-JP")}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Phase 23.6.14: 契約マスタのその他手数料エディタ (capability_other_fees)。
 *
 *   発注書フォーム IV-a. その他手数料 と同 shape (税抜)。検収書フォームの
 *   ステップ2-c その他手数料 で親契約から自動補完される。
 */
function OtherFeesEditor({
  value,
  onChange,
  recordType,
}: {
  value: any[]
  onChange: (v: any[]) => void
  recordType: string
}) {
  const isIndividualLike =
    recordType === "individual_contract" ||
    recordType === "standalone_contract" ||
    recordType === "license_condition"

  const nextLineNo =
    value.reduce((m: number, c: any) => Math.max(m, Number(c?.line_no) || 0), 0) + 1

  const update = (idx: number, patch: any) =>
    onChange(value.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  const add = () =>
    onChange([
      ...value,
      { line_no: nextLineNo, fee_name: "", amount: "", remarks: "" },
    ])
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx))
  const total = value.reduce(
    (s: number, f: any) => s + (Number(f?.amount) || 0),
    0
  )

  return (
    <div className="space-y-3">
      {!isIndividualLike && value.length > 0 && (
        <div className="text-[10px] font-mono text-amber-700 border border-amber-300 bg-amber-50/40 rounded-sm px-2 py-1">
          ⚠ 「基本契約」ではその他手数料は通常使われません。単独契約 / 個別契約への
          切替を検討してください。
        </div>
      )}
      {value.length === 0 && (
        <div className="text-[10px] font-mono text-muted-foreground border border-dashed border-border rounded-sm p-3">
          その他手数料が未設定です。「手数料を追加」で 1 件以上登録できます (税抜)。
          単独契約 / 個別契約で入力しておくと、検収書フォームの
          「ステップ2-c その他手数料」で自動補完されます。
        </div>
      )}
      {value.map((c: any, idx: number) => (
        <div
          key={`fee-${idx}`}
          className="border border-border rounded-sm p-3 bg-muted/30 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <Badge variant="info" className="h-5">
              手数料 {c.line_no || idx + 1}
            </Badge>
            <Button
              type="button"
              size="icon-sm"
              variant="destructive"
              onClick={() => remove(idx)}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="col-span-2 space-y-0.5">
              <Label className="text-[10px]">項目名</Label>
              <Input
                value={c.fee_name || ""}
                onChange={(e) => update(idx, { fee_name: e.target.value })}
                placeholder="例: コーディネート費 / 振込手数料"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px]">金額 (税抜)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={c.amount ?? ""}
                onChange={(e) => update(idx, { amount: e.target.value })}
              />
            </div>
            <div className="col-span-2 md:col-span-1 space-y-0.5">
              <Label className="text-[10px]">摘要</Label>
              <Input
                value={c.remarks || ""}
                onChange={(e) => update(idx, { remarks: e.target.value })}
                placeholder="(任意)"
              />
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus />
          手数料を追加
        </Button>
        {value.length > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground">
            手数料 小計 (税抜): ¥ {total.toLocaleString("ja-JP")}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Phase 22.21.61: 過去のアーカイブをマスターの number に手動で合わせる小ウィジェット。
 *
 * 自動同期 (Phase 22.21.60) は「マスター保存時に旧→新を rename」する仕組みだが、
 * 既にドリフトしている過去データは保存時の rename トリガーが効かない。
 * このウィジェットでは:
 *   1. ユーザーがアーカイブ側の "現在の" 番号を入力 (例: ARC-ILT-2026-0001)
 *   2. ボタン押下で POST /api/master/contracts/:id/rename-archive に投げる
 *   3. worker が documents + external_assets を target 番号に rename
 */
function ArchiveSyncSection({
  masterId,
  masterDocNumber,
  showNotification,
}: {
  masterId: number
  masterDocNumber: string
  showNotification: (msg: string, kind?: "success" | "error" | "info") => void
}) {
  const [from, setFrom] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const target = (masterDocNumber || "").trim()

  const run = async () => {
    const fromTrimmed = from.trim()
    if (!fromTrimmed) {
      showNotification("アーカイブ側の現在の番号を入力してください", "error")
      return
    }
    if (!target) {
      showNotification(
        "マスター側の document_number が空です。先に保存して番号を確定してください。",
        "error"
      )
      return
    }
    if (fromTrimmed === target) {
      showNotification(
        `入力された番号 (${fromTrimmed}) は既にマスター番号と一致しています`,
        "info"
      )
      return
    }
    if (
      !confirm(
        `アーカイブ "${fromTrimmed}" を "${target}" にリネームします。\n` +
          `この操作は documents テーブルと external_assets テーブルを直接更新します。よろしいですか?`
      )
    )
      return

    setBusy(true)
    try {
      const res = await fetch(
        `/api/master/contracts/${masterId}/rename-archive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from_document_number: fromTrimmed }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      if (data.already_synced) {
        showNotification("既に同期済みです (変更なし)", "info")
      } else {
        showNotification(
          `アーカイブをリネームしました: ${data.from} → ${data.to} ` +
            `(documents ${data.documents_updated} 件 / external_assets ${data.assets_updated} 件)`,
          "success"
        )
        setFrom("")
      }
    } catch (e: any) {
      showNotification(`同期失敗: ${e?.message || e}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-sm border border-dashed border-amber-300 bg-amber-50/40 p-3">
      <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        過去のアーカイブが旧番号のまま残っている場合、ここで現在の番号を入力すると
        マスター番号 <code className="bg-muted px-1">{target || "(未設定)"}</code> にリネームします。
        documents テーブルと external_assets テーブルが直接更新されます。
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="アーカイブ側の現在の番号 (例: ARC-ILT-2026-0001)"
          disabled={busy}
          className="flex-1 text-[11px] font-mono bg-background border border-input rounded-sm py-1.5 px-2 focus:outline-none focus:border-foreground"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={run}
          disabled={busy || !from.trim() || !target}
        >
          {busy ? "実行中…" : `→ ${target || "(未設定)"} にリネーム`}
        </Button>
      </div>
    </div>
  )
}
