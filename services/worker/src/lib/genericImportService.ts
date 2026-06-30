/**
 * 汎用スキーマ駆動 CSV 取込エンジン。
 *
 * 全 public テーブル＋互換ビュー(cc/cfc/cli/expenses/other_fees)を対象に、
 *   - 取込可能オブジェクトの一覧（列メタ付き）
 *   - 列定義からのテンプレ CSV 生成
 *   - CSV 行の一括 upsert（PK があれば ON CONFLICT、無ければ/ビューは plain INSERT→トリガ）
 * を提供する。識別子は introspection 済みの許可リストでのみ受け付け、二重引用でクォート。
 *
 * 設計メモ:
 *   - 値は text パラメータで渡し PG の暗黙キャストに委ねる（int/numeric/bool/date/
 *     timestamptz/jsonb/array いずれも text から解釈可能。jsonb は valid JSON、array は {a,b}）。
 *   - 空セルは「列を省略」＝列 default / NULL に委ねる（''::int 等のキャスト失敗を回避）。
 *   - 生成列(GENERATED ALWAYS)・identity always は取込対象外。
 *
 * db.query のみに依存（server.ts 非依存＝単体テスト可能）。
 */

export interface ImpDb {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface ColumnMeta {
  name: string;
  data_type: string;     // 表示用（information_schema.data_type / udt_name）
  required: boolean;     // NOT NULL かつ default 無し
  has_default: boolean;
  is_pk: boolean;
  importable: boolean;   // 生成列/identity-always は false
}

export interface ImportObject {
  name: string;
  kind: "table" | "view";
  columns: ColumnMeta[];
  pk: string[];          // 主キー（ビューは空）
  keys: string[][];      // upsert 競合キー候補（PK＋非部分ユニーク。PK 優先順）
}

// 取込対象から除外する system/運用テーブル（データ実体でないもの）。
const DENY = new Set<string>([
  "schema_migrations",
  "session",
  "sessions",
]);

// 明示的に取り込み可能にする互換ビュー（INSTEAD OF トリガ経由で書ける）。
const COMPAT_VIEWS = new Set<string>([
  "contract_capabilities",
  "capability_financial_conditions",
  "capability_line_items",
  "capability_expenses",
  "capability_other_fees",
]);

const ident = (n: string) => `"${String(n).replace(/"/g, '""')}"`;

/** 取込可能オブジェクト名（table+対象view）を取得。 */
export async function listObjectNames(db: ImpDb): Promise<{ name: string; kind: "table" | "view" }[]> {
  const r = await db.query(
    `SELECT c.relname AS name,
            CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view' END AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r','p','v')
      ORDER BY c.relname`
  );
  return r.rows
    .filter((x: any) => x.kind === "table" || COMPAT_VIEWS.has(x.name))
    .filter((x: any) => !DENY.has(x.name))
    .map((x: any) => ({ name: x.name, kind: x.kind }));
}

/** 1 オブジェクトの列メタ＋PKを取得（許可リストで name を検証してから呼ぶ）。 */
export async function describeObject(db: ImpDb, name: string): Promise<ImportObject> {
  const objs = await listObjectNames(db);
  const hit = objs.find((o) => o.name === name);
  if (!hit) throw new Error(`取込対象に存在しないオブジェクト: ${name}`);

  const cols = await db.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default,
            is_generated, identity_generation
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [name]
  );

  let pk: string[] = [];
  let keys: string[][] = [];
  if (hit.kind === "table") {
    // PK＋非部分・非式ユニークインデックスを upsert 競合キー候補として取得（PK 優先）。
    const kr = await db.query(
      `SELECT i.indisprimary AS is_pk,
              array_agg(a.attname::text ORDER BY x.ord) AS cols
         FROM pg_index i
         JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS x(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = x.attnum
        WHERE i.indrelid = ($1)::regclass
          AND i.indisunique
          AND i.indpred IS NULL          -- 部分ユニークは ON CONFLICT 対象外
          AND 0 <> ALL (i.indkey)        -- 式インデックスは除外
        GROUP BY i.indexrelid, i.indisprimary
        ORDER BY i.indisprimary DESC`,
      [ident(name)]
    );
    keys = kr.rows.map((r: any) => r.cols as string[]);
    const pkRow = kr.rows.find((r: any) => r.is_pk);
    pk = pkRow ? (pkRow.cols as string[]) : [];
  }

  const columns: ColumnMeta[] = cols.rows.map((c: any) => {
    const generated = c.is_generated === "ALWAYS" || c.identity_generation === "ALWAYS";
    return {
      name: c.column_name,
      data_type: c.udt_name || c.data_type,
      required: c.is_nullable === "NO" && c.column_default == null && !generated,
      has_default: c.column_default != null,
      is_pk: pk.includes(c.column_name),
      importable: !generated,
    };
  });

  return { name, kind: hit.kind, columns, pk, keys };
}

