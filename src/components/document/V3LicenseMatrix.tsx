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
  /** マテリアルの根拠文書番号(利用許諾条件書/発注書、または「この条件書(新規)」)。フォーム表示用。 */
  source_doc?: string;
}
/** 2-3(A) 計算基準日の1行。formData.v3_calc_base_rows（context builder の入力契約）。 */
export interface V3CalcBaseRow {
  edition?: string;
  trigger?: string;
  note?: string;
}
/** 1-4 再許諾台帳の1行。formData.v3_sublicensees（context builder の入力契約）。 */
export interface V3Sublicensee {
  slPartner?: string;
  slRegion?: string;
  slLang?: string;
  slCond?: string;
  slRate?: string;
  slDate?: string;
  slNote?: string;
}
/** 4. 特約事項の追加1行。formData.v3_special_extras（context builder の入力契約）。 */
export interface V3SpecialExtra {
  seId?: string;
  seText?: string;
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

  // テンプレ 1-3/2-1 の表構成に合わせるためのセル用スタイル。
  const cellInput =
    'w-full min-w-[64px] text-[11px] font-mono bg-transparent border-b border-input py-0.5 px-1 focus:outline-none focus:border-foreground';
  const thCls = 'px-2 py-1 font-medium whitespace-nowrap border-b border-border text-left align-bottom';
  const tdCls = 'px-1.5 py-1 align-top border-b border-border/50';
  const condLabel = (c: V3Cond) => c.name || `条件${conds.indexOf(c) + 1}`;

