
import React, { useMemo, useEffect, useState } from 'react';
import { useAppData } from '@/src/context/AppDataContext';
// [移行済] LineItemTable / ExpenseTable / OtherFeesTable は schemas/purchaseOrder.tsx へ移設。
// [移行済] 検収書(inspection_certificate)関連の入力部品
//   (InspectionExpenseSelector / InspectionOtherFeesSelector / DeliveryLineItemTable)は
//   schemas/inspectionCertificate.tsx へ移設したためここでの import は不要。
import {
  FinancialConditionTable,
  calcMethodFromType,
  type FinancialCondition,
} from './FinancialConditionTable';
// v3 マトリクス/エディタ本体は schemas/individualLicenseTerms.tsx へ移設。
//   V3_FIXED_DEALS のみ v3_conds 初期化 effect で使用するため残す。
import { V3_FIXED_DEALS } from './V3LicenseMatrix';
// [移行済] LcImportPanel / ConditionCopyPanel / MaterialSearchSelect / LicenseWizardRail は
//   schemas/individualLicenseTerms.tsx へ、RoyaltyPreviewPanel / FinancialConditionPicker は
//   schemas/royaltyStatement.tsx へ移設。
// Phase 23: ParentPoPicker は UnifiedContractPicker に統合済み。
import { UnifiedContractPicker } from './UnifiedContractPicker';
import { SchemaDocumentForm, autoSectionsFromMetadata } from './SchemaDocumentForm';
import { buildDocFormSchema } from './documentFormSchemas';
import { TemplateMetadata } from './types';

import { useToast } from '@/components/ui/toast';

// インボイス登録番号は発注書テンプレ等が先頭に "T" を付与するため、取引先DB値に
//   既に T が付いていると "TT…" になる。引用時に先頭の T(半角/全角) を1つ除去する。
// [移行済] stripLeadingT / individualVendorName は schemas/purchaseOrder.tsx へ移設。

interface DocumentFormProps {
  templateId: string;
  metadata: TemplateMetadata;
  formData: any;
  setFormData: (data: any) => void;
  // LB-F08 (§5.5.6): Backlog Sync の入力点はエディタヘッダーの「依頼原票から再取得」
  //   1箇所に統一したため、フォーム内の重複ボタンは撤去済み。後方互換のため optional。
  onSync?: () => void;
  onLinkAsset?: (callback: (asset: any) => void) => void;
  // Phase 22.21.122: callback なしで Legal Asset Search Sheet を開く。
  //   inspection_certificate / royalty_statement の master+archive 横断検索を
  //   フォーム内インラインボタンから起動するため (右サイドバーの "Search Legal
  //   Assets" ボタンと同じ動作)。
  onOpenLegalAssetSearch?: () => void;
  companyProfile?: any;
  activeVendor?: any;
  selectedStaff?: any;
  // 個人取引先の宛名に「ペンネーム/屋号 こと 正式名称」を併記するか (文書ごと)。
  combineVendorAlias?: boolean;
}

// Stage 1(文書ファースト紐付けプラン): 作品連動しうるテンプレート。対象作品(own)一覧の取得対象。
const WORK_LINKED_TEMPLATES = [
  'individual_license_terms',
  'lic_individual',
  'pub_license_terms',
  'purchase_order',
  'intl_purchase_order',
];

