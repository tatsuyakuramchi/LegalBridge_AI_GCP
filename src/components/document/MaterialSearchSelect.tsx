import * as React from 'react';

// 原作マテリアルを「検索して選ぶ」ピッカー。プルダウンが長くて選びにくい問題の解消用。
//   コード(material_code) / 素材名 / 原作名(_ledger_title) / 原作コード で部分一致。
//   未選択時はテキスト入力(フォーカスで全件、入力で絞り込み)、選択後はラベル表示＋「変更」。
//   候補は materialPool(全原作のマテリアルを _ledger_title 付きで平坦化したもの)を受け取る。
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
}: {
  materials: MaterialOption[];
  value?: string;
  onPick: (code: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);

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
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-border bg-card shadow-md">
          {matches.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[10px] font-mono text-muted-foreground">
              {q.trim() ? '該当するマテリアルがありません' : 'マテリアルがありません'}
            </div>
          ) : (
            matches.map((m) => (
              <button
                key={m.id ?? m.material_code}
                type="button"
                className="block w-full text-left px-2.5 py-1.5 text-[11px] font-mono hover:bg-muted"
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
        </div>
      )}
    </div>
  );
}

export default MaterialSearchSelect;
