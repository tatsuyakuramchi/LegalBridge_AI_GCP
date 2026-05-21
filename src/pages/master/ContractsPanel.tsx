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
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// Phase 22.21.46: DB から返ってきた auto_renewal の型ゆらぎ ('t'/'f'/'true'/1/etc)
//   を Boolean に正規化する。Switch 等の制御コンポーネントが期待する型に揃える。
const toBool = (v: any): boolean =>
  v === true || v === "t" || v === "true" || v === 1 || v === "1";

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
}

export function ContractsPanel() {
  const { contracts, vendors, refreshContracts, showNotification } = useAppData()
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
        if (wasAuto || wasRegen) {
          showNotification(
            `${isEdit ? "契約情報を更新しました" : "契約情報を追加しました"}` +
              (newDocNo ? ` (文書番号: ${newDocNo}${wasRegen ? " ← 再発番" : " ← 自動発番"})` : ""),
            "success"
          )
        } else {
          showNotification(
            isEdit ? "契約情報を更新しました" : "契約情報を追加しました",
            "success"
          )
        }
        await refreshContracts()
        close()
      } else {
        let detail = ""
        try {
          const j = await res.json()
          detail = j?.error ? `: ${j.error}` : ""
        } catch {}
        showNotification(
          `保存に失敗しました (HTTP ${res.status})${detail}`,
          "error"
        )
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
                      variant={c.contract_status === "executed" ? "success" : "phosphor"}
                      className="h-4"
                    >
                      {c.contract_status === "executed" ? "締結済" : c.contract_status}
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
              <NativeSelect
                value={data?.vendor_id || ""}
                onChange={(e) => set({ vendor_id: e.target.value })}
              >
                <option value="">— 取引先を選択 —</option>
                {vendors.map((v) => (
                  <option key={`opt-${v.id}`} value={v.id}>
                    {v.vendor_name} ({v.vendor_code})
                  </option>
                ))}
              </NativeSelect>
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
                <option value="publication">出版関連</option>
              </NativeSelect>
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
              {/* Phase 22.21.46: 空欄なら worker 側で getNewDocumentNumber が
                  発火し、契約種別から prefix を引いて自動採番。発番方式は
                  発注書 / 検収書 等と同じ ARC-<TYPE>-<YEAR>-<NNNN>。 */}
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                {data?.regenerate_document_number ? (
                  <span className="text-amber-700 font-bold">
                    🔄 保存すると新規発番されます (現在の番号は破棄)
                  </span>
                ) : (
                  <>空欄で保存すると契約種別に応じた prefix で自動発番されます。
                  既存の番号を新規発番で振り直したい場合は「再発番」ボタンを ON。</>
                )}
              </p>
            </Field>
            <Field label="ステータス">
              <NativeSelect
                value={data?.contract_status || "executed"}
                onChange={(e) => set({ contract_status: e.target.value })}
              >
                <option value="executed">締結済</option>
                <option value="draft">草案・作成中</option>
                <option value="expired">満了</option>
                <option value="terminated">解約済</option>
              </NativeSelect>
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
            <Field label="作品 / 原作">
              <Input
                value={data?.original_work || ""}
                onChange={(e) => set({ original_work: e.target.value })}
              />
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
