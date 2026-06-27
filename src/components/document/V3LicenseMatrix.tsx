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
  materials = [],
  ledgerTitle,
  ledgers = [],
  defaultLedgerId,
}: {
  conds: V3Cond[];
  lcs: V3Lc[];
  onChangeConds: (next: V3Cond[]) => void;
  onChangeLcs: (next: V3Lc[]) => void;
  materials?: any[];
  ledgerTitle?: string;
  /** 全原作（追加原作の選択元）。各要素に materials[] を含む。 */
  ledgers?: any[];
  /** 文書の原作 id（既定で表示する原作）。 */
  defaultLedgerId?: number | string;
}) {
  // 文書原作＋追加原作: 既定は文書の原作、必要なときだけ他原作を足して
  //   その素材も選択肢に出す（跨ぎ原作の構成要素＝作品Cが複数原作を束ねるケース）。
  const [extraLedgerIds, setExtraLedgerIds] = React.useState<Array<number | string>>([]);

  // 表示する原作グループ（文書原作→追加原作の順、重複排除）。
  const groups = React.useMemo(() => {
    const out: Array<{ id: any; title: string; code?: string; materials: any[] }> = [];
    const seen = new Set<string>();
    const pushLedger = (lg: any) => {
      if (!lg) return;
      const key = String(lg.id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: lg.id,
        title: lg.title || lg.ledger_code || '原作',
        code: lg.ledger_code,
        materials: Array.isArray(lg.materials) ? lg.materials : [],
      });
    };
    const docLedger = ledgers.find((l: any) => String(l.id) === String(defaultLedgerId));
    if (docLedger) pushLedger(docLedger);
    else if (materials.length) {
      // ledgers 未供給のフォールバック（従来挙動）。
      out.push({ id: '__doc__', title: ledgerTitle || '文書の原作', materials });
      seen.add('__doc__');
    }
    for (const lid of extraLedgerIds) {
      pushLedger(ledgers.find((l: any) => String(l.id) === String(lid)));
    }
    return out;
  }, [ledgers, defaultLedgerId, extraLedgerIds, materials, ledgerTitle]);

  const materialPool = React.useMemo(() => groups.flatMap((g) => g.materials), [groups]);
  const addableLedgers = ledgers.filter(
    (l: any) =>
      String(l.id) !== String(defaultLedgerId) &&
      !extraLedgerIds.some((x) => String(x) === String(l.id))
  );
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
  const delCond = (id: number) => {
    onChangeConds(conds.filter((c) => c.id !== id));
    onChangeLcs(
      lcs.map((l) => {
        if (!l.rates) return l;
        const r = { ...l.rates };
        delete r[String(id)];
        return { ...l, rates: r };
      })
    );
  };

  const addLc = () => onChangeLcs([...lcs, { material_code: '', name: '', holder: '', rates: {} }]);
  const updLc = (i: number, k: keyof V3Lc, v: any) =>
    onChangeLcs(lcs.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const updRate = (i: number, condId: number, v: string) =>
    onChangeLcs(
      lcs.map((l, idx) =>
        idx === i ? { ...l, rates: { ...(l.rates || {}), [String(condId)]: v } } : l
      )
    );
  const delLc = (i: number) => onChangeLcs(lcs.filter((_, idx) => idx !== i));

  // LC を原作素材から選択 → material_code/name/権利者を補完（跨ぎ原作プールから検索）。
  const pickMaterial = (i: number, code: string) => {
    const m = materialPool.find((x: any) => x.material_code === code);
    onChangeLcs(
      lcs.map((l, idx) =>
        idx === i
          ? {
              ...l,
              material_code: code,
              name: m ? m.material_name || l.name : l.name,
              holder: m ? m.rights_holder_name || m.rights_holder || l.holder : l.holder,
            }
          : l
      )
    );
  };

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

      {/* 構成要素LC（行）*/}
      <div className="space-y-2">
        <div className="text-[10px] font-mono font-bold text-muted-foreground">
          1-3(B) 構成要素（LC＝原作マテリアル）と料率
        </div>

        {/* 文書原作＋追加原作: 跨ぎ原作の構成要素を引くために他原作を足す。 */}
        {ledgers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-border bg-muted/30 px-2 py-1.5">
            <span className="text-[10px] font-mono text-muted-foreground">他原作を追加:</span>
            <select
              className="text-[11px] font-mono bg-transparent border-b border-input py-0.5 focus:outline-none focus:border-foreground"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) setExtraLedgerIds((prev) => [...prev, v]);
              }}
            >
              <option value="">{addableLedgers.length ? '— 原作を選択 —' : '— 追加可能な原作なし —'}</option>
              {addableLedgers.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.title || l.ledger_code} {l.ledger_code ? `[${l.ledger_code}]` : ''}
                </option>
              ))}
            </select>
            {extraLedgerIds.map((lid) => {
              const lg = ledgers.find((l: any) => String(l.id) === String(lid));
              return (
                <span key={String(lid)} className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-indigo-300 bg-indigo-50 text-indigo-700">
                  {lg?.title || lg?.ledger_code || lid}
                  <button type="button" onClick={() => setExtraLedgerIds((prev) => prev.filter((x) => String(x) !== String(lid)))} className="text-indigo-500 hover:text-red-600">×</button>
                </span>
              );
            })}
          </div>
        )}

        {lcs.length === 0 && (
          <p className="text-[10px] font-mono text-muted-foreground">構成要素を追加してください。</p>
        )}
        {lcs.map((l, i) => (
          <div key={i} className="relative rounded-md border border-border bg-card px-3 py-2 space-y-1.5">
            <button type="button" onClick={() => delLc(i)} className="absolute top-1.5 right-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-red-600 hover:bg-red-50">削除</button>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">原作マテリアルから選択（区分＝material_code）</span>
                <select className={inputCls} value={l.material_code || ''} onChange={(e) => pickMaterial(i, e.target.value)}>
                  <option value="">— 素材を選択 / 手入力 —</option>
                  {groups.map((g) => (
                    <optgroup key={String(g.id)} label={`${g.title}${g.code ? ' [' + g.code + ']' : ''}`}>
                      {g.materials.map((m: any) => (
                        <option key={m.id ?? m.material_code} value={m.material_code}>
                          [{m.material_code}]{m.is_default ? ' ★' : ''} {m.material_name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">区分（material_code）</span><input className={inputCls} value={l.material_code || ''} onChange={(e) => updLc(i, 'material_code', e.target.value)} placeholder="LO-2026-0000-001" /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">構成要素名</span><input className={inputCls} value={l.name || ''} onChange={(e) => updLc(i, 'name', e.target.value)} placeholder="例：原作ゲーム／イラスト" /></label>
              <label className="space-y-0.5"><span className="text-[10px] text-muted-foreground">権利元</span><input className={inputCls} value={l.holder || ''} onChange={(e) => updLc(i, 'holder', e.target.value)} placeholder="株式会社○○" /></label>
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
        <button type="button" onClick={addLc} className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50">
          ＋ 構成要素（LC）を追加
        </button>
      </div>
    </div>
  );
}