  return (
    <div className="col-span-full space-y-4">
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-indigo-700">
        v3 マトリクス入力（取引形態 × 構成要素）— テンプレ 1-3 / 2-1 の3表構成
      </div>

      {/* ── 1-3(A) 基準価格表: 取引形態(行)の定義。列を他表(1-3B/2-1)へ供給する。 ── */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono font-bold text-muted-foreground">
          1-3(A) 基準価格表 — 取引形態の定義
          <span className="ml-2 font-normal text-muted-foreground/70">
            製造者・販売者の組合せが基準価格を決める。地域・言語は最大スコープ
          </span>
        </div>
        {conds.length === 0 ? (
          <p className="text-[10px] font-mono text-muted-foreground">取引形態を追加してください。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className={`${thCls} w-12 text-center`}>条件</th>
                  <th className={`${thCls} min-w-[120px]`}>取引形態名</th>
                  <th className={`${thCls} min-w-[90px]`}>製造者</th>
                  <th className={`${thCls} min-w-[90px]`}>販売者</th>
                  <th className={`${thCls} min-w-[80px]`}>地域(最大)</th>
                  <th className={`${thCls} min-w-[80px]`}>言語(最大)</th>
                  <th className={`${thCls} min-w-[120px]`}>基準価格</th>
                  <th className={`${thCls} w-16 text-center`}>加算型</th>
                  <th className={`${thCls} w-10`} />
                </tr>
              </thead>
              <tbody>
                {conds.map((c, i) => (
                  <tr key={c.id}>
                    <td className={`${tdCls} text-center font-bold`}>条件{i + 1}</td>
                    <td className={tdCls}><input className={cellInput} value={c.name || ''} onChange={(e) => updCond(c.id, 'name', e.target.value)} placeholder="製造・販売 / サブライセンス" /></td>
                    <td className={tdCls}><input className={cellInput} value={c.manufacturer || ''} onChange={(e) => updCond(c.id, 'manufacturer', e.target.value)} placeholder="Licensee / —" /></td>
                    <td className={tdCls}><input className={cellInput} value={c.seller || ''} onChange={(e) => updCond(c.id, 'seller', e.target.value)} placeholder="Licensee" /></td>
                    <td className={tdCls}><input className={cellInput} value={c.maxReg || ''} onChange={(e) => updCond(c.id, 'maxReg', e.target.value)} placeholder="全世界" /></td>
                    <td className={tdCls}><input className={cellInput} value={c.maxLang || ''} onChange={(e) => updCond(c.id, 'maxLang', e.target.value)} placeholder="全言語" /></td>
                    <td className={tdCls}><input className={cellInput} value={c.basePrice || ''} onChange={(e) => updCond(c.id, 'basePrice', e.target.value)} placeholder="上代（MSRP）× 数量" /></td>
                    <td className={`${tdCls} text-center`}>
                      <input type="checkbox" className="h-3.5 w-3.5" checked={!!c.addon} onChange={(e) => updCond(c.id, 'addon', e.target.checked)} title="加算型（構成要素LCの料率を合算する）" />
                    </td>
                    <td className={`${tdCls} text-center`}>
                      <button type="button" onClick={() => delCond(c.id)} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-red-600 hover:bg-red-50">削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" onClick={addCond} className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50">
          ＋ 取引形態を追加（1-3A の行 ＝ 1-3B / 2-1 の列）
        </button>
      </div>

      {/* ── 1-3(B) 料率表: 構成要素(行) × 取引条件(列) のグリッド。 ── */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono font-bold text-muted-foreground">
          1-3(B) 料率表（構成要素 × 取引条件）
          <span className="ml-2 font-normal text-muted-foreground/70">
            — マテリアルは「2. 許諾の内容」で選択。加算型列のみ料率入力（非加算型は「—」）
          </span>
        </div>
        {lcs.length === 0 ? (
          <p className="text-[10px] font-mono text-muted-foreground">
            「2. 許諾の内容」で原作マテリアルを選択すると、ここに構成要素(行)として表示されます。
          </p>
        ) : conds.length === 0 ? (
          <p className="text-[10px] font-mono text-muted-foreground">先に 1-3(A) で取引形態(列)を追加してください。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className={`${thCls} min-w-[130px]`}>区分 / 根拠文書</th>
                  <th className={`${thCls} min-w-[120px]`}>構成要素</th>
                  <th className={`${thCls} min-w-[100px]`}>権利元</th>
                  {conds.map((c, i) => (
                    <th key={c.id} className={`${thCls} min-w-[72px] text-center`}>
                      条件{i + 1}
                      <div className="text-[8px] font-normal">{c.addon ? '【加算型】' : '【非加算型】'}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lcs.map((l, i) => (
                  <tr key={i}>
                    <td className={`${tdCls} font-mono`}>
                      <div className="font-bold text-indigo-700">{l.source_doc || 'この条件書(新規)'}</div>
                      <div className="text-[9px] text-muted-foreground/70">{l.material_code || '(未設定)'}</div>
                    </td>
                    <td className={`${tdCls} font-bold`}>{l.name || '(構成要素)'}</td>
                    <td className={`${tdCls} text-muted-foreground`}>{l.holder || '—'}</td>
                    {conds.map((c) =>
                      c.addon ? (
                        <td key={c.id} className={`${tdCls} text-center`}>
                          <input
                            type="number"
                            step="0.01"
                            className="w-16 text-[11px] font-mono bg-transparent border-b border-input py-0.5 text-right focus:outline-none focus:border-foreground"
                            value={l.rates?.[String(c.id)] || ''}
                            onChange={(e) => updRate(i, c.id, e.target.value)}
                            placeholder="0"
                          />
                        </td>
                      ) : (
                        <td key={c.id} className={`${tdCls} text-center text-muted-foreground/60`}>—</td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[9px] font-mono text-muted-foreground/70">
          【加算型】対象製品に含まれる構成要素の料率を合算して 2-1 の適用料率を算出。【非加算型】実効料率は 2-1 に直接入力。
        </p>
      </div>

      {/* ── 2-1 金銭条件マスタ: 取引形態(行)の4パラメータ＋通貨。適用料率は 1-3(B) から自動。 ── */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono font-bold text-muted-foreground">
          2-1 金銭条件マスタ（取引形態の定義）
          <span className="ml-2 font-normal text-muted-foreground/70">
            地域・言語は 1-1／1-3(A) の範囲内。適用料率は加算型＝1-3(B)合算・非加算型＝実効料率入力
          </span>
        </div>
        {conds.length === 0 ? (
          <p className="text-[10px] font-mono text-muted-foreground">1-3(A) で取引形態を追加すると表示されます。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className={`${thCls} w-12 text-center`}>条件</th>
                  <th className={`${thCls} w-20 text-center`}>種別</th>
                  <th className={`${thCls} min-w-[72px]`}>地域(今回)</th>
                  <th className={`${thCls} min-w-[72px]`}>言語(今回)</th>
                  <th className={`${thCls} min-w-[90px] text-center`}>適用料率</th>
                  <th className={`${thCls} w-16`}>個数</th>
                  <th className={`${thCls} w-14`}>AG</th>
                  <th className={`${thCls} w-14`}>MG</th>
                  <th className={`${thCls} w-16`}>通貨</th>
                </tr>
              </thead>
              <tbody>
                {conds.map((c, i) => (
                  <tr key={c.id}>
                    <td className={`${tdCls} text-center font-bold`}>条件{i + 1}</td>
                    <td className={`${tdCls} text-center`}>
                      <span className="text-[9px] font-bold">{c.addon ? '加算型' : '非加算型'}</span>
                    </td>
                    <td className={tdCls}><input className={cellInput} value={c.reg || ''} onChange={(e) => updCond(c.id, 'reg', e.target.value)} placeholder="全世界" /></td>
                    <td className={tdCls}><input className={cellInput} value={c.lang || ''} onChange={(e) => updCond(c.id, 'lang', e.target.value)} placeholder="全言語" /></td>
                    <td className={`${tdCls} text-center`}>
                      {c.addon ? (
                        <span className="text-indigo-700 font-bold">{appliedRate(c, lcs)}</span>
                      ) : (
                        <div className="flex items-center justify-center gap-0.5">
                          <input type="number" step="0.01" className="w-14 text-[11px] font-mono bg-transparent border-b border-input py-0.5 text-right focus:outline-none focus:border-foreground" value={c.fixedRate ?? ''} onChange={(e) => updCond(c.id, 'fixedRate', e.target.value)} placeholder="50" />
                          <span className="text-[9px] text-muted-foreground">%</span>
                        </div>
                      )}
                    </td>
                    <td className={tdCls}><input className={cellInput} value={c.qty || ''} onChange={(e) => updCond(c.id, 'qty', e.target.value)} placeholder="数量 / 1" /></td>
                    <td className={tdCls}><input className={cellInput} value={c.ag ?? ''} onChange={(e) => updCond(c.id, 'ag', e.target.value)} placeholder="0" /></td>
                    <td className={tdCls}><input className={cellInput} value={c.mg ?? ''} onChange={(e) => updCond(c.id, 'mg', e.target.value)} placeholder="0" /></td>
                    <td className={tdCls}>
                      <select className={cellInput} value={c.cur || 'JPY'} onChange={(e) => updCond(c.id, 'cur', e.target.value)}>
                        {CURRENCIES.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

/**
 * SublicenseeEditor — 1-4 再許諾（Sub-license）台帳。
 * formData.v3_sublicensees を produce する。空なら未出力（テンプレは「登録なし」表示）。
 */
export function SublicenseeEditor({
  rows,
  onChange,
}: {
  rows: V3Sublicensee[];
  onChange: (next: V3Sublicensee[]) => void;
}) {
  const upd = (i: number, k: keyof V3Sublicensee, v: string) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () =>
    onChange([...rows, { slPartner: '', slRegion: '', slLang: '', slCond: '', slRate: '', slDate: '', slNote: '' }]);
  const delRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="col-span-full space-y-2">
      <div className="text-[10px] font-mono font-bold text-muted-foreground">
        1-4 再許諾台帳（Sub-license）
        <span className="ml-2 font-normal text-muted-foreground/70">
          — Licensor の事前書面承認を得た再許諾先を登録
        </span>
      </div>
      {rows.length === 0 && (
        <p className="text-[10px] font-mono text-muted-foreground">
          再許諾先がある場合は「＋再許諾先を追加」。未登録ならテンプレには「（現時点で登録なし）」と表示されます。
        </p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="rounded-md border border-border bg-card px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold text-muted-foreground">#{i + 1}</span>
            <button
              type="button"
              onClick={() => delRow(i)}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-red-600 hover:bg-red-50"
            >
              削除
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">相手先</span><input className={inputCls} value={r.slPartner || ''} onChange={(e) => upd(i, 'slPartner', e.target.value)} placeholder="例：サブA社" /></label>
            <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">適用条件</span><input className={inputCls} value={r.slCond || ''} onChange={(e) => upd(i, 'slCond', e.target.value)} placeholder="例：サブライセンス" /></label>
            <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">地域</span><input className={inputCls} value={r.slRegion || ''} onChange={(e) => upd(i, 'slRegion', e.target.value)} placeholder="例：北米" /></label>
            <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">言語</span><input className={inputCls} value={r.slLang || ''} onChange={(e) => upd(i, 'slLang', e.target.value)} placeholder="例：英語" /></label>
            <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">個別料率</span><input className={inputCls} value={r.slRate || ''} onChange={(e) => upd(i, 'slRate', e.target.value)} placeholder="例：50" /></label>
            <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">締結日</span><input className={inputCls} value={r.slDate || ''} onChange={(e) => upd(i, 'slDate', e.target.value)} placeholder="YYYY-MM-DD" /></label>
          </div>
          <label className="block space-y-0.5"><span className="text-[10px] text-muted-foreground">備考</span><input className={inputCls} value={r.slNote || ''} onChange={(e) => upd(i, 'slNote', e.target.value)} placeholder="" /></label>
        </div>
      ))}
      <button type="button" onClick={addRow} className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50">
        ＋ 再許諾先を追加
      </button>
    </div>
  );
}

/**
 * SpecialExtrasEditor — 4. 特約事項の追加条項。
 * formData.v3_special_extras を produce する。固定の 4-1 / 4-2 はテンプレ側の固定文で、
 * ここでは 4-3 以降の追加特約のみを入力する。空なら未出力。
 */
export function SpecialExtrasEditor({
  rows,
  onChange,
}: {
  rows: V3SpecialExtra[];
  onChange: (next: V3SpecialExtra[]) => void;
}) {
  const upd = (i: number, k: keyof V3SpecialExtra, v: string) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => onChange([...rows, { seId: '', seText: '' }]);
  const delRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="col-span-full space-y-2">
      <div className="text-[10px] font-mono font-bold text-muted-foreground">
        追加特約（4-3 以降）
        <span className="ml-2 font-normal text-muted-foreground/70">
          — 4-1（一体効力）・4-2（複数対象作品の料率）はテンプレ固定文
        </span>
      </div>
      {rows.length === 0 && (
        <p className="text-[10px] font-mono text-muted-foreground">
          追加の特約がある場合は「＋特約を追加」。無ければ固定文（4-1 / 4-2）のみ出力されます。
        </p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="rounded-md border border-border bg-card px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              className="w-24 text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
              value={r.seId || ''}
              onChange={(e) => upd(i, 'seId', e.target.value)}
              placeholder="例：4-3"
            />
            <button
              type="button"
              onClick={() => delRow(i)}
              className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-red-600 hover:bg-red-50"
            >
              削除
            </button>
          </div>
          <textarea
            className="w-full text-[11px] font-mono bg-transparent border border-input rounded px-2 py-1 focus:outline-none focus:border-foreground"
            rows={2}
            value={r.seText || ''}
            onChange={(e) => upd(i, 'seText', e.target.value)}
            placeholder="特約の本文"
          />
        </div>
      ))}
      <button type="button" onClick={addRow} className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50">
        ＋ 特約を追加
      </button>
    </div>
  );
}