const csvCell = (v: any): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** テンプレ CSV（ヘッダ＝取込可能列。2行目に "# type(required)" の注記行）。 */
export async function buildTemplateCsv(db: ImpDb, name: string): Promise<string> {
  const obj = await describeObject(db, name);
  const cols = obj.columns.filter((c) => c.importable);
  const header = cols.map((c) => csvCell(c.name)).join(",");
  // 型注記行。先頭セルを "#" 始まりにし、取込時に確実にスキップできるようにする
  //   （"#" 始まりの行は注記/コメント扱い）。データ入力時はこの行を消すか残すかは任意。
  const note = cols
    .map((c, i) => {
      const t = `${c.data_type}${c.required ? " *required" : ""}${c.is_pk ? " [pk]" : ""}`;
      return csvCell(i === 0 ? `# ${t}` : t);
    })
    .join(",");
  return `${header}\r\n${note}\r\n`;
}

export interface ImportResult {
  object: string;
  inserted: number;
  updated: number;
  errors: { row: number; message: string }[];
  total: number;
}

/**
 * CSV 由来の行配列（各行 = {列名: 値}）を一括 upsert する。
 *   - 空文字セルは列省略（default/NULL）。
 *   - PK 全列が揃う table は ON CONFLICT(pk) DO UPDATE。揃わない/ビューは plain INSERT。
 *   - mode='strict'(既定): 1 行でもエラーなら全ロールバック。'besteffort': 成功行のみ commit。
 * @returns 取込結果（inserted/updated/errors）
 */
export async function importRows(
  db: ImpDb,
  name: string,
  rows: Record<string, any>[],
  mode: "strict" | "besteffort" = "strict"
): Promise<ImportResult> {
  const obj = await describeObject(db, name);
  const colSet = new Set(obj.columns.filter((c) => c.importable).map((c) => c.name));

  const res: ImportResult = { object: name, inserted: 0, updated: 0, errors: [], total: rows.length };

  await db.query("BEGIN");
  let aborted = false;
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] || {};
    // 値が非空のヘッダ列のみ採用（未知ヘッダは無視）。
    const provided = Object.keys(raw).filter(
      (k) => colSet.has(k) && raw[k] != null && String(raw[k]).trim() !== ""
    );
    if (provided.length === 0) {
      res.errors.push({ row: i + 1, message: "取込可能な値が空（全列が空/未知）" });
      if (mode === "strict") { aborted = true; break; }
      continue;
    }
    // besteffort はこの行を savepoint で隔離し、失敗しても既成功行を保全。
    if (mode === "besteffort") await db.query("SAVEPOINT row_sp");
    const vals = provided.map((k) => String(raw[k]));
    const placeholders = provided.map((_, j) => `$${j + 1}`);
    const insertCols = provided.map(ident).join(", ");
    const providedSet = new Set(provided);

    // 競合キー = この行が全列を埋めている最初のキー（PK 優先）。ビュー/該当なしは plain INSERT。
    const conflictKey =
      obj.kind === "table"
        ? obj.keys.find((k) => k.length > 0 && k.every((c) => providedSet.has(c)))
        : undefined;

    let sql: string;
    if (conflictKey) {
      const keySet = new Set(conflictKey);
      const updCols = provided.filter((k) => !keySet.has(k));
      const conflict = conflictKey.map(ident).join(", ");
      sql =
        updCols.length > 0
          ? `INSERT INTO ${ident(name)} (${insertCols}) VALUES (${placeholders.join(", ")})
               ON CONFLICT (${conflict}) DO UPDATE SET ${updCols.map((k) => `${ident(k)} = EXCLUDED.${ident(k)}`).join(", ")}
             RETURNING (xmax = 0) AS inserted`
          : `INSERT INTO ${ident(name)} (${insertCols}) VALUES (${placeholders.join(", ")})
               ON CONFLICT (${conflict}) DO NOTHING
             RETURNING (xmax = 0) AS inserted`;
    } else {
      // ビュー or 競合キー未充足 → plain INSERT（ビューは INSTEAD OF トリガが upsert）。
      sql = `INSERT INTO ${ident(name)} (${insertCols}) VALUES (${placeholders.join(", ")})`;
    }

    try {
      const r = await db.query(sql, vals);
      if (r.rows && r.rows[0] && typeof r.rows[0].inserted === "boolean") {
        r.rows[0].inserted ? res.inserted++ : res.updated++;
      } else {
        res.inserted++; // plain INSERT / view
      }
      if (mode === "besteffort") await db.query("RELEASE SAVEPOINT row_sp");
    } catch (e: any) {
      res.errors.push({ row: i + 1, message: String(e?.message || e) });
      if (mode === "strict") { aborted = true; break; }
      // besteffort: この行だけ取り消して続行（既成功行は savepoint 外で保全）。
      await db.query("ROLLBACK TO SAVEPOINT row_sp").catch(() => {});
    }
  }

  if (aborted) {
    await db.query("ROLLBACK").catch(() => {});
    // 全ロールバック＝何もコミットされていないため件数を 0 に戻す。
    res.inserted = 0;
    res.updated = 0;
    return res;
  }
  await db.query("COMMIT").catch(() => {});
  return res;
}
