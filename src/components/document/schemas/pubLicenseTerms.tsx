/**
 * pubLicenseTerms — 出版等利用許諾条件書(pub_license_terms) の入力フォーム。
 *
 * 設計 v1.4 Phase C / FRM-04(R2「全文書 Schema 化」): 旧 DocumentForm の
 * per-template 分岐(独自セクション「1. 作品・原作・基本契約」+ PUB 並替の
 * グループ描画 + VI 対価に FinancialConditionTable 注入)をこのモジュールへ
 * 移設し、SchemaDocumentForm 経由で描画する。UI/挙動・formData キー・PDF
 * テンプレは不変(等価移設)。
 *
 * - 原作マスタ(ledgers)/refreshLedgers は AppDataContext から直接取得。
 * - 作品一覧(worksList)/setWorksList は ctx で受け取る(個別利用許諾と共有)。
 * - DB補完バー(取引先/自社/Sync Staff)は SchemaDocumentForm の DbFillBar が担当
 *   (旧 DocumentForm の fillByPrefix と同一ロジック)ため fillBar は既定(true)。
 * - financial_conditions のシード(旧フラット field → 条件表)は DocumentForm 側の
 *   pubCondSeededRef effect が全 render 分岐で発火するため据え置き(移設不要)。
 */
import * as React from "react"
import { useAppData } from "@/src/context/AppDataContext"
import { FormSection } from "../FormSection"
import { WorkPicker, toWorkPickerItem } from "@/src/components/work/WorkPicker"
import { EntitySearchSelect } from "../../search/EntitySearch"
import { DocumentNumberLookup } from "../DocumentNumberLookup"
import { FkField } from "../formkit/DocFormKit"
import { FinancialConditionTable, type FinancialCondition } from "../FinancialConditionTable"
import type { DocFormSchema, FkCtx } from "../SchemaDocumentForm"
import { useToast } from "@/components/ui/toast"

