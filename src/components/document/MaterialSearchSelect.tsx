import * as React from 'react';
import { MATERIAL_GENRES, defaultRoleForGenre, roleLabel } from '@/lib/materialVocab';

// 原作マテリアルを「検索して選ぶ」ピッカー。プルダウンが長くて選びにくい問題の解消用。
//   コード(material_code) / 素材名 / 原作名(_ledger_title) / 原作コード で部分一致。
//   未選択時はテキスト入力(フォーカスで全件、入力で絞り込み)、選択後はラベル表示＋「変更」。
//   候補は materialPool(全原作のマテリアルを _ledger_title 付きで平坦化したもの)を受け取る。
//   onCreate を渡すと、検索語をそのまま素材名として新規登録するボタンを候補末尾に出す。
//   クリックすると素材名/種別/権利者/許諾地域/許諾言語の小フォームを展開し、スコープ付きで
//   構成要素(work_materials)を作成する(スコープ無し作成で 1-3 許諾範囲表に穴が空く問題の解消)。
//   登録先の原作(Ledger)の解決は呼び出し側の責務。
export type MaterialOption = {
  id?: any;
  material_code: string;
  material_name?: string;
  is_default?: boolean;
  is_active?: boolean;
  _ledger_title?: string;
  _ledger_code?: string;
};

const labelOf = (m: MaterialOption): string =>
  `[${m.material_code}]${m.is_default ? ' ★' : ''} ${m._ledger_title ? m._ledger_title + '　' : ''}${m.material_name || ''}`;

