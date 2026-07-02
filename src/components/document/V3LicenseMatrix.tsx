/**
 * V3LicenseMatrix — 個別利用許諾条件 v3 のマトリクス入力。
 *
 * 設計: docs/design/individual-license-terms-v3-migration-plan.md
 * 取引形態(列) × 構成要素LC(=原作マテリアル, 行) の料率マトリクスを入力し、
 *   formData.v3_conds / formData.v3_lcs を produce する（worker の context builder
 *   individualLicenseV3Context.ts の入力契約と一致）。
 *
 * - 加算型(addon): 適用料率 = 各LCの当該取引形態料率の合算(Σ)。1-3(B)に各LC料率を入力。
 * - 非加算型: 実効料率(fixedRate)を直接入力。1-3(B)該当列は入力なし。
 * - LC は原作(selectedLedger)の素材から選択(material_code/name/権利者を補完) or 手入力。
 */
import * as React from 'react';

export interface V3Cond {
  id: number;
  name?: string;
  manufacturer?: string;
  seller?: string;
  maxReg?: string;
  maxLang?: string;
  basePrice?: string;
  addon?: boolean;
  fixedRate?: string;
  reg?: string;
  lang?: string;
  qty?: string;
  ag?: string;
  mg?: string;
  cur?: string;
}
export interface V3Lc {
  material_code?: string;
  name?: string;
  holder?: string;
  rates?: Record<string, string>;
}
/** 2-3(A) 計算基準日の1行。formData.v3_calc_base_rows（context builder の入力契約）。 */
export interface V3CalcBaseRow {
  edition?: string;
  trigger?: string;
  note?: string;
}

/** 2-3(A) の既定行。未編集のフォーム・既存文書はこの標準2行で描画される。 */
export const DEFAULT_CALC_BASE_ROWS: V3CalcBaseRow[] = [
  { edition: '初版', trigger: '発売日', note: '' },
  { edition: '2版以降', trigger: '製造日', note: '' },
];

const CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'CNY', 'その他'];