const PubLicenseTermsForm: React.FC<{ ctx: FkCtx }> = ({ ctx }) => {
  const { push } = useToast()
  const { metadata, formData, setFormData, worksList = [], setWorksList } = ctx
  const { ledgers: allLedgers, refreshLedgers } = useAppData()

  const [pubNewWorkTitle, setPubNewWorkTitle] = React.useState("")
  const [pubCreatingWork, setPubCreatingWork] = React.useState(false)
  const [pubNewSourceTitle, setPubNewSourceTitle] = React.useState("")
  const [pubCreatingSource, setPubCreatingSource] = React.useState(false)

  // group メタ → {group → 全fieldIds}(hidden も含む: 旧 groupedVars と等価)。
  const groupedVars = React.useMemo(() => {
    const groups: Record<string, string[]> = {}
    Object.entries(metadata?.vars || {}).forEach(([id, meta]: [string, any]) => {
      const groupName = meta?.group || "General (基本共通)"
      if (!groups[groupName]) groups[groupName] = []
      groups[groupName].push(id)
    })
    return groups
  }, [metadata])

  const renderField = (id: string, customLabel?: string) => (
    <FkField
      key={id}
      id={id}
      metadata={metadata}
      formData={formData}
      setFormData={setFormData}
      labelOverride={customLabel}
    />
  )

  // 未登録の原作をその場で新規作成(POST /api/v3/source-ips が works(licensed_in)+
  //   ledgers+原作本体素材 -001 を原子生成)。allLedgers の再取得は非同期のため
  //   /api/master/ledgers を引き直し、選択時と同じフィールドを補完する。
  const createPubSourceIp = async () => {
    const title = pubNewSourceTitle.trim()
    if (!title) return
    setPubCreatingSource(true)
    try {
      const r = await fetch("/api/v3/source-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      // B系(T2): 同名既存があれば API が {matched:true} を返す(重複作成せず既存を採用)。
      push(
        j?.matched
          ? `同名の既存原作「${j.title || title}」を選択しました（重複作成を防止）`
          : `原作「${title}」を新規登録しました`,
        "success"
      )
      const code = j.work_code || j.source_code || ""
      await refreshLedgers().catch(() => {})
      let created: any = null
      try {
        const lr = await fetch("/api/master/ledgers")
        const ls = await lr.json()
        created = (Array.isArray(ls) ? ls : []).find((l: any) => l.ledger_code === code) || null
      } catch {
        /* 引き直し失敗時は ledger_code だけ保持して続行 */
      }
      setPubNewSourceTitle("")
      setFormData({
        ...formData,
        ...(created?.id != null ? { ledger_ref_id: Number(created.id) } : {}),
        ledger_code: created?.ledger_code || code || formData.ledger_code || "",
        原著作物名: created?.title || title,
      })
    } catch (e) {
      console.error("createPubSourceIp failed", e)
    } finally {
      setPubCreatingSource(false)
    }
  }

  // 対象作品(own)をその場で作成(POST /api/v3/works, title のみ)。保存経路
  //   (work-linkage(pub))が linked_work_id を読んで原作マテリアルを対象作品の
  //   構成・条件明細へ連動させる。
  const createPubOwnWork = async () => {
    const title = pubNewWorkTitle.trim()
    if (!title) return
    setPubCreatingWork(true)
    try {
      const r = await fetch("/api/v3/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const created = await r.json()
      push(
        created?.matched
          ? `同名の既存作品「${created.title || title}」を選択しました（重複作成を防止）`
          : `作品「${title}」を新規登録しました`,
        "success"
      )
      try {
        const listRes = await fetch("/api/v3/works")
        const list = await listRes.json()
        setWorksList(Array.isArray(list) ? list : [])
      } catch {
        /* 一覧再取得失敗は致命的でない */
      }
      setPubNewWorkTitle("")
      if (created?.id != null) {
        setFormData({ ...formData, linked_work_id: String(created.id) })
      }
    } catch (e) {
      console.error("createPubOwnWork failed", e)
    } finally {
      setPubCreatingWork(false)
    }
  }

  // 出版個別条件を統一セクション順に並べ替え + ラベル付け(pub 専用。他テンプレ無影響)。
  const PUB_SECTIONS: Record<string, { order: number; label: string }> = {
    "I. 基本情報": { order: 2, label: "2. 取引先・基本契約設定 — 基本情報" },
    "X. アークライト": { order: 3, label: "3. 当社情報 — アークライト" },
    "II. 許諾期間": { order: 5, label: "5. 共通入力事項 — 許諾期間" },
    "III. 対象著作物": { order: 5, label: "5. 共通入力事項 — 対象著作物" },
    "IV. 許諾内容": { order: 6, label: "6. 専用入力事項 — 許諾内容" },
    "V. 出版条件": { order: 6, label: "6. 専用入力事項 — 出版条件" },
    "VI. 対価・支払条件": { order: 6, label: "6. 専用入力事項 — 対価・支払条件" },
    "VII. 振込口座": { order: 6, label: "6. 専用入力事項 — 振込口座" },
    "VIII. 第三者IP・著作権表示": { order: 6, label: "6. 専用入力事項 — 第三者IP・著作権表示" },
    "IX. 旧合意・特記": { order: 7, label: "7. その他の設定 — 旧合意・特記" },
  }
  const lead = (s: string) => {
    const m = /^\s*(\d+)/.exec(s)
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY
  }
  // 出版の「対価・支払条件」の料率/計算式は共通 FinancialConditionTable(条件表)で
  //   編集。表に無い出版固有 field(部数区分/報告明細/消費税/源泉/インボイス)は従来どおり並べる。
  const PUB_TABLE_OWNED = new Set(["紙媒体計算式", "紙書籍印税率", "電子書籍計算式", "電子書籍印税率"])

  return (
    <div className="space-y-6">
      {/* Phase 26: 出版利用許諾条件書は原作マスタ(ledgers)と紐付け。選択すると
          formData.ledger_ref_id / ledger_code を保持し、原著作物名を原作の正式名称で
          自動入力する(config 側で 原著作物名 は readonly)。※事業部の絞り込みは行わず全原作を表示。 */}
      <FormSection title="1. 作品・原作・基本契約 (マスタ検索)" variant="default">
        {/* 対象作品(own): 保存経路(work-linkage(pub))が formData.linked_work_id を読み、
            原作マテリアルを対象作品の構成・条件明細へ連動させる。ここが唯一の入力点。 */}
        <div className="col-span-full space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            作品設定 — 対象作品（自社作品）
          </label>
          <WorkPicker
            items={worksList.filter((w: any) => w.title).map((w: any) => toWorkPickerItem(w))}
            value={formData.linked_work_id ? String(formData.linked_work_id) : undefined}
            onSelect={(w) => setFormData({ ...formData, linked_work_id: w?.id })}
            placeholder="この契約の対象作品を検索 (コード / タイトル / 別名)"
          />
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] text-muted-foreground shrink-0">または新規:</span>
            <input
              value={pubNewWorkTitle}
              onChange={(e) => setPubNewWorkTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void createPubOwnWork()
                }
              }}
              placeholder="なければ作成: 作品タイトル"
              className="flex-1 text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
            />
            <button
              type="button"
              onClick={() => void createPubOwnWork()}
              disabled={pubCreatingWork || !pubNewWorkTitle.trim()}
              className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
            >
              {pubCreatingWork ? "作成中…" : "＋作成"}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            「どの作品のための契約か」を指定します。一覧に無ければ作品タイトルを入力して作成。保存時に原作マテリアルを対象作品の構成・条件明細へ連動させます。
          </p>
        </div>

        <div className="col-span-full space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            原作 (Ledger) — 選択で「原著作物名」を自動入力（なければ新規作成）
          </label>
          <WorkPicker
            items={(Array.isArray(allLedgers) ? allLedgers : [])
              .filter((l: any) => l.is_active !== false)
              .map((l: any) =>
                toWorkPickerItem(l, {
                  sub:
                    Array.isArray(l.division) && l.division.length
                      ? `〔${l.division.join("/")}〕`
                      : undefined,
                })
              )}
            value={formData.ledger_ref_id ? String(formData.ledger_ref_id) : undefined}
            onSelect={(sel) => {
              const lid = Number(sel?.id)
              const list = Array.isArray(allLedgers) ? allLedgers : []
              const ledger = list.find((l: any) => Number(l.id) === lid)
              if (!lid || !ledger) {
                setFormData({ ...formData, ledger_ref_id: undefined, ledger_code: "", 原著作物名: "" })
                return
              }
              setFormData({
                ...formData,
                ledger_ref_id: lid,
                ledger_code: ledger.ledger_code || "",
                原著作物名: ledger.title || "",
              })
            }}
            placeholder="原作マスタを検索 (LO-コード / タイトル / 別名)"
          />
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] text-muted-foreground shrink-0">または新規:</span>
            <input
              value={pubNewSourceTitle}
              onChange={(e) => setPubNewSourceTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void createPubSourceIp()
                }
              }}
              placeholder="なければ作成: 原作タイトル"
              className="flex-1 text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
            />
            <button
              type="button"
              onClick={() => void createPubSourceIp()}
              disabled={pubCreatingSource || !pubNewSourceTitle.trim()}
              className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
            >
              {pubCreatingSource ? "作成中…" : "＋原作を新規作成"}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            マスター &gt; 原作 (Ledgers) で登録した原作から選択。「原著作物名」は正式名称で自動入力されます（手入力不可）。未登録の原作はタイトル入力で作成でき、原作本体素材 -001 も同時生成されます。
          </p>
        </div>

        {/* Phase 26.9: 基本契約番号を DB (出版基本契約マスタ) から検索して反映。
            許諾者名で初期検索し、ヒットした出版基本契約の番号と締結日を流し込む。 */}
        <div className="col-span-full space-y-1 mt-3">
          <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            基本契約番号 — DB (出版基本契約) から検索して反映
          </label>
          <DocumentNumberLookup
            label="出版基本契約を検索"
            placeholder="取引先名 / 契約番号 / 作品名 で部分検索 (空欄で一覧)"
            includeMaster
            filterTemplateTypes={["pub_master_individual", "pub_master_corporate"]}
            initialQuery={formData["許諾者"] || ""}
            onApply={(doc) => {
              setFormData({
                ...formData,
                基本契約番号: doc.document_number || formData["基本契約番号"] || "",
                ...(doc.master_meta?.effective_date ? { 基本契約締結日: doc.master_meta.effective_date } : {}),
              })
            }}
          />
          {formData["基本契約番号"] && (
            <p className="text-[10px] font-mono text-success">
              選択中の基本契約番号: {formData["基本契約番号"]}
            </p>
          )}
        </div>

        {/* 統一検索モジュール: 許諾者(取引先)を検索して名称/住所/代表者/コードを充填。 */}
        <div className="col-span-full space-y-1 mt-3">
          <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            許諾者(取引先)を検索して充填（DB検索補完）
          </label>
          <EntitySearchSelect
            entity="vendor"
            placeholder="取引先を検索（名称 / コード）"
            onSelect={(o) => {
              if (!o) return
              const v = o.raw || {}
              const isCorp = (v.entity_type || "").toLowerCase() === "corporate" || v.entity_type === "法人"
              const rep = v.vendor_rep || v.contact_name || ""
              setFormData({
                ...formData,
                vendor_code: v.vendor_code || formData.vendor_code || "",
                許諾者: v.vendor_name || "",
                許諾者住所: v.address || "",
                許諾者代表者: rep,
                許諾者種別: isCorp ? "法人" : "個人",
                ...(isCorp ? { 許諾者法人名: v.vendor_name || "" } : { 許諾者氏名: v.vendor_name || "" }),
              })
            }}
          />
        </div>
      </FormSection>

      {/* 出版個別条件を統一セクション順に並べ替え + ラベル付け。VI. 対価・支払条件 には
          共通 FinancialConditionTable(division="PUB")を注入し、表所有 field は除外して並べる。 */}
      {(Object.entries(groupedVars) as [string, string[]][])
        .sort((a, b) => {
          const oa = PUB_SECTIONS[a[0]]?.order ?? lead(a[0])
          const ob = PUB_SECTIONS[b[0]]?.order ?? lead(b[0])
          return oa - ob
        })
        .map(([groupName, varIds]) => {
          if (groupName === "VI. 対価・支払条件") {
            const remaining = varIds.filter((fid) => !PUB_TABLE_OWNED.has(fid))
            return (
              <FormSection
                key={groupName}
                title={PUB_SECTIONS[groupName]?.label || groupName}
                variant="default"
                headerActions={
                  <span className="text-[11px] text-muted-foreground italic">
                    条件 1=紙書籍 / 2=電子書籍 (許諾有無は「許諾内容」で制御・翻訳は二次的著作物として対象外)
                  </span>
                }
              >
                <FinancialConditionTable
                  conditions={
                    Array.isArray(formData.financial_conditions)
                      ? (formData.financial_conditions as FinancialCondition[])
                      : []
                  }
                  onChange={(conditions: FinancialCondition[]) =>
                    setFormData({ ...formData, financial_conditions: conditions })
                  }
                  division="PUB"
                />
                {remaining.map((fid) => renderField(fid))}
              </FormSection>
            )
          }
          return (
            <FormSection
              key={groupName}
              title={PUB_SECTIONS[groupName]?.label || groupName}
              variant="default"
            >
              {varIds.map((fid) => renderField(fid))}
            </FormSection>
          )
        })}
    </div>
  )
}

/**
 * pubLicenseTermsBuilder — 出版等利用許諾条件書スキーマ。
 * 独自レイアウト(作品/原作/基本契約 検索 + PUB 並替 + 条件表)を単一の bare セクションで差し込む。
 * DB補完バーは SchemaDocumentForm の DbFillBar(fillBar 既定 true)が担当。
 */
export function pubLicenseTermsBuilder(_metadata: any): DocFormSchema {
  return {
    sections: [
      {
        bare: true,
        custom: (ctx) => <PubLicenseTermsForm ctx={ctx} />,
      },
    ],
  }
}