export const DocumentForm: React.FC<DocumentFormProps> = ({
  templateId,
  metadata,
  formData,
  setFormData,
  onSync,
  onLinkAsset,
  onOpenLegalAssetSearch,
  companyProfile,
  activeVendor,
  selectedStaff,
  combineVendorAlias = false
}) => {
  const { push } = useToast();
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

  // [移行済] royalty_statement 用の state/helper/effects は schemas/royaltyStatement.tsx へ移設。
  // [移行済] 発注書の po* state は schemas/purchaseOrder.tsx へ移設。
  // [移行済] 個別利用許諾の newWorkTitle/creatingWork/iltNewSourceTitle/iltCreatingSource は
  //   schemas/individualLicenseTerms.tsx へ移設。
  // 出版等利用許諾条件書(セクション1): 「＋原作を新規作成」用のタイトル入力と進行中フラグ。
  const [pubNewSourceTitle, setPubNewSourceTitle] = useState('');
  const [pubCreatingSource, setPubCreatingSource] = useState(false);
  // 出版等利用許諾条件書(セクション1): 対象作品(own)をその場で作成する入力と進行中フラグ。
  const [pubNewWorkTitle, setPubNewWorkTitle] = useState('');
  const [pubCreatingWork, setPubCreatingWork] = useState(false);

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


  // 個別利用許諾条件書: 取引形態は固定3種(自社製造自社販売/権利許諾/自社製造他社販売)。
  //   共通の固定軸にすることで構成要素の料率合算(加算)が成立する。v3_conds 未設定なら
  //   既定プリセットで初期化する(既存文書は保存済みの v3_conds を尊重)。
  useEffect(() => {
    if (templateId !== 'individual_license_terms') return;
    const cur = Array.isArray(formData.v3_conds) ? formData.v3_conds : [];
    if (cur.length > 0) return;
    setFormData({ ...formData, v3_conds: V3_FIXED_DEALS.map((c) => ({ ...c })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // 通知先: 業務委託 / ライセンス / 出版(個人・法人)基本契約で、当社側
  //   (委託者 / ライセンシー / 被許諾者) の通知先担当者を、選択中の担当者
  //   (selectedStaff) から STAFF_NAME / STAFF_PHONE / STAFF_EMAIL に引用する。
  //   テンプレ頭書きの「通知先」欄および通知条項に反映される。
  useEffect(() => {
    const noticeTemplates = [
      'service_master',
      'license_master',
      'pub_master_individual',
      'pub_master_corporate',
      'individual_license_terms',
      'pub_license_terms',
      'pub_additional_terms',
    ];
    if (!noticeTemplates.includes(templateId) || !selectedStaff) return;
    const name = selectedStaff.staff_name || '';
    const phone = selectedStaff.phone || '';
    const email = selectedStaff.email || '';
    if (
      formData.STAFF_NAME === name &&
      formData.STAFF_PHONE === phone &&
      formData.STAFF_EMAIL === email
    )
      return;
    setFormData({
      ...formData,
      STAFF_NAME: name,
      STAFF_PHONE: phone,
      STAFF_EMAIL: email,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, selectedStaff?.staff_name, selectedStaff?.phone, selectedStaff?.email]);

  // Phase 22.9: 取引先 (activeVendor) が選ばれたら、その vendor に紐づく
  //             基本契約 (contract_capabilities) を自動補完。
  //   - 発注書 (purchase_order)               → category="service" の有効な基本契約
  //   - 個別利用許諾条件書 (individual_license_terms) → category="license" の有効な基本契約
  //   - 個別出版条件書 (publication_terms, 将来) → category="publication"
  // 既に該当フィールドに値が入っているときは尊重して上書きしない。
  // 同じ vendor で再評価が走り続けないよう ref で last 状態を持つ。
  //
  // ★ 注意: この useEffect はコンポーネント最上部に置く (Rules of Hooks)。
  const { contracts: allContracts, ledgers: allLedgers, refreshLedgers } = useAppData();
  const lastAutoFilledRef = React.useRef<string>('');

  // 対象作品(own)の一覧。Stage 1(文書ファースト紐付け)で「対象作品」セレクタにも使うため、
  //   作品連動しうるテンプレート(利用許諾・出版・発注書)で /api/v3/works を取得する。
  const [worksList, setWorksList] = React.useState<any[]>([]);
  // 明細/条件ごとの作品割当(作品1:文書N:明細N)用の作品候補。worksList(GET /api/v3/works)
  //   を {id, work_code, title} に整形。WORK_LINKED_TEMPLATES 以外は空 → セレクタ非表示。
  const workOptions = useMemo(
    () =>
      (Array.isArray(worksList) ? worksList : []).map((w: any) => ({
        id: Number(w.id),
        work_code: w.work_code || undefined,
        title: w.title || undefined,
      })),
    [worksList]
  );
  useEffect(() => {
    if (!WORK_LINKED_TEMPLATES.includes(templateId)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v3/works');
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.rows)
            ? data.rows
            : Array.isArray(data?.items)
              ? data.items
              : [];
        if (!cancelled) setWorksList(list);
      } catch {
        /* 取得失敗時は手入力にフォールバック */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

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

  // Part1(共通化): 出版等利用許諾の「対価・支払条件」を共通 FinancialConditionTable に統一。
  //   個別利用許諾と同じ条件表 UI を使い、紙書籍/電子書籍 を表現(翻訳・海外版は二次的著作物として対象外)。
  //   既存doc(旧フラットfield)/新規いずれも、フラットfieldから条件表を一度だけ初期化する。
  //   ※ financial_conditions が既にあれば尊重 (再編集での二重初期化を防止)。
  //   生成時に worker が条件表→flat field {{紙書籍印税率}} 等へ逆展開し PDF テンプレは不変。
  const pubCondSeededRef = React.useRef(false);
  useEffect(() => {
    if (templateId !== 'pub_license_terms') return;
    if (pubCondSeededRef.current) return;
    if (
      Array.isArray(formData.financial_conditions) &&
      formData.financial_conditions.length > 0
    ) {
      pubCondSeededRef.current = true;
      return;
    }
    const toNum = (v: any) => {
      const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const seed: FinancialCondition[] = [
      {
        condition_no: 1,
        region_language_label: '紙書籍出版',
        calc_method: 'ROYALTY',
        calc_type: 'BASE_QTY_RATE',
        guarantee_type: 'NONE',
        rate_pct: toNum(formData['紙書籍印税率']),
        base_price_label: '税抜定価',
        formula_text: formData['紙媒体計算式'] || '',
        currency: 'JPY',
      },
      {
        condition_no: 2,
        region_language_label: '電子書籍配信',
        calc_method: 'ROYALTY',
        calc_type: 'BASE_QTY_RATE',
        guarantee_type: 'NONE',
        rate_pct: toNum(formData['電子書籍印税率']),
        base_price_label: '被許諾者受領額',
        formula_text: formData['電子書籍計算式'] || '',
        currency: 'JPY',
      },
    ];
    pubCondSeededRef.current = true;
    setFormData({ ...formData, financial_conditions: seed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, formData.financial_conditions]);

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
    if (templateId !== 'purchase_order' && templateId !== 'intl_purchase_order') return;
    const items: any[] = Array.isArray(formData.items) ? formData.items : [];

    // FIXED/ROYALTY 明細から日付列を集約
    // SUBSCRIPTION 明細は別建て (期間 + 周期サマリ) で集約
    const fixedItems = items.filter((it) => it?.calc_method !== 'SUBSCRIPTION');
    const subItems = items.filter((it) => it?.calc_method === 'SUBSCRIPTION');
    // 海外発注書(intl_purchase_order)はサマリーも英語で組み立てる。
    const isIntl = templateId === 'intl_purchase_order';

    const aggregateDates = (field: 'delivery_date' | 'payment_date'): string => {
      const dates = fixedItems
        .map((it) => (typeof it?.[field] === 'string' ? it[field] : ''))
        .filter((d: string) => d && d.trim() !== '');
      if (dates.length === 0) return '';
      const unique = Array.from(new Set(dates)).sort();
      if (unique.length === 1) return unique[0];
      return isIntl
        ? `${unique[0]} – ${unique[unique.length - 1]} (see details)`
        : `${unique[0]} 〜 ${unique[unique.length - 1]} (明細参照)`;
    };

    // SUBSCRIPTION 明細を 1 行 "毎月25日 (2026/01/01〜2026/12/31)" 形式で並べる
    const cycleShort = (c?: string) =>
      isIntl
        ? c === 'QUARTERLY'
          ? 'Quarterly'
          : c === 'SEMIANNUAL'
            ? 'Semi-annual'
            : c === 'ANNUAL'
              ? 'Annual'
              : c === 'CUSTOM'
                ? 'Custom'
                : 'Monthly'
        : c === 'QUARTERLY'
          ? '四半期'
          : c === 'SEMIANNUAL'
            ? '半年'
            : c === 'ANNUAL'
              ? '年次'
              : c === 'CUSTOM'
                ? 'カスタム'
                : '月次';
    // timing = billing_timing (SAME_MONTH/NEXT_MONTH/MONTH_AFTER_NEXT)。
    //   締めた期の分をどの月に支払うかを明示し「月末払い」の当月/翌月あいまいさを解消。
    //   未設定は従来表示にフォールバック (LineItemTable.formatBillingDay と同一仕様)。
    const billingDayDisplay = (day?: number, cycle?: string, timing?: string) => {
      if (day === undefined || day === null || Number.isNaN(Number(day))) return '';
      const n = Number(day);
      const t = String(timing || '').toUpperCase();
      if (isIntl) {
        const pw =
          cycle === 'QUARTERLY'
            ? 'quarter'
            : cycle === 'SEMIANNUAL'
              ? 'half-year'
              : cycle === 'ANNUAL'
                ? 'year'
                : cycle === 'CUSTOM'
                  ? 'period'
                  : 'month';
        const dayPhrase = n === 0 || n > 30 ? 'end' : `day ${n}`;
        if (t === 'NEXT_MONTH')
          return pw === 'month'
            ? `${dayPhrase} of the following month`
            : `${dayPhrase} of the month following each ${pw}`;
        if (t === 'MONTH_AFTER_NEXT')
          return pw === 'month'
            ? `${dayPhrase} of the second following month`
            : `${dayPhrase} of the second month following each ${pw}`;
        return n === 0 || n > 30 ? `end of each ${pw}` : `day ${n} of each ${pw}`;
      }
      const prefix =
        cycle === 'QUARTERLY'
          ? '毎四半期'
          : cycle === 'SEMIANNUAL'
            ? '毎半期'
            : cycle === 'ANNUAL'
              ? '毎年'
              : '毎月';
      const dayLabel = n === 0 || n > 30 ? '末日' : `${n}日`;
      const tw =
        t === 'SAME_MONTH' ? '当月' : t === 'NEXT_MONTH' ? '翌月' : t === 'MONTH_AFTER_NEXT' ? '翌々月' : '';
      if (tw) {
        const cyclePrefix = !cycle || cycle === 'MONTHLY' ? '' : `${prefix}・`;
        return `${cyclePrefix}${tw}${dayLabel}払い`;
      }
      return `${prefix}${dayLabel}`;
    };
    const dot = isIntl ? ' · ' : '・';
    const sep = isIntl ? ' – ' : ' 〜 ';
    const ongoing = isIntl ? 'ongoing' : '継続中';
    const noBilling = isIntl ? '(payment day TBD)' : '(支払日未設定)';
    const subSummaryLines = subItems
      .map((it) => {
        const billing = billingDayDisplay(it.billing_day, it.cycle, it.billing_timing);
        const range =
          (it.term_start ? it.term_start : '—') + sep + (it.term_end ? it.term_end : ongoing);
        // 海外発注書のカスタム周期は間隔値から "Every 2 months" 等を組む
        // (テンプレ側 cycleLabelEn と同じ表記)。
        const customN = Number(it.interval_count);
        const cyc =
          isIntl && it.cycle === 'CUSTOM' && Number.isFinite(customN) && customN > 0
            ? `Every ${customN} ${it.interval_unit === 'DAY' ? 'day' : 'month'}${customN > 1 ? 's' : ''}`
            : cycleShort(it.cycle);
        return `${cyc}${dot}${billing || noBilling} (${range})`;
      })
      .filter((s) => s && s.trim() !== '');

    const nextDelivery = (() => {
      const fixed = aggregateDates('delivery_date');
      if (subSummaryLines.length === 0) return fixed;
      // SUBSCRIPTION 行は「期間で常時納品/役務提供」扱い → 期間サマリを返す
      const subLabel = subSummaryLines
        .map((line, i) => `${subItems.length > 1 ? `[#${i + 1}] ` : ''}${line.split(' (')[1]?.replace(/\)$/, '') || ''}`)
        .filter(Boolean)
        .join(' / ');
      if (isIntl) {
        if (fixed && subLabel) return `${fixed} (fixed items) + Service period: ${subLabel}`;
        if (subLabel) return `Service period: ${subLabel}`;
        return fixed;
      }
      if (fixed && subLabel) return `${fixed} (固定明細) + 役務提供期間: ${subLabel}`;
      if (subLabel) return `役務提供期間: ${subLabel}`;
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
      if (isIntl) {
        if (fixed && subLabel) return `${fixed} (fixed items) + ${subLabel}`;
        if (subLabel) return subLabel;
        return fixed;
      }
      if (fixed && subLabel) return `${fixed} (固定明細) + ${subLabel}`;
      if (subLabel) return subLabel;
      return fixed;
    })();

    // 海外発注書は納期キーに summaryCompletionDate を使う(国内は summaryDeliveryDate)。
    const curDelivery = isIntl
      ? formData.summaryCompletionDate
      : formData.summaryDeliveryDate;
    if (curDelivery === nextDelivery && formData.summaryPaymentDate === nextPayment) {
      return;
    }
    setFormData({
      ...formData,
      ...(isIntl
        ? { summaryCompletionDate: nextDelivery, summaryDeliveryDate: nextDelivery }
        : { summaryDeliveryDate: nextDelivery }),
      summaryPaymentDate: nextPayment,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, formData.items]);

  // 発注書: 利用許諾料(ROYALTY)明細を「共通の利用許諾条件」(formData.financial_conditions)
  //   に紐づける。条件が無ければ1本シードし、適用範囲(applies_scope)をROYALTY
  //   明細名から自動補完する。旧 per-line 条件を持つ既存発注書は、最初のROYALTY明細の
  //   条件フィールドから移行する(後方互換)。
  //   3b: 帰属ではなく支払方法(ROYALTY)で駆動。②発注者×ROYALTYも対象。
  useEffect(() => {
    if (templateId !== 'purchase_order' && templateId !== 'intl_purchase_order')
      return;
    const items: any[] = Array.isArray(formData.items) ? formData.items : [];
    const ownerItems = items.filter(
      (it) => it?.calc_method === 'ROYALTY'
    );
    if (ownerItems.length === 0) return; // ROYALTY明細が無ければ何もしない
    const scopeNames = ownerItems
      .map((it) => it.condition_name || it.item_name)
      .filter(Boolean)
      .join('、');
    const defaultScope = scopeNames
      ? `本発注の利用許諾料（ROYALTY）成果物（${scopeNames}）`
      : '本発注の利用許諾料（ROYALTY）成果物';
    const conds: any[] = Array.isArray(formData.financial_conditions)
      ? formData.financial_conditions
      : [];
    if (conds.length === 0) {
      // 旧 per-line 条件を持つ明細があれば、そこから共通条件を1本移行。
      const src: any = ownerItems.find((it) => it.calc_type) || ownerItems[0] || {};
      // 条件名称は業務内容・成果物の名称に合わせる(ROYALTY明細名 → 共通条件名)。
      // 単一明細なら品目名そのもの、複数なら連結名。明示の condition_name があれば尊重。
      const seeded: FinancialCondition & { applies_scope?: string } = {
        condition_no: 1,
        condition_name:
          src.condition_name || scopeNames || src.item_name || '利用許諾条件',
        region_territory: src.region_territory || '',
        region_language: src.region_language || '',
        region_language_label: src.region_language_label || '',
        calc_type: src.calc_type || 'BASE_QTY_RATE',
        calc_method: calcMethodFromType(src.calc_type) || 'ROYALTY',
        rate_pct: src.rate_pct ?? 0,
        base_price_label: src.base_price_label || '',
        guarantee_type: src.guarantee_type || 'NONE',
        mg_amount: src.mg_amount ?? 0,
        ag_amount: src.ag_amount ?? 0,
        payment_terms: src.payment_terms || '',
        formula_text: src.formula_text || '',
        applies_scope: defaultScope,
        currency: 'JPY',
      };
      setFormData({ ...formData, financial_conditions: [seeded] });
      return;
    }
    // 既存条件の補完(上書きはしない):
    //  - applies_scope が空 → 既定値(ROYALTY明細名)を補完。
    //  - condition_name が空 or 旧 generic 既定「利用許諾条件」→ 業務委託明細名(scopeNames)に
    //    リンク。ユーザーが明示的に付けた名称は generic 判定に該当しないため保持される。
    let changed = false;
    const next = conds.map((c) => {
      const patch: any = {};
      if (((c.applies_scope || '') as string).trim() === '') {
        patch.applies_scope = defaultScope;
      }
      const cname = ((c.condition_name || '') as string).trim();
      if ((cname === '' || cname === '利用許諾条件') && scopeNames) {
        patch.condition_name = scopeNames;
      }
      if (Object.keys(patch).length > 0) {
        changed = true;
        return { ...c, ...patch };
      }
      return c;
    });
    if (changed) setFormData({ ...formData, financial_conditions: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, formData.items, formData.financial_conditions]);

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

  // 検収書: 受注者帰属で業務報酬0(=利用許諾料に含む)の成果物を検収対象に自動取り込み。
  //   Backlog 親PO自動検出(form-context)経路でも自動で載るようにする。
  //   delivery_line_items が空のとき(初期)だけ取り込み、ユーザーの手動削除とは競合しない
  //   (依存は order_lines_for_inspection のみなので、削除後に再追加されない)。
  useEffect(() => {
    if (!templateId.startsWith('inspection_certificate')) return;
    const orderLines = Array.isArray(formData.order_lines_for_inspection)
      ? (formData.order_lines_for_inspection as any[])
      : [];
    if (orderLines.length === 0) return;
    const existing = Array.isArray(formData.delivery_line_items)
      ? (formData.delivery_line_items as any[])
      : [];
    if (existing.length > 0) return; // 既に検収入力があれば自動取込しない
    const licenseZero = orderLines.filter(
      (l: any) =>
        l?.deliverable_ownership === '受注者' &&
        (Number(l?.amount_ex_tax) || 0) === 0
    );
    if (licenseZero.length === 0) return;
    setFormData({
      ...formData,
      delivery_line_items: licenseZero.map((l: any) => ({
        order_line_item_id: Number(l.id),
        item_name: l.item_name || '',
        spec: l.spec || '',
        inspected_quantity: Number(l.quantity) || 1,
        acceptance_ratio: 1.0,
        inspected_amount_ex_tax: 0,
        delivery_date: l.delivery_date || undefined,
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, formData.order_lines_for_inspection]);

  // FRM-04 / FRM-14: 全 19 テンプレは SchemaDocumentForm へ委譲済み。
  //   旧 per-template 分岐(フォールバック render)と renderField ヘルパは、全テンプレの
  //   Schema 移行完了により到達不能(dead code)になったため物理削除した。
  //   このコンポーネントは以後「ctx を組み立て、移行済みの各 hook/effect を回し、
  //   SchemaDocumentForm へ委譲する器」に徹する。未登録テンプレが将来現れても
  //   autoSectionsFromMetadata で汎用描画する安全弁だけ残す(白画面を出さない)。
  //   PDF テンプレは不変(フィールドのキー名は据え置き)。
  const fkCtx = {
    templateId,
    metadata,
    formData,
    setFormData,
    activeVendor,
    companyProfile,
    selectedStaff,
    onSync,
    onLinkAsset,
    combineVendorAlias,
    workOptions,
    worksList,
    setWorksList,
  };
  const schema =
    buildDocFormSchema(templateId, metadata, fkCtx) ?? {
      sections: autoSectionsFromMetadata(metadata),
    };
  return <SchemaDocumentForm {...fkCtx} schema={schema} />;
};
