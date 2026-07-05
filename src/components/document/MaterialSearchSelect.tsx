import * as React from 'react';

// 原作マテリアルを「検索して選ぶ」ピッカー。プルダウンが長くて選びにくい問題の解消用。
//   コード(material_code) / 素材名 / 原作名(_ledger_title) / 原作コード で部分一致。
//   未選択時はテキスト入力(フォーカスで全件、入力で絞り込み)、選択後はラベル表示＋「変更」。
//   候補は materialPool(全原作のマテリアルを _ledger_title 付きで平坦化したもの)を受け取る。
//   onCreate を渡すと、検索語をそのまま素材名として新規登録するボタンを候補末尾に出す
//   (文書フォームから離脱せずマテリアルを作成する動線。登録先の解決は呼び出し側の責務)。
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
  /** 検索語を素材名として新規登録する。成功時は呼び出し側で選択状態まで確定すること。 */
  onCreate?: (name: string) => Promise<void> | void;
  /** 新規登録できない理由(例: 登録先の原作が未選択)。指定時はボタンを無効化して表示。 */
  createDisabledReason?: string;
}) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const runCreate = async () => {
    const name = q.trim();
    if (!name || !onCreate || createDisabledReason || creating) return;
    setCreating(true);
    try {
      await onCreate(name);
      setQ('');
      setOpen(false);
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
          {onCreate && q.trim() !== '' && (
            <>
              <button
                type="button"
                disabled={creating || !!createDisabledReason}
                title={createDisabledReason}
                className="block w-full text-left px-2.5 py-1.5 text-[11px] font-mono border-t border-input text-emerald-700 hover:bg-emerald-50 dark:hover:bg-white/10 disabled:opacity-50"
                onMouseDown={(e) => {
                  e.preventDefault(); // onBlur より先に確定
                  void runCreate();
                }}
              >
                {creating
                  ? '登録中…'
                  : `＋「${q.trim()}」を新規マテリアルとして登録`}
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
    </div>
  );
}

export default MaterialSearchSelect;