const num = (v: any): number | null => {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const fmtPct = (n: number | null) => (n == null ? '—' : `${+n.toFixed(2)}%`);

/** 適用料率: 加算型=各LCの当該料率合算 / 非加算型=実効料率。 */
function appliedRate(c: V3Cond, lcs: V3Lc[]): string {
  if (!c.addon) return fmtPct(num(c.fixedRate));
  const key = String(c.id);
  let sum = 0;
  let any = false;
  for (const l of lcs) {
    const r = num(l.rates?.[key]);
    if (r != null) {
      sum += r;
      any = true;
    }
  }
  return any ? fmtPct(sum) : '—';
}

const inputCls =
  'w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground';

export function V3LicenseMatrix({
  conds,
  lcs,
  onChangeConds,
  onChangeLcs,
}: {
  conds: V3Cond[];
  lcs: V3Lc[];
  onChangeConds: (next: V3Cond[]) => void;
  onChangeLcs: (next: V3Lc[]) => void;
}) {
  const nextCondId = React.useMemo(
    () => (conds.length ? Math.max(...conds.map((c) => c.id)) + 1 : 1),
    [conds]
  );

  const addCond = () =>
    onChangeConds([
      ...conds,
      { id: nextCondId, name: '', addon: true, qty: '数量', ag: '0', mg: '0', cur: 'JPY' },
    ]);
  const updCond = (id: number, k: keyof V3Cond, v: any) =>
    onChangeConds(conds.map((c) => (c.id === id ? { ...c, [k]: v } : c)));
  // 取引形態の削除は親(DocumentForm)側で v3_lcs を再同期する。
  const delCond = (id: number) => onChangeConds(conds.filter((c) => c.id !== id));

  // 構成要素LC(=原作マテリアル)は「3. マスター条件」で選択する。ここでは
  //   その LC 行に対し加算型取引形態ごとの料率のみインライン編集する。
  const updRate = (i: number, condId: number, v: string) =>
    onChangeLcs(
      lcs.map((l, idx) =>
        idx === i ? { ...l, rates: { ...(l.rates || {}), [String(condId)]: v } } : l
      )
    );

  const addonConds = conds.filter((c) => c.addon);

  return (
    <div className="col-span-full space-y-3">
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-indigo-700">
        v3 マトリクス入力（取引形態 × 構成要素）
      </div>

      {/* 取引形態（列）*/}
      <div className="space-y-2">
        <div className="text-[10px] font-mono font-bold text-muted-foreground">
          1-3(A) 取引形態・基準価格 ＋ 2-1 金銭条件
        </div>
        {conds.length === 0 && (
          <p className="text-[10px] font-mono text-muted-foreground">取引形態を追加してください。</p>
        )}
        {conds.map((c, i) => (
          <div key={c.id} className="relative rounded-md border border-border bg-card px-3 py-2 space-y-1.5">
            <button
              type="button"
              onClick={() => delCond(c.id)}
              className="absolute top-1.5 right-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-red-600 hover:bg-red-50"
            >
              削除
            </button>
            <div className="text-[10px] font-mono font-bold">条件{i + 1}：取引形態名</div>
            <input className={inputCls} value={c.name || ''} onChange={(e) => updCond(c.id, 'name', e.target.value)} placeholder="例：製造・販売 / サブライセンス" />
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">製造者</span><input className={inputCls} value={c.manufacturer || ''} onChange={(e) => updCond(c.id, 'manufacturer', e.target.value)} placeholder="Licensee / —" /></label>
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">販売者</span><input className={inputCls} value={c.seller || ''} onChange={(e) => updCond(c.id, 'seller', e.target.value)} placeholder="Licensee / Sublicensee" /></label>
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">地域(最大)</span><input className={inputCls} value={c.maxReg || ''} onChange={(e) => updCond(c.id, 'maxReg', e.target.value)} placeholder="全世界" /></label>
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">言語(最大)</span><input className={inputCls} value={c.maxLang || ''} onChange={(e) => updCond(c.id, 'maxLang', e.target.value)} placeholder="全言語" /></label>
            </div>
            <label className="block space-y-0.5"><span className="text-[10px] text-muted-foreground">基準価格</span><input className={inputCls} value={c.basePrice || ''} onChange={(e) => updCond(c.id, 'basePrice', e.target.value)} placeholder="例：上代（MSRP）× 数量" /></label>
            <label className="flex items-center gap-2 text-[11px] font-mono">
              <input type="checkbox" className="h-3 w-3" checked={!!c.addon} onChange={(e) => updCond(c.id, 'addon', e.target.checked)} />
              加算型（構成要素LCの料率を合算する）
            </label>
            {!c.addon && (
              <label className="block space-y-0.5"><span className="text-[10px] text-muted-foreground">実効料率（%・非加算型）</span><input type="number" step="0.01" className={inputCls} value={c.fixedRate || ''} onChange={(e) => updCond(c.id, 'fixedRate', e.target.value)} placeholder="50" /></label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">地域(今回)</span><input className={inputCls} value={c.reg || ''} onChange={(e) => updCond(c.id, 'reg', e.target.value)} placeholder="全世界" /></label>
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">言語(今回)</span><input className={inputCls} value={c.lang || ''} onChange={(e) => updCond(c.id, 'lang', e.target.value)} placeholder="全言語" /></label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">個数</span><input className={inputCls} value={c.qty || ''} onChange={(e) => updCond(c.id, 'qty', e.target.value)} placeholder="数量 / 1" /></label>
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">AG</span><input className={inputCls} value={c.ag || ''} onChange={(e) => updCond(c.id, 'ag', e.target.value)} placeholder="0" /></label>
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">MG</span><input className={inputCls} value={c.mg || ''} onChange={(e) => updCond(c.id, 'mg', e.target.value)} placeholder="0" /></label>
            </div>
            <div className="grid grid-cols-2 gap-2 items-end">
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">通貨</span>
                <select className={inputCls} value={c.cur || 'JPY'} onChange={(e) => updCond(c.id, 'cur', e.target.value)}>
                  {CURRENCIES.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <div className="text-[10px] font-mono text-indigo-700">
                適用料率: <span className="font-bold">{appliedRate(c, lcs)}</span>
                <span className="text-muted-foreground">（{c.addon ? '加算型＝LC合算' : '非加算型＝実効'}）</span>
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={addCond} className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50">
          ＋ 取引形態を追加
        </button>
      </div>

      {/* 構成要素LC（行）= 「3. マスター条件」で選んだ原作マテリアル。
          ここでは加算型取引形態ごとの料率(コピー条件由来の初期値)をインライン修正するだけ。
          マテリアルの追加/削除・選択は「3. マスター条件」で行う。 */}
      <div className="space-y-2">
        <div className="text-[10px] font-mono font-bold text-muted-foreground">
          1-3(B) 構成要素（LC＝原作マテリアル）と料率
          <span className="ml-2 font-normal text-muted-foreground/70">
            — マテリアルは「3. マスター条件」で選択
          </span>
        </div>

        {lcs.length === 0 && (
          <p className="text-[10px] font-mono text-muted-foreground">
            「3. マスター条件」で原作マテリアルを選択すると、ここに構成要素として表示されます。
          </p>
        )}
        {lcs.map((l, i) => (
          <div key={i} className="rounded-md border border-border bg-card px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono font-bold truncate">
                {l.material_code ? `[${l.material_code}] ` : ''}
                {l.name || '(構成要素)'}
              </span>
              {l.holder && (
                <span className="text-[9px] font-mono text-muted-foreground">
                  権利元: {l.holder}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">加算型取引形態ごとの料率(%)</span>
              {addonConds.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/70">加算型の取引形態がありません。</p>
              ) : (
                addonConds.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono flex-1 truncate">{c.name || `条件${conds.indexOf(c) + 1}`}</span>
                    <input type="number" step="0.01" className="w-20 text-[11px] font-mono bg-transparent border-b border-input py-0.5 text-right focus:outline-none focus:border-foreground" value={l.rates?.[String(c.id)] || ''} onChange={(e) => updRate(i, c.id, e.target.value)} placeholder="0" />
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * V3CalcBaseEditor — 2-3(A) 計算基準日の版別テーブル入力。
 * formData.v3_calc_base_rows を produce する。空のまま保存しても
 * context builder 側の既定行（初版=発売日 / 2版以降=製造日）で描画される。
 */
export function V3CalcBaseEditor({
  rows,
  onChange,
}: {
  rows: V3CalcBaseRow[];
  onChange: (next: V3CalcBaseRow[]) => void;
}) {
  const effective = rows.length > 0 ? rows : DEFAULT_CALC_BASE_ROWS;
  const upd = (i: number, k: keyof V3CalcBaseRow, v: string) =>
    onChange(effective.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => onChange([...effective, { edition: '', trigger: '', note: '' }]);
  const delRow = (i: number) => onChange(effective.filter((_, idx) => idx !== i));

  return (
    <div className="col-span-full space-y-2">
      <div className="text-[10px] font-mono font-bold text-muted-foreground">
        2-3(A) 計算基準日（支払期日の起点）
        <span className="ml-2 font-normal text-muted-foreground/70">
          — 支払期日は個人=翌月20日 / 法人=翌月末日（固定文）
        </span>
      </div>
      <div className="grid grid-cols-[90px_1fr_1fr_auto] gap-x-2 gap-y-1 items-center">
        <span className="text-[10px] text-muted-foreground">版</span>
        <span className="text-[10px] text-muted-foreground">計算基準日となる事由</span>
        <span className="text-[10px] text-muted-foreground">備考</span>
        <span />
        {effective.map((r, i) => (
          <React.Fragment key={i}>
            <input className={inputCls} value={r.edition || ''} onChange={(e) => upd(i, 'edition', e.target.value)} placeholder="初版 / 2版以降" />
            <input className={inputCls} value={r.trigger || ''} onChange={(e) => upd(i, 'trigger', e.target.value)} placeholder="発売日 / 製造日" />
            <input className={inputCls} value={r.note || ''} onChange={(e) => upd(i, 'note', e.target.value)} placeholder="" />
            <button
              type="button"
              onClick={() => delRow(i)}
              disabled={effective.length <= 1}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              削除
            </button>
          </React.Fragment>
        ))}
      </div>
      <button type="button" onClick={addRow} className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50">
        ＋ 版の行を追加（版・取引形態で事由を分ける場合）
      </button>
    </div>
  );
}
