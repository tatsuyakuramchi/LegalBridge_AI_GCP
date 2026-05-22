
import React, { useMemo, useEffect } from 'react';
import { useAppData } from '@/src/context/AppDataContext';
import { FormSection } from './FormSection';
import { FormField } from './FormField';
import { PartySection, SubLicenseeTable } from './SpecializedParts';
import * as MaintenanceSpecParts from './MaintenanceSpecParts';
import { LineItemTable, type LineItem } from './LineItemTable';
import { ExpenseTable, type ExpenseItem } from './ExpenseTable';
import {
  InspectionExpenseSelector,
  type InspectionExpense,
} from './InspectionExpenseSelector';
import {
  DeliveryLineItemTable,
  type OrderLineForInspection,
  type DeliveryLine,
} from './DeliveryLineItemTable';
import {
  FinancialConditionTable,
  type FinancialCondition,
} from './FinancialConditionTable';
import { RoyaltyPreviewPanel } from './RoyaltyPreviewPanel';
import { ParentPoPicker, type PoLoaded } from './ParentPoPicker';
import { DocumentNumberLookup } from './DocumentNumberLookup';
import { TemplateMetadata } from './types';
import { Database, Building2, User, ShieldCheck, Scale, AlertCircle, Link, GitBranch, Briefcase, List, Coins, FileText, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DocumentFormProps {
  templateId: string;
  metadata: TemplateMetadata;
  formData: any;
  setFormData: (data: any) => void;
  onSync: () => void;
  onLinkAsset?: (callback: (asset: any) => void) => void;
  companyProfile?: any;
  activeVendor?: any;
  selectedStaff?: any;
}

export const DocumentForm: React.FC<DocumentFormProps> = ({
  templateId,
  metadata,
  formData,
  setFormData,
  onSync,
  onLinkAsset,
  companyProfile,
  activeVendor,
  selectedStaff
}) => {
  // Group variables by their group property
  const groupedVars = useMemo(() => {
    const groups: Record<string, string[]> = {};
    Object.entries(metadata.vars || {}).forEach(([id, meta]: [string, any]) => {
      const groupName = meta.group || 'General (基本共通)';
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(id);
    });
    return groups;
  }, [metadata]);

  // Phase 9c: 検収書テンプレで selectedStaff が既にあり、かつ
  // 検収者フィールドが空のときは自動で埋める (みなし同意の連絡先が
  // 空欄のまま PDF が出るのを防ぐ)。
  // また documentDate が未入力なら今日の日付で初期化。
  useEffect(() => {
    if (!templateId.startsWith('inspection_certificate')) return;
    const patch: Record<string, any> = {};
    if (
      selectedStaff &&
      !formData.inspectorName &&
      !formData.inspectorDept &&
      !formData.inspectorEmail
    ) {
      patch.inspectorDept = selectedStaff.department || '';
      patch.inspectorName = selectedStaff.staff_name || '';
      patch.inspectorEmail = selectedStaff.email || '';
    }
    if (!formData.documentDate) {
      patch.documentDate = new Date().toISOString().slice(0, 10);
    }
    if (!formData.inspectionCompletedAt) {
      patch.inspectionCompletedAt = new Date().toISOString().slice(0, 10);
    }
    if (!formData.taxRate) {
      patch.taxRate = '10';
    }
    if (Object.keys(patch).length > 0) {
      setFormData({ ...formData, ...patch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, selectedStaff?.staff_name]);

  // Phase 22.9: 取引先 (activeVendor) が選ばれたら、その vendor に紐づく
  //             基本契約 (contract_capabilities) を自動補完。
  //   - 発注書 (purchase_order)               → category="service" の有効な基本契約
  //   - 個別利用許諾条件書 (individual_license_terms) → category="license" の有効な基本契約
  //   - 個別出版条件書 (publication_terms, 将来) → category="publication"
  // 既に該当フィールドに値が入っているときは尊重して上書きしない。
  // 同じ vendor で再評価が走り続けないよう ref で last 状態を持つ。
  //
  // ★ 注意: この useEffect はコンポーネント最上部に置く (Rules of Hooks)。
  const { contracts: allContracts, ledgers: allLedgers } = useAppData();
  const lastAutoFilledRef = React.useRef<string>('');
  useEffect(() => {
    if (!activeVendor || !Array.isArray(allContracts)) return;
    const key = `${activeVendor.vendor_code || activeVendor.id}:${templateId}`;
    if (lastAutoFilledRef.current === key) return;

    let targetCategory: string | null = null;
    if (templateId === 'purchase_order') targetCategory = 'service';
    else if (
      templateId === 'individual_license_terms' ||
      templateId === 'lic_individual'
    )
      targetCategory = 'license';
    else if (templateId === 'publication_terms') targetCategory = 'publication';
    if (!targetCategory) return;

    const masterContract = allContracts.find(
      (c: any) =>
        Number(c.vendor_id) === Number(activeVendor.id) &&
        c.contract_category === targetCategory &&
        c.record_type === 'master_contract' &&
        c.is_active !== false
    );
    if (!masterContract) {
      lastAutoFilledRef.current = key;
      return;
    }

    const refLabel = masterContract.document_number
      ? `${masterContract.contract_title || ''} (${masterContract.document_number})`.trim()
      : masterContract.contract_title || '';

    const patch: Record<string, any> = {};
    if (templateId === 'purchase_order') {
      // 既に基本契約フラグ/参照があれば尊重
      if (!formData.HAS_BASE_CONTRACT && !formData.MASTER_CONTRACT_REF) {
        patch.HAS_BASE_CONTRACT = true;
        patch.MASTER_CONTRACT_REF = refLabel;
      }
    } else if (
      templateId === 'individual_license_terms' ||
      templateId === 'lic_individual'
    ) {
      // 個別利用許諾条件書: 「基本契約名」フィールドを補完
      if (!formData['基本契約名']) {
        patch['基本契約名'] = refLabel;
      }
    } else if (templateId === 'publication_terms') {
      // 個別出版条件書 (将来): MASTER_CONTRACT_REF 等の汎用フィールドを補完予定
      if (!formData.MASTER_CONTRACT_REF) {
        patch.MASTER_CONTRACT_REF = refLabel;
      }
    }

    if (Object.keys(patch).length > 0) {
      setFormData({ ...formData, ...patch });
    }
    lastAutoFilledRef.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVendor?.vendor_code, templateId, allContracts.length]);

  // ---------------------------------------------------------------
  // Phase 22.21.3: 原作 / 素材 マスター由来の auto-fill を初回マウント時にも実行。
  //   `onLedgerChange` / `onMaterialChange` はユーザーが選択し直したときしか
  //   発火しないので、保存済みフォームを再編集で開いた瞬間や、ledgers
  //   マスター fetch 完了の直後に 素材権利者 / クレジット表示 / 原著作物補記
  //   が空のままになるケースがあった。それを補正する retroactive auto-fill。
  //
  //   - templateId が individual_license_terms の時のみ動作
  //   - formData.ledger_ref_id が設定されていて、対応する ledger / material が
  //     allLedgers から取れるときに、未入力フィールドだけ静かに埋める。
  //   - ユーザーが手動で空にしたいケースを壊さないよう、「上書き可能」設計
  //     (= 一度埋めた値は二度と再書き込みしない)。lastLedgerFillRef で抑止。
  //
  //   ★ 注意: Rules of Hooks のため、Early Return より上に置く必要がある。
  // ---------------------------------------------------------------
  const lastLedgerFillRef = React.useRef<string>('');
  useEffect(() => {
    if (
      templateId !== 'individual_license_terms' &&
      templateId !== 'lic_individual'
    )
      return;
    const ledgers = Array.isArray(allLedgers) ? allLedgers : [];
    if (ledgers.length === 0) return;
    const lid = formData.ledger_ref_id ? Number(formData.ledger_ref_id) : 0;
    if (!lid) return;
    const ledger = ledgers.find((l: any) => Number(l.id) === lid);
    if (!ledger) return;

    const materials: any[] = Array.isArray(ledger.materials)
      ? ledger.materials
      : [];
    const mid = formData.material_ref_id
      ? Number(formData.material_ref_id)
      : 0;
    const material = mid
      ? materials.find((m: any) => Number(m.id) === mid) ||
        materials.find((m: any) => m.is_default) ||
        null
      : materials.find((m: any) => m.is_default) || materials[0] || null;

    // 同じ (ledger, material) 組で 1 回だけ実行
    const key = `${lid}:${material ? material.id : 'none'}`;
    if (lastLedgerFillRef.current === key) return;

    const resolveRH = (mat: any, led: any): string =>
      (mat && mat.rights_holder) ||
      (led && led.default_rights_holder) ||
      (led && led.publisher_name) ||
      (led && led.creator_name) ||
      '';
    const resolveCD = (led: any): string => {
      if (led && led.default_credit_display) return led.default_credit_display;
      if (led && led.title) return `© ${led.title}`;
      return '';
    };

    const patch: Record<string, any> = {};
    // 空のときだけ補完 (auto-fill + 上書き可能)
    if (!formData['素材権利者']) {
      const v = resolveRH(material, ledger);
      if (v) patch['素材権利者'] = v;
    }
    if (!formData['クレジット表示']) {
      const v = resolveCD(ledger);
      if (v) patch['クレジット表示'] = v;
    }
    if (!formData['原著作物補記'] && ledger.default_work_supplement) {
      patch['原著作物補記'] = ledger.default_work_supplement;
    }
    // Phase 22.21.7: 承認対象 / 承認時期 の retroactive auto-fill
    if (!formData['承認対象'] && ledger.default_approval_target) {
      patch['承認対象'] = ledger.default_approval_target;
    }
    if (!formData['承認時期'] && ledger.default_approval_timing) {
      patch['承認時期'] = ledger.default_approval_timing;
    }
    // 原著作物名 / 素材番号 / 素材名 も念のため (空のときだけ)
    if (!formData['原著作物名'] && ledger.title) {
      patch['原著作物名'] = ledger.title;
    }
    if (material) {
      if (!formData['素材番号'] && material.material_code) {
        patch['素材番号'] = material.material_code;
      }
      if (!formData['素材名'] && material.material_name) {
        patch['素材名'] = material.material_name;
      }
    }

    if (Object.keys(patch).length > 0) {
      setFormData({ ...formData, ...patch });
    }
    lastLedgerFillRef.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    templateId,
    formData.ledger_ref_id,
    formData.material_ref_id,
    allLedgers?.length,
  ]);

  // Phase 22.7: 発注書のサマリー (納期 / 支払日) を明細から自動集計。
  //   - 明細の delivery_date を集約 → summaryDeliveryDate
  //   - 明細の payment_date を集約 → summaryPaymentDate
  // 集約ロジック:
  //   - 値なし: 空文字
  //   - 全 1 件 / 全同日: その日付を返す (YYYY-MM-DD)
  //   - 複数日付混在: "YYYY/MM/DD 〜 YYYY/MM/DD (明細参照)" 形式
  // ユーザーは入力しない (read-only 表示)。PDF テンプレもこの値を使う。
  //
  // ★ 注意: この useEffect はコンポーネント最上部に置く必要がある。
  //   後段の "if (templateId === 'xxx') return (...)" Early Return より下に
  //   置くと、テンプレ切替時に hook 数が変わって React がクラッシュする
  //   (Rules of Hooks 違反)。実行ガードは effect 内の if 文で行う。
  useEffect(() => {
    if (templateId !== 'purchase_order') return;
    const items: any[] = Array.isArray(formData.items) ? formData.items : [];

    // FIXED/ROYALTY 明細から日付列を集約
    // SUBSCRIPTION 明細は別建て (期間 + 周期サマリ) で集約
    const fixedItems = items.filter((it) => it?.calc_method !== 'SUBSCRIPTION');
    const subItems = items.filter((it) => it?.calc_method === 'SUBSCRIPTION');

    const aggregateDates = (field: 'delivery_date' | 'payment_date'): string => {
      const dates = fixedItems
        .map((it) => (typeof it?.[field] === 'string' ? it[field] : ''))
        .filter((d: string) => d && d.trim() !== '');
      if (dates.length === 0) return '';
      const unique = Array.from(new Set(dates)).sort();
      if (unique.length === 1) return unique[0];
      return `${unique[0]} 〜 ${unique[unique.length - 1]} (明細参照)`;
    };

    // SUBSCRIPTION 明細を 1 行 "毎月25日 (2026/01/01〜2026/12/31)" 形式で並べる
    const cycleShort = (c?: string) =>
      c === 'QUARTERLY'
        ? '四半期'
        : c === 'SEMIANNUAL'
          ? '半年'
          : c === 'ANNUAL'
            ? '年次'
            : '月次';
    const billingDayDisplay = (day?: number, cycle?: string) => {
      if (day === undefined || day === null || Number.isNaN(Number(day))) return '';
      const prefix =
        cycle === 'QUARTERLY'
          ? '毎四半期'
          : cycle === 'SEMIANNUAL'
            ? '毎半期'
            : cycle === 'ANNUAL'
              ? '毎年'
              : '毎月';
      const n = Number(day);
      if (n === 0 || n > 30) return `${prefix}末日`;
      return `${prefix}${n}日`;
    };
    const subSummaryLines = subItems
      .map((it) => {
        const billing = billingDayDisplay(it.billing_day, it.cycle);
        const range =
          (it.term_start ? it.term_start : '—') +
          ' 〜 ' +
          (it.term_end ? it.term_end : '継続中');
        const cyc = cycleShort(it.cycle);
        return `${cyc}・${billing || '(支払日未設定)'} (${range})`;
      })
      .filter((s) => s && s.trim() !== '');

    const nextDelivery = (() => {
      const fixed = aggregateDates('delivery_date');
      if (subSummaryLines.length === 0) return fixed;
      // SUBSCRIPTION 行は「期間で常時納品」扱い → 期間サマリを返す
      const subLabel = subSummaryLines
        .map((line, i) => `${subItems.length > 1 ? `[#${i + 1}] ` : ''}${line.split(' (')[1]?.replace(/\)$/, '') || ''}`)
        .filter(Boolean)
        .join(' / ');
      if (fixed && subLabel) return `${fixed} (固定明細) + サブスク期間: ${subLabel}`;
      if (subLabel) return `サブスク期間: ${subLabel}`;
      return fixed;
    })();

    const nextPayment = (() => {
      const fixed = aggregateDates('payment_date');
      if (subSummaryLines.length === 0) return fixed;
      const subLabel = subSummaryLines
        .map((line, i) =>
          `${subItems.length > 1 ? `[#${i + 1}] ` : ''}${line.split(' (')[0]}`
        )
        .join(' / ');
      if (fixed && subLabel) return `${fixed} (固定明細) + ${subLabel}`;
      if (subLabel) return subLabel;
      return fixed;
    })();

    if (
      formData.summaryDeliveryDate === nextDelivery &&
      formData.summaryPaymentDate === nextPayment
    ) {
      return;
    }
    setFormData({
      ...formData,
      summaryDeliveryDate: nextDelivery,
      summaryPaymentDate: nextPayment,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, formData.items]);

  // Phase 9h: 検収書 — delivery_line_items / taxRate / isReducedTax の
  // どれかが変わったら 税抜合計 / 消費税 / 税込合計 を再計算して
  // テンプレ用フィールド (deliveredAmountStr / taxAmountStr / totalAmountStr)
  // に同期。equality チェックで無限ループ防止。
  useEffect(() => {
    if (!templateId.startsWith('inspection_certificate')) return;
    const lines = Array.isArray(formData.delivery_line_items)
      ? formData.delivery_line_items
      : [];
    if (lines.length === 0) return;

    const total = lines.reduce(
      (sum: number, v: any) => sum + (Number(v.inspected_amount_ex_tax) || 0),
      0
    );
    const taxRate =
      Number(formData.taxRate) || (formData.isReducedTax ? 8 : 10);
    const taxAmount = Math.ceil((total * taxRate) / 100);
    const totalInc = total + taxAmount;

    const newDeliveredStr = total.toLocaleString('ja-JP');
    const newTaxStr = taxAmount.toLocaleString('ja-JP');
    const newTotalStr = totalInc.toLocaleString('ja-JP');

    // Phase 17m: 経費（税込）も加算して総支払額を計算
    const expensesTotalIncTax = Number(formData.expensesTotalIncTax) || 0;
    const grandTotalPayable = totalInc + expensesTotalIncTax;
    const newGrandStr = grandTotalPayable.toLocaleString('ja-JP');

    // 既に同じ値なら setFormData をスキップして無限ループ防止
    if (
      formData.deliveredAmountStr === newDeliveredStr &&
      formData.taxAmountStr === newTaxStr &&
      formData.totalAmountStr === newTotalStr &&
      formData.grandTotalPayableStr === newGrandStr &&
      String(formData.taxRate) === String(taxRate)
    ) {
      return;
    }

    setFormData({
      ...formData,
      deliveredAmountStr: newDeliveredStr,
      taxRate: String(taxRate),
      taxAmountStr: newTaxStr,
      totalAmountStr: newTotalStr,
      grandTotalPayable,
      grandTotalPayableStr: newGrandStr,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    templateId,
    formData.delivery_line_items,
    formData.taxRate,
    formData.isReducedTax,
    formData.expensesTotalIncTax,
  ]);

  const renderField = (id: string, customLabel?: string) => {
    const meta = (metadata.vars || {})[id] || { label: id, group: 'General' };
    const label = customLabel || meta.label || id.replace(/_/g, ' ');
    
    return (
      <FormField 
        key={id} 
        id={id} 
        meta={{ ...meta, label }} 
        value={formData[id]} 
        onChange={(v) => setFormData({ ...formData, [id]: v })} 
      />
    );
  };

  // Logic for individual license terms specialized UI.
  //
  // Driven by templates_config.json's group metadata so the form layout
  // stays in sync with the variable definitions. Both Licensor and
  // Licensee sections expose [自社] and [取引先] buttons because
  // either party can be Arclight depending on whether the deal is
  // inbound or outbound licensing.
  if (templateId === 'individual_license_terms') {
    const isCorporation = (vendor: any) =>
      (vendor?.entity_type || '').toLowerCase() === 'corporate' ||
      (vendor?.entity_type || '') === '法人';

    // Phase 22.19: 原作 / 素材 セレクタ用ヘルパー
    // 選ぶと formData の関連フィールドを自動補完。
    const ledgerList: any[] = Array.isArray(allLedgers) ? allLedgers : [];
    const selectedLedger = formData.ledger_ref_id
      ? ledgerList.find(
          (l: any) => Number(l.id) === Number(formData.ledger_ref_id)
        )
      : null;
    const materialOptions: any[] = selectedLedger?.materials || [];
    const selectedMaterial = formData.material_ref_id
      ? materialOptions.find(
          (m: any) => Number(m.id) === Number(formData.material_ref_id)
        )
      : null;

    // Phase 22.21.2: 素材権利者 / クレジット表示 の fallback チェーンを充実化。
    //   デフォルト値が原作マスターに未入力でも、できる限り意味のある値を埋める。
    const resolveRightsHolder = (material: any, ledger: any): string => {
      // 優先順:
      //   1. material.rights_holder (個別素材で明示指定)
      //   2. ledger.default_rights_holder (原作マスターのデフォルト)
      //   3. ledger.publisher_name (元出版元)
      //   4. ledger.creator_name (著作者)
      //   5. 空文字
      return (
        material?.rights_holder ||
        ledger?.default_rights_holder ||
        ledger?.publisher_name ||
        ledger?.creator_name ||
        ''
      );
    };
    const resolveCreditDisplay = (ledger: any): string => {
      // 優先順:
      //   1. ledger.default_credit_display (原作マスターのデフォルト)
      //   2. "© {ledger.title}" (タイトルから自動生成)
      //   3. 空文字
      if (ledger?.default_credit_display) return ledger.default_credit_display;
      if (ledger?.title) return `© ${ledger.title}`;
      return '';
    };

    const onLedgerChange = (ledgerId: string) => {
      const lid = Number(ledgerId);
      if (!lid) {
        setFormData({
          ...formData,
          ledger_ref_id: undefined,
          material_ref_id: undefined,
          素材番号: '',
          素材名: '',
          素材権利者: '',
          原著作物名: '',
        });
        return;
      }
      const ledger = (Array.isArray(allLedgers) ? allLedgers : []).find(
        (l: any) => Number(l.id) === lid
      );
      // 原作選択時、デフォルトで -001 (原作本体素材) を auto-pick
      const defaultMaterial =
        ledger?.materials?.find((m: any) => m.is_default) ||
        ledger?.materials?.[0];
      // Phase 22.21.3: 原作切り替えは「ユーザーが意図的に主役を変えた」操作
      //   なので、素材権利者/クレジット表示も resolveXxx() の結果で上書きする。
      //   既存値を残したい場合は『素材切替』だけ実施するか、上書き後に編集すれば良い。
      // Phase 22.21.7: 承認対象 / 承認時期 も原作デフォルトから引用
      setFormData({
        ...formData,
        ledger_ref_id: lid,
        material_ref_id: defaultMaterial?.id || undefined,
        素材番号: defaultMaterial?.material_code || '',
        素材名: defaultMaterial?.material_name || '',
        // Phase 22.21.2: 4 段階 fallback で必ず意味のある値を埋める
        素材権利者: resolveRightsHolder(defaultMaterial, ledger),
        原著作物名:
          defaultMaterial?.is_default
            ? ledger?.title || formData.原著作物名 || ''
            : formData.原著作物名 || ledger?.title || '',
        // Phase 22.21.3: ledger 切替時は resolveCreditDisplay() を強制反映
        //   (タイトルが変わるので前の `© 旧タイトル` が残ると混乱の元)
        クレジット表示:
          resolveCreditDisplay(ledger) || formData.クレジット表示 || '',
        原著作物補記:
          ledger?.default_work_supplement || formData.原著作物補記 || '',
        // Phase 22.21.7: 承認対象 / 承認時期 デフォルト
        承認対象:
          ledger?.default_approval_target || formData.承認対象 || '',
        承認時期:
          ledger?.default_approval_timing || formData.承認時期 || '',
      });
    };

    const onMaterialChange = (materialId: string) => {
      const mid = Number(materialId);
      const material = materialOptions.find((m: any) => Number(m.id) === mid);
      if (!material) {
        setFormData({
          ...formData,
          material_ref_id: undefined,
          素材番号: '',
          素材名: '',
          素材権利者: '',
        });
        return;
      }
      setFormData({
        ...formData,
        material_ref_id: mid,
        素材番号: material.material_code || '',
        素材名: material.material_name || '',
        素材権利者: resolveRightsHolder(material, selectedLedger),
        // 原作本体 (is_default) を選んだ場合は 原著作物名 を ledger.title で上書き
        原著作物名: material.is_default
          ? selectedLedger?.title || formData.原著作物名 || ''
          : formData.原著作物名 || material.material_name || '',
      });
    };

    const fillLicensorFromSelf = () =>
      setFormData({
        ...formData,
        Licensor_名称: companyProfile?.name || '',
        Licensor_住所: companyProfile?.address || '',
        Licensor_氏名会社名: companyProfile?.name || '',
        Licensor_代表者名: companyProfile?.representative || '',
        LICENSOR_IS_CORPORATION: true,
      });

    const fillLicensorFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        Licensor_名称: activeVendor.vendor_name || '',
        Licensor_住所: activeVendor.address || '',
        Licensor_氏名会社名: activeVendor.trade_name || activeVendor.vendor_name || '',
        Licensor_代表者名: activeVendor.vendor_rep || activeVendor.contact_name || '',
        LICENSOR_IS_CORPORATION: isCorporation(activeVendor),
      });
    };

    const fillLicenseeFromSelf = () =>
      setFormData({
        ...formData,
        Licensee_名称: companyProfile?.name || '',
        Licensee_住所: companyProfile?.address || '',
        Licensee_氏名会社名: companyProfile?.name || '',
        Licensee_代表者名: companyProfile?.representative || '',
        LICENSEE_IS_CORPORATION: true,
      });

    const fillLicenseeFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        Licensee_名称: activeVendor.vendor_name || '',
        Licensee_住所: activeVendor.address || '',
        Licensee_氏名会社名: activeVendor.trade_name || activeVendor.vendor_name || '',
        Licensee_代表者名: activeVendor.vendor_rep || activeVendor.contact_name || '',
        LICENSEE_IS_CORPORATION: isCorporation(activeVendor),
      });
    };

    const fillStaffAsSupervisor = () => {
      if (!selectedStaff) return;
      setFormData({
        ...formData,
        監修者: selectedStaff.staff_name || '',
        クレジット表示: `© Arclight / ${selectedStaff.staff_name || ''}`,
      });
    };

    const sideButton = (
      label: string,
      onClick: () => void,
      disabled: boolean
    ) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    // Required-completion summary (counts unfilled required fields).
    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });

    // Render a group of fields by group name (from templates_config.json).
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        {/* Required-progress banner */}
        <div
          className={`flex items-center justify-between gap-3 px-4 py-2 rounded-sm border ${
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Phase 22.19: 原作 / 素材 セレクタ
            原作 (ledger) を選ぶと配下の素材一覧が表示され、選択した素材の
            material_code (例: LO-2026-0001-002) が 素材番号 に自動入力される。
            原作本体 (-001) を選んだ場合は ledger.title を 原著作物名 に同期。
            work_id は生成時にサーバ側で自動採番。 */}
        <FormSection
          title="0. 原作・素材"
          variant="emerald"
          icon={<Briefcase className="w-4 h-4" />}
        >
          <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                原作 (Ledger)
              </label>
              <select
                value={formData.ledger_ref_id || ''}
                onChange={(e) => onLedgerChange(e.target.value)}
                className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground"
              >
                <option value="">— 原作を選択 —</option>
                {ledgerList
                  .filter((l: any) => l.is_active !== false)
                  .map((l: any) => (
                    <option key={l.id} value={l.id}>
                      [{l.ledger_code}] {l.title}
                    </option>
                  ))}
              </select>
              <p className="text-[10px] font-mono text-muted-foreground/70">
                マスター &gt; Ledgers で登録した原作 (LO-YYYY-NNNN) から選択
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                素材 (Material)
              </label>
              <select
                value={formData.material_ref_id || ''}
                onChange={(e) => onMaterialChange(e.target.value)}
                disabled={!formData.ledger_ref_id || materialOptions.length === 0}
                className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground disabled:opacity-50"
              >
                <option value="">— 素材を選択 —</option>
                {materialOptions
                  .filter((m: any) => m.is_active !== false)
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      [{m.material_code}]{m.is_default ? ' ★' : ''}{' '}
                      {m.material_name}
                    </option>
                  ))}
              </select>
              <p className="text-[10px] font-mono text-muted-foreground/70">
                ★ = 原作本体 (デフォルト)。派生作品/キャラ等を選択
              </p>
            </div>

            {selectedLedger && selectedMaterial && (
              <div className="md:col-span-2 rounded-sm border border-emerald-200 bg-emerald-50/40 px-3 py-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-700 mb-1">
                  選択中 — 生成時に Work ID が採番されます
                </div>
                <div className="text-[11px] font-mono space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">原作 :</span>{' '}
                    <span className="font-bold">{selectedLedger.ledger_code}</span> ·{' '}
                    {selectedLedger.title}
                  </div>
                  <div>
                    <span className="text-muted-foreground">素材 :</span>{' '}
                    <span className="font-bold">
                      {selectedMaterial.material_code}
                    </span>{' '}
                    · {selectedMaterial.material_name}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 mt-1">
                    予定 Work ID: LIC-{selectedLedger.ledger_code}-W-
                    {new Date().getFullYear()}-NNNN
                    {formData.work_id && (
                      <>
                        {' '}
                        / 既存: <strong>{formData.work_id}</strong>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </FormSection>

        {/* I. ヘッダ */}
        <FormSection title="I. ヘッダ" variant="default" icon={<Briefcase className="w-4 h-4" />}>
          {/* Phase 22.21: 基本契約名 を archived document から検索して反映。
              文書番号 (ARC-LIC-2026-XXXX 等) を入れて「検索」→「適用」で
              フォーム上の formData.基本契約名 / formData.基本契約番号 を一括補完。
              ライセンス系の親契約 (license_master / 過去の individual_license_terms /
              service_master 等) を再利用するときに便利。 */}
          <div className="col-span-full mb-2">
            <DocumentNumberLookup
              label="基本契約をアーカイブから検索 (部分一致 / 空欄で最新一覧)"
              placeholder="例: 株式会社X / GCT / ARC-LIC-2026-0001"
              initialQuery={formData.基本契約番号 || ''}
              filterTemplateTypes={[
                'license_master',
                'service_master',
                'individual_license_terms',
                'sales_master_buyer',
                'sales_master_credit',
                'sales_master_standard',
              ]}
              onApply={(doc) => {
                setFormData({
                  ...formData,
                  基本契約名: doc.derived_title,
                  基本契約番号: doc.document_number,
                  // 任意: 親契約の Drive リンクも保持しておくと PDF テンプレで
                  // 参照可能。テンプレが拾わない場合は無害。
                  基本契約リンク: doc.drive_link || formData.基本契約リンク,
                });
              }}
            />
          </div>
          {renderGroup('I. ヘッダ')}
        </FormSection>

        {/* II/III. Licensor / Licensee — side-swappable parties */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. Licensor (許諾者)"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillLicensorFromSelf, !companyProfile)}
                {sideButton('取引先', fillLicensorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. Licensor (許諾者)')}
          </FormSection>

          <FormSection
            title="III. Licensee (被許諾者)"
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillLicenseeFromSelf, !companyProfile)}
                {sideButton('取引先', fillLicenseeFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('III. Licensee (被許諾者)')}
          </FormSection>
        </div>

        {/* IV. 対象作品・期間 */}
        <FormSection title="IV. 対象作品・期間" variant="emerald" icon={<Scale className="w-4 h-4" />}>
          {renderGroup('IV. 対象作品・期間')}
        </FormSection>

        {/* V. 素材・監修
            Phase 22.21.4: クレジット表示にクイック選択チップ群を追加。
              - 別途協議 : 商談中で確定していないケース
              - © {ledger.title} : 原作タイトルからの自動生成
              - クリア   : 空に戻す
            renderGroup の出力は変えず、その下にプリセット行を挿入することで
            既存の generic Field renderer の振る舞いに影響しない。 */}
        <FormSection
          title="V. 素材・監修"
          variant="default"
          icon={<ShieldCheck className="w-4 h-4" />}
          headerActions={sideButton(
            'Sync Staff',
            fillStaffAsSupervisor,
            !selectedStaff
          )}
        >
          {renderGroup('V. 素材・監修')}
          <div className="col-span-full mt-1 pt-2 border-t border-dashed border-input">
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                クレジット表示 プリセット:
              </span>
              <button
                type="button"
                onClick={() =>
                  setFormData({ ...formData, クレジット表示: '別途協議' })
                }
                className={cn(
                  'text-[10px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
                  formData.クレジット表示 === '別途協議'
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-foreground/30 text-foreground hover:bg-muted'
                )}
              >
                別途協議
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = selectedLedger?.title || formData.原著作物名 || '';
                  if (!t) return;
                  setFormData({ ...formData, クレジット表示: `© ${t}` });
                }}
                disabled={!selectedLedger?.title && !formData.原著作物名}
                className={cn(
                  'text-[10px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
                  'border-foreground/30 text-foreground hover:bg-muted',
                  'disabled:opacity-40 disabled:cursor-not-allowed'
                )}
                title={
                  selectedLedger?.title || formData.原著作物名
                    ? `© ${selectedLedger?.title || formData.原著作物名} を入力`
                    : '原作タイトル未確定 (Ledger を選択 or 原著作物名 を入力)'
                }
              >
                © {selectedLedger?.title || formData.原著作物名 || '(原作名)'}
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, クレジット表示: '' })}
                className="text-[10px] font-mono px-2 py-0.5 uppercase border border-foreground/30 text-foreground hover:bg-muted rounded-sm transition-colors"
              >
                クリア
              </button>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">
              クイック選択で値を上書きできます。手入力も可。
            </p>
          </div>
        </FormSection>

        {/* VI. 金銭条件 — Phase 7d: 統合された FinancialConditionTable。
            DB の license_financial_conditions と同じ shape の rows を
            formData.financial_conditions[] に持つ。worker 側は document
            生成時にこれを (a) HTML テンプレ用 flat field
            {{金銭条件1_料率}} 等に展開, (b) license_financial_conditions
            に upsert する。 */}
        <FormSection
          title="VI. 金銭条件 (条件 1〜3)"
          variant="indigo"
          icon={<Coins className="w-4 h-4" />}
          headerActions={
            <span className="text-[9px] font-mono text-muted-foreground italic">
              条件 1=自社製造 / 2=サブライセンス / 3=プロダクトアウト (任意で追加可)
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
          />
        </FormSection>

        {/* 旧 VI/VII/VIII の自由入力グループは下位互換のため
            details で温存。新しい FinancialConditionTable が優先され、
            こちらは個別微調整 (例: 計算式テキストだけ書きたい等) 用。 */}
        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ 金銭条件 — レガシー自由入力 (任意, 上の表で書ききれない場合のみ) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input space-y-6">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                条件 1 (自社製造)
              </div>
              {renderGroup('VI. 金銭条件 1 (自社製造)')}
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                条件 2 (サブライセンス)
              </div>
              {renderGroup('VII. 金銭条件 2 (サブライセンス, 任意)')}
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                条件 3 (プロダクトアウト)
              </div>
              {renderGroup('VIII. 金銭条件 3 (プロダクトアウト, 任意)')}
            </div>
          </div>
        </details>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ サブライセンシー一覧 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            <SubLicenseeTable formData={formData} setFormData={setFormData} />
          </div>
        </details>

        {/* IX. 特記事項 */}
        <FormSection title="IX. 特記事項" variant="red" icon={<AlertCircle className="w-4 h-4" />}>
          <div className="col-span-full">{renderGroup('IX. 特記事項')}</div>
        </FormSection>
      </div>
    );
  }

  // Specialized Purchase Order Form (Phase 3b-2)
  //
  // Driven by templates_config.json metadata for purchase_order. Same
  // shape as the individual_license_terms redesign:
  //   - Required-progress banner at top
  //   - Side-swappable Vendor / Issuer sections ([自社]/[取引先] buttons)
  //   - Bank info auto-fills from active vendor
  //   - Advanced sections (特約・備考, 契約・署名) collapsed by default
  if (templateId === 'purchase_order') {
    const isCorporation = (vendor: any) =>
      (vendor?.entity_type || '').toLowerCase() === 'corporate' ||
      (vendor?.entity_type || '') === '法人';

    const fillVendorFromPartner = () => {
      if (!activeVendor) return;
      // Phase 17h: 法人/個人 を判定して VENDOR_IS_CORPORATION も同期
      const isCorp = isCorporation(activeVendor);
      setFormData({
        ...formData,
        // Phase 17o: VENDOR_CODE を必ず同期する。
        //   これが無いと worker 側の contract_capabilities ミラー時に
        //   vendor_id が解決できず、法務検索（個別契約）に PO が
        //   表示されない原因になっていた。
        VENDOR_CODE: activeVendor.vendor_code || '',
        VENDOR_NAME: activeVendor.vendor_name || '',
        VENDOR_ADDRESS: activeVendor.address || '',
        VENDOR_REPRESENTATIVE_SAMA: activeVendor.vendor_rep
          ? `${activeVendor.vendor_rep} 様`
          : '',
        VENDOR_CONTACT_DEPARTMENT: activeVendor.contact_department || '',
        VENDOR_CONTACT_NAME: activeVendor.contact_name || '',
        VENDOR_EMAIL: activeVendor.email || '',
        VENDOR_IS_CORPORATION: isCorp ? '法人' : '個人',
        VENDOR_SUFFIX: isCorp ? '御中' : '様',
        // Bank info — common ask, pulled at the same time
        BANK_NAME: activeVendor.bank_name || '',
        BRANCH_NAME: activeVendor.branch_name || '',
        ACCOUNT_TYPE: activeVendor.account_type || '',
        ACCOUNT_NUMBER: activeVendor.account_number || '',
        ACCOUNT_HOLDER_KANA: activeVendor.account_holder_kana || '',
        INVOICE_REGISTRATION_NUMBER: activeVendor.invoice_registration_number || '',
      });
    };

    const fillVendorFromSelf = () =>
      setFormData({
        ...formData,
        VENDOR_NAME: companyProfile?.name || '',
        VENDOR_ADDRESS: companyProfile?.address || '',
        VENDOR_REPRESENTATIVE_SAMA: companyProfile?.representative
          ? `${companyProfile.representative} 様`
          : '',
        VENDOR_IS_CORPORATION: '法人', // 自社は常に法人想定
        VENDOR_SUFFIX: '御中',
      });

    const fillIssuerFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_A_NAME: companyProfile?.name || '',
        PARTY_A_ADDRESS: companyProfile?.address || '',
        PARTY_A_REP: companyProfile?.representative || '',
      });

    const fillIssuerFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_A_NAME: activeVendor.vendor_name || '',
        PARTY_A_ADDRESS: activeVendor.address || '',
        PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const fillStaff = () => {
      if (!selectedStaff) return;
      setFormData({
        ...formData,
        STAFF_NAME: selectedStaff.staff_name || '',
        STAFF_DEPARTMENT: selectedStaff.department || '',
        STAFF_PHONE: selectedStaff.phone || '',
        STAFF_EMAIL: selectedStaff.email || '',
      });
    };

    const sideButton = (
      label: string,
      onClick: () => void,
      disabled: boolean
    ) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    // Required-completion summary
    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });

    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        {/* Required-progress banner */}
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        {/* I. 発注概要 */}
        <FormSection
          title="I. 発注概要"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
          headerActions={
            <button
              type="button"
              onClick={onSync}
              className="text-[8px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted"
              title="Backlog 課題から自動補完"
            >
              <Database className="w-2 h-2 inline mr-1" />
              Backlog Sync
            </button>
          }
        >
          {renderGroup('I. 発注概要')}
        </FormSection>

        {/* II/III. Vendor / Issuer — side-swappable parties */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. 発注先 (取引先)"
            variant="amber"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillVendorFromSelf, !companyProfile)}
                {sideButton('取引先', fillVendorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. 発注先 (取引先)')}
          </FormSection>

          <FormSection
            title="III. 発注元 (自社)"
            variant="blue"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillIssuerFromSelf, !companyProfile)}
                {sideButton('取引先', fillIssuerFromPartner, !activeVendor)}
                {sideButton('Sync Staff', fillStaff, !selectedStaff)}
              </>
            }
          >
            {renderGroup('III. 発注元 (自社)')}
          </FormSection>
        </div>

        {/* IV. 明細 (Phase 7a/7b) — primary path; grandTotalExTax は自動集計 */}
        <FormSection
          title="IV. 明細"
          variant="indigo"
          icon={<List className="w-4 h-4" />}
        >
          <LineItemTable
            items={Array.isArray(formData.items) ? formData.items : []}
            onChange={(items: LineItem[]) => {
              const grandTotal = items.reduce(
                (sum, it) => sum + (Number(it.amount_ex_tax) || 0),
                0
              );
              setFormData({
                ...formData,
                items,
                grandTotalExTax: grandTotal,
              });
            }}
            showPaymentColumns={true}
          />
        </FormSection>

        {/* IV-b. 経費 (Phase 17i) — 交通費等・税込み額表示。
            本体報酬とは別に行単位で経費を保持し、PDF にも経費表として
            出力される。データは order_expenses テーブルに保存。 */}
        <FormSection
          title="IV-b. 経費（交通費等・税込み）"
          variant="indigo"
          icon={<List className="w-4 h-4" />}
        >
          <ExpenseTable
            expenses={Array.isArray(formData.expenses) ? formData.expenses : []}
            onChange={(expenses: ExpenseItem[]) => {
              const expensesTotal = expenses.reduce(
                (sum, e) => sum + (Number(e.amount_inc_tax) || 0),
                0
              );
              setFormData({
                ...formData,
                expenses,
                expensesTotalIncTax: expensesTotal,
              });
            }}
          />
        </FormSection>

        {/* V. 金額サマリ・納期
            Phase 22.7: 納期 / 支払日 は明細から自動集計するので、ユーザー入力
            欄を撤去して計算結果の read-only 表示に変更。
            grandTotalExTax は既に明細から自動集計済 (LineItemTable onChange)。
            単一明細フォールバック (ITEM_NAME/CALC_METHOD/PAYMENT_TERMS/PAYMENT_METHOD)
            は下の Advanced 折り畳みに退避。 */}
        <FormSection title="V. 金額サマリ・納期 (明細から自動集計)" variant="indigo" icon={<Scale className="w-4 h-4" />}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] font-mono">
            <div className="space-y-1">
              <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                合計金額 (税抜)
              </div>
              <div className="text-base font-bold">
                ¥ {Number(formData.grandTotalExTax || 0).toLocaleString('ja-JP')}
              </div>
              <div className="text-[9px] text-muted-foreground/70 italic">
                明細の小計を合算 (税は別途)
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                納期 (自動集計)
              </div>
              <div className="text-sm font-bold">
                {formData.summaryDeliveryDate || (
                  <span className="text-muted-foreground/60 font-normal italic">
                    明細の納期が未入力
                  </span>
                )}
              </div>
              <div className="text-[9px] text-muted-foreground/70 italic">
                明細の納期から集約 (全同日ならその日付、複数日付なら範囲表示)
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                支払日 (自動集計)
              </div>
              <div className="text-sm font-bold">
                {formData.summaryPaymentDate || (
                  <span className="text-muted-foreground/60 font-normal italic">
                    明細の支払日が未入力
                  </span>
                )}
              </div>
              <div className="text-[9px] text-muted-foreground/70 italic">
                明細の支払日から集約
              </div>
            </div>
          </div>
        </FormSection>

        {/* IV-z. 単一明細用 (任意) — 通常は IV. 明細表を使うので折り畳み
            grandTotalExTax は明細表を使う場合は LineItemTable から自動入力されるが、
            ここでも明示的に editable で出して、明細を使わないユーザーが
            手入力できるようにする。 */}
        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ IV-z. 単一明細用フォールバック (任意・上級者向け) — 明細表が空のときだけ参照される
          </summary>
          <div className="p-4 border-t border-input space-y-3">
            <p className="text-[10px] font-mono text-muted-foreground italic">
              通常は <strong>IV. 明細</strong> 表を使ってください。以下は
              旧テンプレートとの後方互換のための入力で、明細表が空の場合のみ PDF に反映されます。
              明細表を使う場合は <code>合計金額</code> は自動集計されるのでここを触る必要はありません。
            </p>
            {renderField(
              'grandTotalExTax',
              '合計金額 (税抜) — 手入力 (明細表を使わない場合のみ)'
            )}
            {renderGroup('IV-z. 単一明細用 (任意・上級者向け)')}
          </div>
        </details>

        {/* VI. 振込先 */}
        <FormSection
          title="VI. 振込先 (取引先口座)"
          variant="emerald"
          headerActions={sideButton('取引先', fillVendorFromPartner, !activeVendor)}
        >
          {renderGroup('V. 振込先 (取引先口座)')}
        </FormSection>

        {/* VI. 特約・備考 — collapsed */}
        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VI. 特約・備考 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            {renderGroup('VI. 特約・備考 (任意)')}
          </div>
        </details>

        {/* VII. 契約・署名 — collapsed */}
        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VII. 契約・署名 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input space-y-3">
            {/* Phase 22.21: 発注書も基本契約を文書番号で検索して反映できるように。
                適用すると HAS_BASE_CONTRACT=true + MASTER_CONTRACT_REF が埋まる。 */}
            <DocumentNumberLookup
              label="基本契約をアーカイブから検索 (部分一致 / 空欄で最新一覧)"
              placeholder="例: 株式会社X / GCT / ARC-SVC-2026-0001"
              initialQuery={formData.MASTER_CONTRACT_NUMBER || ''}
              filterTemplateTypes={[
                'service_master',
                'license_master',
                'sales_master_buyer',
                'sales_master_credit',
                'sales_master_standard',
              ]}
              onApply={(doc) => {
                setFormData({
                  ...formData,
                  HAS_BASE_CONTRACT: true,
                  MASTER_CONTRACT_REF: `${doc.derived_title} (${doc.document_number})`,
                  MASTER_CONTRACT_NUMBER: doc.document_number,
                  MASTER_CONTRACT_LINK: doc.drive_link || formData.MASTER_CONTRACT_LINK,
                });
              }}
            />
            {renderGroup('VII. 契約・署名 (任意)')}
          </div>
        </details>
      </div>
    );
  }

  // Specialized License Master (Phase 3b-4)
  //
  // VENDOR_* in the template == ライセンサー / PARTY_A_* == ライセンシー.
  // The default mapping (Vendor=取引先, PARTY_A=自社) covers inbound
  // licensing; the swap buttons cover the inverted case. Bank info on
  // a license master is the licensor's royalty receive account, so it
  // auto-fills from the active vendor's bank columns when [取引先] is
  // clicked on that section.
  if (templateId === 'license_master') {
    const fillVendorFromSelf = () =>
      setFormData({
        ...formData,
        VENDOR_NAME: companyProfile?.name || '',
        VENDOR_ADDRESS: companyProfile?.address || '',
        VENDOR_REP: companyProfile?.representative || '',
      });

    const fillVendorFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        // Phase 17o: VENDOR_CODE を必ず同期 (法務検索の vendor_id 解決用)
        VENDOR_CODE: activeVendor.vendor_code || '',
        VENDOR_NAME: activeVendor.vendor_name || '',
        VENDOR_ADDRESS: activeVendor.address || '',
        VENDOR_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
        VENDOR_PHONE: activeVendor.phone || '',
        VENDOR_EMAIL: activeVendor.email || '',
        // Bank info commonly follows the licensor on a license master
        BANK_NAME: activeVendor.bank_name || '',
        BRANCH_NAME: activeVendor.branch_name || '',
        ACCOUNT_TYPE: activeVendor.account_type || '',
        ACCOUNT_NUMBER: activeVendor.account_number || '',
        ACCOUNT_HOLDER_KANA: activeVendor.account_holder_kana || '',
        IS_INVOICE_ISSUER: !!activeVendor.is_invoice_issuer,
        invoiceRegistrationDisplay: activeVendor.invoice_registration_number
          ? `T${activeVendor.invoice_registration_number}`
          : '',
      });
    };

    const fillPartyAFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_A_NAME: companyProfile?.name || '',
        PARTY_A_ADDRESS: companyProfile?.address || '',
        PARTY_A_REP: companyProfile?.representative || '',
      });

    const fillPartyAFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_A_NAME: activeVendor.vendor_name || '',
        PARTY_A_ADDRESS: activeVendor.address || '',
        PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection title="I. ヘッダ" variant="default" icon={<Briefcase className="w-4 h-4" />}>
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. ライセンサー (許諾者)"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillVendorFromSelf, !companyProfile)}
                {sideButton('取引先', fillVendorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. ライセンサー (許諾者)')}
          </FormSection>

          <FormSection
            title="III. ライセンシー (被許諾者)"
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillPartyAFromSelf, !companyProfile)}
                {sideButton('取引先', fillPartyAFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('III. ライセンシー (被許諾者)')}
          </FormSection>
        </div>

        <FormSection
          title="IV. 振込先口座 (ロイヤリティ送金先)"
          variant="emerald"
          headerActions={sideButton('取引先', fillVendorFromPartner, !activeVendor)}
        >
          {renderGroup('IV. 振込先口座 (ロイヤリティ送金先)')}
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ V. 備考 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('V. 備考 (任意)')}</div>
        </details>
      </div>
    );
  }

  // Specialized Service Master (業務委託基本契約書, Phase 3b-4 v2)
  //
  // The template now ships with explicit 甲 (PARTY_A_*) and 乙 (VENDOR_*)
  // form variables, banking info, and an invoice block — mirroring the
  // shape of license_master. Both party sections expose [自社]/[取引先]
  // buttons because the inbound/outbound case applies here too
  // (Arclight is normally the 委託者 = 甲 but the swap supports
  // edge scenarios where roles are inverted).
  if (templateId === 'service_master') {
    // Phase 22.5: 乙 (受託者) の 法人/個人 判定。
    //   未設定 (新規 / 既存 doc に値なし) は "法人" デフォルト。
    //   個人選択時は VENDOR_REP フィールドを非表示 + 必須から除外し、
    //   VENDOR_NAME のラベルを「商号」→「氏名」に切り替える。
    //   テンプレ HTML 側も {{#if (eq VENDOR_IS_CORPORATION "個人")}} で
    //   同じ分岐を行うので、PDF も自動で個人形式 (氏名のみ) に切り替わる。
    const isVendorCorp =
      (formData.VENDOR_IS_CORPORATION || '法人') === '法人';

    // vendor.entity_type → "法人" / "個人" への正規化。
    // worker / api 両方 "corporate" / "individual" (英) で持つが、
    // 旧データには日本語値も混在しうるので両方カバーする。
    const entityTypeToJa = (et?: string | null): '法人' | '個人' => {
      const v = String(et || '').toLowerCase();
      if (v === 'individual' || et === '個人') return '個人';
      return '法人';
    };

    const fillPartyAFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_A_NAME: companyProfile?.name || '',
        PARTY_A_ADDRESS: companyProfile?.address || '',
        PARTY_A_REP: companyProfile?.representative || '',
      });

    const fillPartyAFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_A_NAME: activeVendor.vendor_name || '',
        PARTY_A_ADDRESS: activeVendor.address || '',
        PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const fillVendorFromSelf = () =>
      setFormData({
        ...formData,
        VENDOR_NAME: companyProfile?.name || '',
        VENDOR_ADDRESS: companyProfile?.address || '',
        VENDOR_REP: companyProfile?.representative || '',
        VENDOR_IS_CORPORATION: '法人', // 自社は常に法人想定
      });

    const fillVendorFromPartner = () => {
      if (!activeVendor) return;
      const isCorp = entityTypeToJa(activeVendor.entity_type) === '法人';
      setFormData({
        ...formData,
        // Phase 17o: VENDOR_CODE を必ず同期 (法務検索の vendor_id 解決用)
        VENDOR_CODE: activeVendor.vendor_code || '',
        // Phase 22.5: 法人=正式名 (vendor_name) / 個人=屋号 or 氏名 (pen_name → trade_name → vendor_name)
        VENDOR_NAME: isCorp
          ? activeVendor.vendor_name || ''
          : activeVendor.pen_name ||
            activeVendor.trade_name ||
            activeVendor.vendor_name ||
            '',
        VENDOR_ADDRESS: activeVendor.address || '',
        // 個人の場合、代表者欄は非表示なので空文字で OK
        VENDOR_REP: isCorp
          ? activeVendor.vendor_rep || activeVendor.contact_name || ''
          : '',
        VENDOR_PHONE: activeVendor.phone || '',
        VENDOR_EMAIL: activeVendor.email || '',
        VENDOR_IS_CORPORATION: isCorp ? '法人' : '個人',
        // Banking commonly belongs to 乙 on a service master
        BANK_NAME: activeVendor.bank_name || '',
        BRANCH_NAME: activeVendor.branch_name || '',
        ACCOUNT_TYPE: activeVendor.account_type || '',
        ACCOUNT_NUMBER: activeVendor.account_number || '',
        ACCOUNT_HOLDER_KANA: activeVendor.account_holder_kana || '',
        IS_INVOICE_ISSUER: activeVendor.is_invoice_issuer ? '該当' : '非該当',
        invoiceRegistrationDisplay: activeVendor.invoice_registration_number
          ? `T${activeVendor.invoice_registration_number}`
          : '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    // Phase 22.5: 個人事業主の場合は VENDOR_REP を必須から除外
    // (テンプレ側でも非表示なので、入力する場所がなくなるため)
    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([id, m]: [string, any]) => {
        if (m?.required !== true) return false;
        if (id === 'VENDOR_REP' && !isVendorCorp) return false;
        return true;
      })
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    // 乙セクション専用の renderGroup。
    //   - 個人選択時は VENDOR_REP フィールドを非表示
    //   - VENDOR_NAME のラベルを 法人/個人 で切替 (商号 / 氏名)
    const renderVendorGroup = () =>
      (groupedVars['III. 乙 (受託者)'] || [])
        .filter((fid) => !(fid === 'VENDOR_REP' && !isVendorCorp))
        .map((fid) => {
          if (fid === 'VENDOR_NAME') {
            return renderField(
              fid,
              isVendorCorp ? '乙 (受託者) 商号' : '乙 (受託者) 氏名'
            );
          }
          return renderField(fid);
        });

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection
          title="I. 契約締結日"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
        >
          <div className="grid grid-cols-3 gap-3">{renderGroup('I. 契約締結日')}</div>
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. 甲 (委託者)"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillPartyAFromSelf, !companyProfile)}
                {sideButton('取引先', fillPartyAFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. 甲 (委託者)')}
          </FormSection>

          <FormSection
            title={isVendorCorp ? 'III. 乙 (受託者・法人)' : 'III. 乙 (受託者・個人)'}
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillVendorFromSelf, !companyProfile)}
                {sideButton('取引先', fillVendorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderVendorGroup()}
          </FormSection>
        </div>

        <FormSection
          title="IV. 振込先銀行口座 (乙)"
          variant="emerald"
          headerActions={sideButton('取引先', fillVendorFromPartner, !activeVendor)}
        >
          {renderGroup('IV. 振込先銀行口座 (乙)')}
        </FormSection>

        <FormSection title="V. インボイス制度関連" variant="indigo">
          {renderGroup('V. インボイス制度関連')}
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VI. 特約 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('VI. 特約 (任意)')}</div>
        </details>
      </div>
    );
  }

  // Specialized Inspection Form (Phase 3b-5)
  //
  // 受託者 = vendor side, 検収者 = staff/self side. We keep the existing
  // 3-column layout for the top row (basic / vendor / staff) but
  // replace the legacy Master-Sync / Staff-Sync buttons with the
  // standard sideButton helper and add the required-progress banner.
  //
  // NOTE: applies to all inspection_certificate variants
  // (inspection_certificate, _v2, _detailed) via startsWith. Metadata
  // is keyed to the main inspection_certificate template; _v2 / _detailed
  // share the same field IDs where they overlap.
  if (templateId.startsWith('inspection_certificate')) {
    const fillCounterpartyFromPartner = () => {
      if (!activeVendor) return;
      // Phase 9d: 法人/個人を select 「法人」/「個人」 文字列で保存。
      //   - 法人: 会社名「御中」 + 棒線 + 代表者「様」
      //   - 個人: 名前「様」のみ
      const isCorporation =
        (activeVendor.entity_type || '').toLowerCase() === 'corporate' ||
        activeVendor.entity_type === '法人';
      const repName =
        activeVendor.vendor_rep || activeVendor.contact_name || '';
      setFormData({
        ...formData,
        counterparty: activeVendor.vendor_name || '',
        COUNTERPARTY_IS_CORPORATION: isCorporation ? '法人' : '個人',
        counterpartyRep: repName,
        // Legacy フィールドも残しておく (旧テンプレ・既存生成済み doc の form_data 互換)
        counterpartyRepresentativeSama: repName ? `${repName} 様` : '',
        counterpartyTni: activeVendor.invoice_registration_number || '',
        // Bank info commonly populated at the same time
        bankName: activeVendor.bank_name || '',
        branchName: activeVendor.branch_name || '',
        accountType: activeVendor.account_type || '',
        accountNo: activeVendor.account_number || '',
        accountHolder: activeVendor.account_holder_kana || '',
      });
    };

    const fillInspectorFromStaff = () => {
      if (!selectedStaff) return;
      setFormData({
        ...formData,
        inspectorDept: selectedStaff.department || '',
        inspectorName: selectedStaff.staff_name || '',
        // Phase 9b: みなし同意ブロックの連絡先用
        inspectorEmail: selectedStaff.email || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection
          title="I. 基本情報"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
          headerActions={
            <button
              type="button"
              onClick={onSync}
              className="text-[8px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted"
              title="Backlog 課題から自動補完"
            >
              <Database className="w-2 h-2 inline mr-1" />
              Backlog Sync
            </button>
          }
        >
          {renderGroup('I. 基本情報')}
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. 受託者 (取引先)"
            variant="amber"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={sideButton('取引先', fillCounterpartyFromPartner, !activeVendor)}
          >
            {renderGroup('II. 受託者 (取引先)')}
          </FormSection>

          <FormSection
            title="III. 検収者 (自社)"
            variant="emerald"
            icon={<User className="w-4 h-4" />}
            headerActions={sideButton('Sync Staff', fillInspectorFromStaff, !selectedStaff)}
          >
            {renderGroup('III. 検収者 (自社)')}
          </FormSection>
        </div>

        {/* Phase 8c: 親 PO ピッカー — Backlog 親子経由で自動発見できない
            ケース (IMPORT-* PO / 親子未設定) のためのフォールバック手段。
            form-context が既に親 PO を載せていても、ここで上書き可能。 */}
        <ParentPoPicker
          currentKey={formData.parent_po_issue_key}
          hasParent={
            Array.isArray(formData.order_lines_for_inspection) &&
            formData.order_lines_for_inspection.length > 0
          }
          onPick={(loaded: PoLoaded) => {
            // Phase 9c/f: 親 PO 選択時に PDF が必要とする全フィールドを一括流し込み
            const firstLine = loaded.line_items?.[0];
            const v = loaded.vendor || {};
            const isCorp =
              (v.entity_type || '').toLowerCase() === 'corporate' ||
              v.entity_type === '法人';
            const repName = v.vendor_rep || v.contact_name || '';
            const todayIso = new Date().toISOString().slice(0, 10);
            const poHeader = loaded.raw?.order_item || {};
            const prog = loaded.delivery_progress;

            setFormData({
              ...formData,
              parent_po_id: loaded.order_item_id,
              parent_po_issue_key: loaded.backlog_issue_key,
              parent_po_number: loaded.document_number || '',
              order_lines_for_inspection: loaded.line_items,
              // 発注情報セクション
              orderDate: poHeader.due_date || poHeader.created_at || '',
              itemCount: String((loaded.line_items || []).length || 1),
              itemNo: formData.itemNo || '1',
              // Phase 9h: 親 PO の tax_rate を優先採用
              taxRate: String(poHeader.tax_rate || formData.taxRate || 10),
              // 検収書発行日 (未入力なら今日で初期化)
              documentDate: formData.documentDate || todayIso,
              // Phase 9f: 分割検収サポート — 既存検収件数 +1 を採番、
              // 進捗バー用の値もまとめてセット
              ...(prog && {
                deliveryNo: String(prog.next_delivery_no),
                isPartial:
                  prog.is_partial || prog.next_delivery_no > 1
                    ? '分割'
                    : '完了',
                inspectedAmountStr: prog.done_amount_ex_tax.toLocaleString('ja-JP'),
                pendingAmountStr: prog.remaining_amount_ex_tax.toLocaleString('ja-JP'),
                totalOrderAmountStr: (
                  prog.done_amount_ex_tax + prog.remaining_amount_ex_tax
                ).toLocaleString('ja-JP'),
                inspectedPct: String(prog.inspected_pct),
              }),
              // 今回納品内容: 第 1 行を default 補完 (multi-line PO は適宜手動編集)
              description:
                formData.description || (firstLine?.item_name || ''),
              spec: formData.spec || (firstLine?.spec || ''),
              // 取引先情報 (PO の vendor_code から JOIN)
              ...(v.vendor_name && {
                counterparty: formData.counterparty || v.vendor_name,
                COUNTERPARTY_IS_CORPORATION: isCorp ? '法人' : '個人',
                counterpartyRep: formData.counterpartyRep || repName,
                counterpartyRepresentativeSama:
                  formData.counterpartyRepresentativeSama ||
                  (repName ? `${repName} 様` : ''),
                counterpartyTni:
                  formData.counterpartyTni ||
                  v.invoice_registration_number ||
                  '',
                bankName: formData.bankName || v.bank_name || '',
                branchName: formData.branchName || v.branch_name || '',
                accountType: formData.accountType || v.account_type || '',
                accountNo: formData.accountNo || v.account_number || '',
                accountHolder:
                  formData.accountHolder || v.account_holder_kana || '',
              }),
              // 親を切り替えたら検収入力は一旦リセット (overflow 整合のため)
              delivery_line_items: [],
              deliveredAmountStr: '',
              // Phase 17m: 親 PO の経費（精算候補）も流し込む
              po_expenses: Array.isArray(loaded.expenses) ? loaded.expenses : [],
              selectedExpenseLineNos: [],
              isFinalInspection: false,
              expenses: [],
              expensesTotalIncTax: 0,
            });
          }}
          onClear={() => {
            setFormData({
              ...formData,
              parent_po_id: undefined,
              parent_po_issue_key: undefined,
              order_lines_for_inspection: [],
              delivery_line_items: [],
              // Phase 17m: 経費精算もクリア
              po_expenses: [],
              selectedExpenseLineNos: [],
              isFinalInspection: false,
              expenses: [],
              expensesTotalIncTax: 0,
            });
          }}
        />

        {/* Phase 7c: 親 PO の明細別検収テーブル。
            form-context が parent_po_id + order_lines_for_inspection[] を
            返したときだけ表示する。それ以外 (親なし) のときは従来の
            自由入力フォームにフォールバック。 */}
        {Array.isArray(formData.order_lines_for_inspection) &&
        formData.order_lines_for_inspection.length > 0 ? (
          <FormSection
            title="IV. 明細別検収 (親 PO 連動)"
            variant="indigo"
            icon={<Scale className="w-4 h-4" />}
            headerActions={
              <span className="text-[9px] font-mono text-muted-foreground italic">
                親 PO: {formData.parent_po_issue_key || "—"}
              </span>
            }
          >
            <DeliveryLineItemTable
              orderLines={formData.order_lines_for_inspection as OrderLineForInspection[]}
              values={(Array.isArray(formData.delivery_line_items)
                ? formData.delivery_line_items
                : []) as DeliveryLine[]}
              onChange={(values: DeliveryLine[]) => {
                // Phase 9h: 検収明細の変更ごとに 税抜合計 / 消費税 / 税込合計
                // を再計算してテンプレ用フィールドに同時セット。
                //   - taxRate は formData.taxRate (なければ 10)
                //   - taxAmount = Math.ceil(total × rate / 100)
                //   - 軽減税率 (8%) は isReducedTax で切り替え可能
                const total = values.reduce(
                  (sum, v) => sum + (Number(v.inspected_amount_ex_tax) || 0),
                  0
                );
                const taxRate = Number(formData.taxRate)
                  || (formData.isReducedTax ? 8 : 10);
                const taxAmount = Math.ceil((total * taxRate) / 100);
                const totalInc = total + taxAmount;
                setFormData({
                  ...formData,
                  delivery_line_items: values,
                  deliveredAmountStr: total.toLocaleString("ja-JP"),
                  taxRate: String(taxRate),
                  taxAmountStr: taxAmount.toLocaleString("ja-JP"),
                  totalAmountStr: totalInc.toLocaleString("ja-JP"),
                });
              }}
            />
          </FormSection>
        ) : (
          <FormSection
            title="IV. 納品明細 (自由入力)"
            variant="indigo"
            icon={<Scale className="w-4 h-4" />}
            headerActions={
              onLinkAsset && (
                <button
                  type="button"
                  onClick={() =>
                    onLinkAsset((asset) =>
                      setFormData({
                        ...formData,
                        linked_po_number: asset.asset_number,
                        linked_po_link: asset.file_link,
                      })
                    )
                  }
                  className="text-[8px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted flex items-center gap-1"
                >
                  <Link className="w-2 h-2" /> PO紐付
                </button>
              )
            }
          >
            {renderGroup('IV. 納品明細')}
          </FormSection>
        )}

        {/* IV-b. 経費精算 (Phase 17m) — 親 PO に経費がある時だけ表示。
            チェックを入れた経費だけが今回検収の支払額に加算され、PDF に
            「経費（税込）」セクションが描画される。 */}
        {Array.isArray(formData.po_expenses) && formData.po_expenses.length > 0 && (
          <FormSection
            title="IV-b. 経費精算（親 PO 連動）"
            variant="indigo"
            icon={<Scale className="w-4 h-4" />}
          >
            <InspectionExpenseSelector
              poExpenses={formData.po_expenses as InspectionExpense[]}
              selectedLineNos={
                Array.isArray(formData.selectedExpenseLineNos)
                  ? formData.selectedExpenseLineNos
                  : []
              }
              isFinalInspection={!!formData.isFinalInspection}
              onToggleFinal={(v: boolean) => {
                setFormData({ ...formData, isFinalInspection: v });
              }}
              onChange={(selected: number[]) => {
                const selectedSet = new Set(selected);
                const expenses = (formData.po_expenses as InspectionExpense[])
                  .filter((e) => selectedSet.has(e.line_no));
                const expensesTotalIncTax = expenses.reduce(
                  (s, e) => s + (Number(e.amount_inc_tax) || 0),
                  0
                );
                // 検収金額（税込）+ 経費（税込）= 総支払額
                const totalIncTax = Number(
                  String(formData.totalAmountStr || "0").replace(/[^0-9.-]+/g, "")
                ) || 0;
                const grandTotalPayable = totalIncTax + expensesTotalIncTax;
                setFormData({
                  ...formData,
                  selectedExpenseLineNos: selected,
                  expenses,
                  expensesTotalIncTax,
                  expensesTotalIncTaxStr:
                    expensesTotalIncTax.toLocaleString("ja-JP"),
                  grandTotalPayable,
                  grandTotalPayableStr: grandTotalPayable.toLocaleString("ja-JP"),
                });
              }}
            />
          </FormSection>
        )}

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ V. 進捗・財務 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('V. 進捗・財務 (任意)')}</div>
        </details>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VI. 振込先 (受託者口座, 任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">
            {renderGroup('VI. 振込先 (受託者口座, 任意)')}
          </div>
        </details>
      </div>
    );
  }

  // Specialized Royalty Form (利用許諾料計算書, Phase 3b-5)
  //
  // licensor = vendor side (IP owner), licensee = self side (Arclight).
  // Both sections have side buttons in case the deal is inverted.
  if (templateId === 'royalty_statement') {
    const fillLicensorFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        licensor: activeVendor.vendor_name || '',
        VENDOR_REPRESENTATIVE_SAMA: activeVendor.vendor_rep
          ? `${activeVendor.vendor_rep} 様`
          : '',
      });
    };

    const fillLicensorFromSelf = () =>
      setFormData({
        ...formData,
        licensor: companyProfile?.name || '',
      });

    const fillLicenseeFromSelf = () =>
      setFormData({
        ...formData,
        licensee: companyProfile?.name || '',
      });

    const fillLicenseeFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        licensee: activeVendor.vendor_name || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection
          title="I. ヘッダ"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
          headerActions={
            onLinkAsset && (
              <button
                type="button"
                onClick={() =>
                  onLinkAsset((asset) =>
                    setFormData({
                      ...formData,
                      linked_terms_number: asset.asset_number,
                      linked_terms_link: asset.file_link,
                    })
                  )
                }
                className="text-[8px] font-mono border border-foreground/30 px-2 py-0.5 uppercase rounded-sm hover:bg-muted flex items-center gap-1"
              >
                <Link className="w-2 h-2" /> 個別紐付
              </button>
            )
          }
        >
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. ライセンサー (取引先)"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillLicensorFromSelf, !companyProfile)}
                {sideButton('取引先', fillLicensorFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. ライセンサー (取引先)')}
          </FormSection>

          <FormSection
            title="III. ライセンシー (自社)"
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillLicenseeFromSelf, !companyProfile)}
                {sideButton('取引先', fillLicenseeFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('III. ライセンシー (自社)')}
          </FormSection>
        </div>

        <FormSection
          title="IV. 対象作品・製造"
          variant="emerald"
          icon={<ShieldCheck className="w-4 h-4" />}
        >
          {renderGroup('IV. 対象作品・製造')}
        </FormSection>

        {/* V. ロイヤリティ計算 — Phase 7e: 右ペインにライブ計算プレビュー。
            form-context が license_contract_id + financial_conditions[] を
            プリセットしているとき、ユーザーは
              ・条件 1〜N の選択 (calc target)
              ・基準価格 / 数量 / サンプル数量 / 税率
            の 4 つを動かすだけで、サーバ側 billing.calculateFee の結果が
            300ms デバウンスで右側に出る。Math.ceil の挙動も含めて UI 上で
            確定保存前に検証できる。 */}
        <FormSection
          title="V. ロイヤリティ計算"
          variant="indigo"
          icon={<Scale className="w-4 h-4" />}
        >
          <div className="col-span-full grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* 左 3/5: 既存フィールド + condition ピッカー */}
            <div className="lg:col-span-3 space-y-3">
              {/* 金銭条件ピッカー — form-context から拾った行を radio で選ぶ */}
              {Array.isArray(formData.financial_conditions) &&
              formData.financial_conditions.length > 0 ? (
                <div className="border border-input rounded-sm p-3 bg-muted/20">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    計算対象の金銭条件
                  </div>
                  <div className="space-y-1.5">
                    {(
                      formData.financial_conditions as FinancialCondition[]
                    ).map((c) => {
                      const cid = Number(c.id);
                      const selected =
                        Number(formData.license_financial_condition_id) === cid;
                      return (
                        <label
                          key={cid || c.condition_no}
                          className={cn(
                            'flex items-center gap-2 cursor-pointer text-[11px] font-mono p-1.5 rounded-sm',
                            selected
                              ? 'bg-foreground text-background'
                              : 'hover:bg-muted/40'
                          )}
                        >
                          <input
                            type="radio"
                            name="license_financial_condition_id"
                            checked={selected}
                            onChange={() =>
                              setFormData({
                                ...formData,
                                license_financial_condition_id: cid,
                                // 料率もこの条件で上書き (HTML テンプレ用 legacy)
                                料率:
                                  c.rate_pct !== undefined
                                    ? String(c.rate_pct)
                                    : formData.料率,
                              })
                            }
                            className="cursor-pointer"
                          />
                          <span className="font-bold">条件 {c.condition_no}</span>
                          <span className="opacity-70">
                            {c.calc_method || '—'}
                          </span>
                          <span className="opacity-70">
                            {c.rate_pct !== undefined ? `${c.rate_pct}%` : ''}
                          </span>
                          {c.mg_amount && c.mg_amount > 0 ? (
                            <span className="opacity-70">
                              MG {Number(c.mg_amount).toLocaleString('ja-JP')}
                            </span>
                          ) : null}
                          {c.region_language_label && (
                            <span className="opacity-60 ml-auto text-[9px]">
                              {c.region_language_label}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : formData.license_contract_id ? (
                <div className="text-[10px] font-mono text-muted-foreground italic">
                  ライセンス契約 ID は紐付き済ですが、金銭条件が未登録です。
                  先に「個別利用許諾条件書」を作成してください。
                </div>
              ) : null}

              {renderGroup('V. ロイヤリティ計算')}
            </div>

            {/* 右 2/5: ライブ計算プレビュー */}
            <div className="lg:col-span-2">
              <RoyaltyPreviewPanel
                licenseContractId={Number(formData.license_contract_id)}
                licenseFinancialConditionId={Number(
                  formData.license_financial_condition_id
                )}
                unitPrice={Number(formData.基準価格 || formData.MSRP || 0)}
                quantity={Number(formData.quantity || 0)}
                sampleQuantity={Number(formData.sampleQuantity || 0)}
                taxRate={Number(formData.taxRate || 10)}
                onPreview={(p) => {
                  if (!p) return;
                  // Preview 結果をフォームの「合計」系フィールドに同期。
                  // 確定保存前にユーザーが目視する数字がサーバと一致するように。
                  // 注: setFormData は functional updater 非対応のため
                  // closure の formData を読む。fetch 中に別フィールドが
                  // 編集された場合は最新の合計値が上書きされるが、ユーザーは
                  // 入力継続で再計算が走るので実害は小さい。
                  setFormData({
                    ...formData,
                    billableQuantity: String(p.billable_quantity),
                    grossRoyaltyStr: new Intl.NumberFormat('ja-JP').format(
                      p.gross_royalty_ex_tax
                    ),
                    mgAmount: String(p.mg_amount),
                    mgRemaining: String(p.mg_remaining),
                    actualRoyalty: p.actual_royalty_ex_tax,
                    actualRoyaltyStr: new Intl.NumberFormat('ja-JP').format(
                      p.actual_royalty_ex_tax
                    ),
                    taxAmount: new Intl.NumberFormat('ja-JP').format(
                      p.tax_amount
                    ),
                    totalPaymentStr: new Intl.NumberFormat('ja-JP').format(
                      p.total_payment_inc_tax
                    ),
                  });
                }}
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="VI. 金銭・支払" variant="cyan">
          {renderGroup('VI. 金銭・支払')}
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VII. 備考 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('VII. 備考 (任意)')}</div>
        </details>
       </div>
     );
  }

  // Specialized NDA Form (秘密保持契約書, Phase 3b-7)
  //
  // 11 variables, all required. Both 甲 (PARTY_A_*) and 乙 (PARTY_B_*)
  // are form-editable so the swap pattern applies — either side can
  // be Arclight depending on who initiated the NDA.
  if (templateId === 'nda') {
    const fillPartyAFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_A_NAME: companyProfile?.name || '',
        PARTY_A_ADDRESS: companyProfile?.address || '',
        PARTY_A_REP: companyProfile?.representative || '',
      });

    const fillPartyAFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_A_NAME: activeVendor.vendor_name || '',
        PARTY_A_ADDRESS: activeVendor.address || '',
        PARTY_A_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const fillPartyBFromSelf = () =>
      setFormData({
        ...formData,
        PARTY_B_NAME: companyProfile?.name || '',
        PARTY_B_ADDRESS: companyProfile?.address || '',
        PARTY_B_REP: companyProfile?.representative || '',
      });

    const fillPartyBFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_B_NAME: activeVendor.vendor_name || '',
        PARTY_B_ADDRESS: activeVendor.address || '',
        PARTY_B_REP: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で対象を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <FormSection
          title="I. ヘッダ"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
        >
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <FormSection
            title="II. 甲"
            variant="blue"
            icon={<Building2 className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillPartyAFromSelf, !companyProfile)}
                {sideButton('取引先', fillPartyAFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('II. 甲')}
          </FormSection>

          <FormSection
            title="III. 乙"
            variant="amber"
            icon={<User className="w-4 h-4" />}
            headerActions={
              <>
                {sideButton('自社', fillPartyBFromSelf, !companyProfile)}
                {sideButton('取引先', fillPartyBFromPartner, !activeVendor)}
              </>
            }
          >
            {renderGroup('III. 乙')}
          </FormSection>
        </div>

        <FormSection
          title="IV. 契約内容"
          variant="emerald"
          icon={<Scale className="w-4 h-4" />}
        >
          {renderGroup('IV. 契約内容')}
        </FormSection>

        <FormSection title="V. 一般条項" variant="indigo">
          {renderGroup('V. 一般条項')}
        </FormSection>
      </div>
    );
  }

  // Specialized Sales Master Form (売買基本契約書, Phase 3b-6)
  //
  // All three variants share the same shape: 甲 (アークライト) is
  // hard-coded inside the HTML, only PARTY_B (乙=取引先) has form
  // variables. Variant-specific terms live in their own group (III.):
  //   - sales_master_buyer:    III. 取引条件        (買手側条件)
  //   - sales_master_standard: III. 支払・納品条件   (売手側・前払/代引)
  //   - sales_master_credit:   III. 保証金・掛け売り条件
  //
  // The form dispatches by matching the templateId prefix and lets the
  // metadata's group ordering drive the layout.
  if (templateId.startsWith('sales_master_')) {
    const fillPartyBFromPartner = () => {
      if (!activeVendor) return;
      setFormData({
        ...formData,
        PARTY_B_NAME: activeVendor.vendor_name || '',
        PARTY_B_ADDRESS: activeVendor.address || '',
        PARTY_B_REPRESENTATIVE: activeVendor.vendor_rep || activeVendor.contact_name || '',
      });
    };

    const sideButton = (label: string, onClick: () => void, disabled: boolean) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors',
          disabled
            ? 'border-input text-muted-foreground/40 cursor-not-allowed'
            : 'border-foreground/30 text-foreground hover:bg-muted'
        )}
        title={disabled ? '上部で取引先を選択してください' : undefined}
      >
        {label}
      </button>
    );

    const requiredIds = Object.entries(metadata.vars || {})
      .filter(([, m]: [string, any]) => m?.required === true)
      .map(([id]) => id);
    const missingRequired = requiredIds.filter((id) => {
      const v = formData[id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    // Variant-specific section III. label/icon resolution.
    const variantSection = templateId === 'sales_master_buyer'
      ? { title: 'III. 取引条件', variant: 'indigo' as const }
      : templateId === 'sales_master_standard'
        ? { title: 'III. 支払・納品条件', variant: 'indigo' as const }
        : { title: 'III. 保証金・掛け売り条件', variant: 'indigo' as const };

    // Sub-role label inside the partner section depends on the variant.
    const partnerRoleLabel = templateId === 'sales_master_buyer'
      ? '乙 (売主・取引先)'
      : '乙 (買主・取引先)';

    return (
      <div className="space-y-10">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2 rounded-sm border',
            missingRequired.length === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}
        >
          <div className="text-[11px] font-mono">
            {missingRequired.length === 0 ? (
              <>✓ 必須項目はすべて入力済み ({requiredIds.length} 項目)</>
            ) : (
              <>
                必須項目 {requiredIds.length - missingRequired.length} / {requiredIds.length} 入力済み
                <span className="ml-2 text-[10px] opacity-75">
                  未入力: {missingRequired.slice(0, 5).map((id) => metadata.vars?.[id]?.label || id).join(', ')}
                  {missingRequired.length > 5 && ` 他 ${missingRequired.length - 5} 件`}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="px-4 py-2 rounded-sm bg-muted/50 text-[10px] font-mono text-muted-foreground">
          甲 は「株式会社アークライト」がテンプレート内に固定されています。
          以下は 乙 ({partnerRoleLabel.replace('乙 (', '').replace(')', '')}) の情報のみ入力してください。
        </div>

        <FormSection
          title="I. ヘッダ"
          variant="default"
          icon={<Briefcase className="w-4 h-4" />}
        >
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <FormSection
          title={`II. ${partnerRoleLabel}`}
          variant="amber"
          icon={<Building2 className="w-4 h-4" />}
          headerActions={sideButton('取引先', fillPartyBFromPartner, !activeVendor)}
        >
          {renderGroup(`II. ${partnerRoleLabel}`)}
        </FormSection>

        <FormSection
          title={variantSection.title}
          variant={variantSection.variant}
          icon={<Scale className="w-4 h-4" />}
        >
          {renderGroup(variantSection.title)}
        </FormSection>

        <FormSection title="IV. 一般条項" variant="blue">
          {renderGroup('IV. 一般条項')}
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ V. 特約 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input">{renderGroup('V. 特約 (任意)')}</div>
        </details>
      </div>
    );
  }

  // Phase 22.21.55: Specialized Maintenance Spec Form (システム保守仕様書・別紙)
  //
  // 動的配列 (scopeItems / handoverItems / milestones / responsibilityRows /
  // scopeOutItems) は専用テーブルエディタ (MaintenanceSpecParts) で編集。
  // それ以外のスカラ値 (ヘッダ・SLA・連絡先・時間外単価 等) は
  // templates_config.json から自動生成された renderGroup で扱う。
  // _DYNAMIC group は dropdown 表示せず、専用エディタが代わりにレンダリングする。
  if (templateId === 'maintenance_spec') {
    const renderGroup = (groupName: string) =>
      (groupedVars[groupName] || []).map((fid) => renderField(fid));

    const scopeItems = Array.isArray(formData.scopeItems) ? formData.scopeItems : []
    const handoverItems = Array.isArray(formData.handoverItems) ? formData.handoverItems : []
    const milestones = Array.isArray(formData.milestones) ? formData.milestones : []
    const responsibilityRows = Array.isArray(formData.responsibilityRows)
      ? formData.responsibilityRows
      : []
    const scopeOutItems = Array.isArray(formData.scopeOutItems)
      ? formData.scopeOutItems
      : []

    return (
      <div className="space-y-10">
        <FormSection title="I. ヘッダ" variant="default" icon={<FileText className="w-4 h-4" />}>
          {renderGroup('I. ヘッダ')}
        </FormSection>

        <FormSection
          title="II. 月額稼働の構成"
          variant="blue"
          icon={<Briefcase className="w-4 h-4" />}
        >
          {renderGroup('II. 月額稼働の構成')}
        </FormSection>

        <FormSection
          title="III. 通常保守"
          variant="emerald"
          icon={<User className="w-4 h-4" />}
        >
          {renderGroup('III. 通常保守')}
        </FormSection>

        <FormSection
          title="IV. 障害対応"
          variant="amber"
          icon={<AlertCircle className="w-4 h-4" />}
        >
          {renderGroup('IV. 障害対応')}
        </FormSection>

        <FormSection title="IV-2. SLA 重大度" variant="amber">
          {renderGroup('IV-2. SLA 重大度')}
        </FormSection>

        <FormSection title="V. 時間外費用" variant="default">
          {renderGroup('V. 時間外費用')}
        </FormSection>

        {/* ──── 動的配列セクション ──── */}
        <FormSection
          title="第2条 保守スコープ (動的)"
          variant="default"
          icon={<Settings className="w-4 h-4" />}
        >
          <div className="col-span-full">
            <MaintenanceSpecParts.ScopeItemsTable
              items={scopeItems}
              onChange={(next) => setFormData({ ...formData, scopeItems: next })}
            />
          </div>
        </FormSection>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VI. 初月対応 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input space-y-6">
            {renderGroup('VI. 初月対応 (任意)')}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                引継ぎ残課題
              </div>
              <MaintenanceSpecParts.HandoverItemsTable
                items={handoverItems}
                onChange={(next) => setFormData({ ...formData, handoverItems: next })}
              />
            </div>
          </div>
        </details>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VII. マイルストーン (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input space-y-6">
            {renderGroup('VII. マイルストーン (任意)')}
            <MaintenanceSpecParts.MilestonesTable
              items={milestones}
              onChange={(next) => setFormData({ ...formData, milestones: next })}
            />
          </div>
        </details>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ VIII. 責任分担 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input space-y-6">
            {renderGroup('VIII. 責任分担 (任意)')}
            <MaintenanceSpecParts.ResponsibilityTable
              items={responsibilityRows}
              onChange={(next) => setFormData({ ...formData, responsibilityRows: next })}
            />
          </div>
        </details>

        <details className="group rounded-sm border border-input">
          <summary className="cursor-pointer px-4 py-2 text-[11px] font-mono uppercase tracking-wider hover:bg-muted/50 select-none">
            ▶ IX. スコープ外 (任意) — クリックして展開
          </summary>
          <div className="p-4 border-t border-input space-y-6">
            {renderGroup('IX. スコープ外 (任意)')}
            <MaintenanceSpecParts.ScopeOutList
              items={scopeOutItems}
              onChange={(next) => setFormData({ ...formData, scopeOutItems: next })}
            />
          </div>
        </details>
      </div>
    );
  }

  // Default Meta-driven dynamic form
  return (
    <div className="space-y-10">
      {(Object.entries(groupedVars) as [string, string[]][]).map(([groupName, varIds]) => (
        <FormSection key={groupName} title={groupName} variant="default" headerActions={<button onClick={onSync} className="text-[8px] font-mono bg-blue-600 text-white px-2 py-0.5 uppercase flex items-center gap-1"><Database className="w-2 h-2" /> Sync</button>}>
          {varIds.map(fid => renderField(fid))}
        </FormSection>
      ))}
    </div>
  );
};