export function MaterialSearchSelect({
  materials,
  value,
  onPick,
  placeholder = '原作マテリアルを検索（コード / 素材名 / 原作名）',
  onCreate,
  createDisabledReason,
}: {
  materials: MaterialOption[];
  value?: string;
  onPick: (code: string) => void;
  placeholder?: string;
  /** 新規登録。素材名に加え、種別/権利者/許諾地域/許諾言語をスコープとして渡す。
   *  成功時は呼び出し側で選択状態まで確定すること。 */
  onCreate?: (payload: {
    material_name: string;
    material_type?: string;
    rights_holder?: string;
    territory?: string;
    language?: string;
  }) => Promise<void> | void;
  /** 新規登録できない理由(例: 登録先の原作が未選択)。指定時はボタンを無効化して表示。 */
  createDisabledReason?: string;
}) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  // 新規作成フォーム(その場でスコープ付き作成)。open(検索ドロップダウン)とは独立に
  //   表示し、入力欄クリックで検索 input の blur によりフォームが閉じないようにする。
  const [showForm, setShowForm] = React.useState(false);
  const [fName, setFName] = React.useState('');
  const [fGenre, setFGenre] = React.useState('illustration');
  const [fHolder, setFHolder] = React.useState('');
  const [fTerritory, setFTerritory] = React.useState('');
  const [fLanguage, setFLanguage] = React.useState('');

  const openForm = () => {
    if (createDisabledReason) return;
    setFName(q.trim());
    setFGenre('illustration');
    setFHolder('');
    setFTerritory('');
    setFLanguage('');
    setShowForm(true);
    setOpen(false);
  };

  const submitForm = async () => {
    const name = fName.trim();
    if (!name || !onCreate || createDisabledReason || creating) return;
    setCreating(true);
    try {
      await onCreate({
        material_name: name,
        material_type: fGenre || undefined,
        rights_holder: fHolder.trim() || undefined,
        territory: fTerritory.trim() || undefined,
        language: fLanguage.trim() || undefined,
      });
      setQ('');
      setShowForm(false);
    } catch (e) {
      console.error('MaterialSearchSelect: onCreate failed', e);
    } finally {
      setCreating(false);
    }
  };

  const selected = value
    ? (materials || []).find((m) => m.material_code === value) || null
    : null;

  const matches = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = (materials || []).filter(
      (m) => m && m.material_code && m.is_active !== false
    );
    const list = !s
      ? base
      : base.filter((m) =>
          `${m.material_code} ${m.material_name || ''} ${m._ledger_title || ''} ${m._ledger_code || ''}`
            .toLowerCase()
            .includes(s)
        );
    return list.slice(0, 20);
  }, [q, materials]);

  const inputCls =
    'w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground';

  return (
    <div className="relative flex-1 min-w-[12rem]">
      {selected && !open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setQ('');
          }}
          className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-mono border-b border-input py-1 hover:border-foreground"
          title="クリックして変更"
        >
          <span className="truncate">{labelOf(selected)}</span>
          <span className="shrink-0 text-[9px] text-muted-foreground">変更</span>
        </button>
      ) : (
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className={inputCls}
        />
      )}

      {open && (
        // lb-overlay = 不透明サーフェス(テーマの bg-card/bg-popover が triplet 定義で
        //   透明になる問題の対策。index.css 参照)。
        <div className="lb-overlay absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border shadow-md">
          {matches.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[10px] font-mono opacity-70">
              {q.trim() ? '該当するマテリアルがありません' : 'マテリアルがありません'}
            </div>
          ) : (
            matches.map((m) => (
              <button
                key={m.id ?? m.material_code}
                type="button"
                className="block w-full text-left px-2.5 py-1.5 text-[11px] font-mono hover:bg-black/5 dark:hover:bg-white/10"
                onMouseDown={(e) => {
                  e.preventDefault(); // onBlur より先に確定
                  onPick(m.material_code);
                  setQ('');
                  setOpen(false);
                }}
              >
                {labelOf(m)}
              </button>
            ))
          )}
          {onCreate && q.trim() !== '' && !showForm && (
            <>
              <button
                type="button"
                disabled={!!createDisabledReason}
                title={createDisabledReason}
                className="block w-full text-left px-2.5 py-1.5 text-[11px] font-mono border-t border-input text-emerald-700 hover:bg-emerald-50 dark:hover:bg-white/10 disabled:opacity-50"
                onMouseDown={(e) => {
                  e.preventDefault(); // onBlur より先に確定
                  openForm();
                }}
              >
                {`＋「${q.trim()}」を新規マテリアルとして登録…`}
              </button>
              {createDisabledReason && (
                <div className="px-2.5 pb-1.5 text-[9px] font-mono text-muted-foreground">
                  {createDisabledReason}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 新規作成フォーム(スコープ付き)。open とは独立表示。素材名/種別/権利者/許諾地域/許諾言語。 */}
      {onCreate && showForm && (
        <div className="lb-overlay absolute z-50 mt-1 w-full rounded-md border shadow-md p-2.5 space-y-2">
          <div className="text-[10px] font-mono font-bold text-emerald-700">新規構成要素（原作マテリアル）を作成</div>
          <label className="block">
            <span className="text-[9px] font-mono text-muted-foreground">素材名 *</span>
            <input
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder="例: 主人公キャラクターデザイン"
              className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-mono text-muted-foreground">種別（ジャンル）</span>
            <select
              value={fGenre}
              onChange={(e) => setFGenre(e.target.value)}
              className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
            >
              {MATERIAL_GENRES.map((g: { value: string; label: string }) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
            {/* 種別から役割(role)を判定して表示。コアロジック=原作の本体 / サブ=構成要素。 */}
            <span className="mt-0.5 block text-[9px] font-mono text-muted-foreground">
              役割: <b>{roleLabel(defaultRoleForGenre(fGenre))}</b>
              {defaultRoleForGenre(fGenre) === 'core_logic'
                ? '（原作の本体。登録先は上で選択中の原作）'
                : '（構成要素。登録先は上で選択中の原作の配下）'}
            </span>
          </label>
          <label className="block">
            <span className="text-[9px] font-mono text-muted-foreground">権利者（ラベル・任意）</span>
            <input
              value={fHolder}
              onChange={(e) => setFHolder(e.target.value)}
              placeholder="例: 株式会社〇〇"
              className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[9px] font-mono text-muted-foreground">許諾地域（枠・任意）</span>
              <input
                value={fTerritory}
                onChange={(e) => setFTerritory(e.target.value)}
                placeholder="例: 全世界 / 日本国内"
                className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
              />
            </label>
            <label className="block">
              <span className="text-[9px] font-mono text-muted-foreground">許諾言語（枠・任意）</span>
              <input
                value={fLanguage}
                onChange={(e) => setFLanguage(e.target.value)}
                placeholder="例: 全言語 / 日本語"
                className="w-full text-[11px] font-mono bg-transparent border-b border-input py-1 focus:outline-none focus:border-foreground"
              />
            </label>
          </div>
          <div className="text-[9px] font-mono text-muted-foreground/70">
            許諾地域・言語は 1-3「構成要素の許諾範囲」に表示されます（空＝1-1に準ずる）。
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-2.5 py-1 text-[10px] font-mono border border-input rounded-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={creating || !fName.trim() || !!createDisabledReason}
              onClick={() => void submitForm()}
              className="px-2.5 py-1 text-[10px] font-mono font-bold rounded-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {creating ? '登録中…' : '登録して選択'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MaterialSearchSelect;
