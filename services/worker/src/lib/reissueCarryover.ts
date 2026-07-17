/**
 * 再発行(reissue)時に、旧版の condition_lines に紐づく実績(condition_events)と
 * 検収/計算リンクを、新版の対応する condition_lines へ引き継ぐ。
 *
 * 背景:
 *   文書を修正すると reissue で新しい document_number ＝ 新しい capability が
 *   作られ、条件明細(condition_lines)は新版側にゼロから作り直される。旧版の
 *   明細はそのまま残る(横断一覧では lifecycle_status で除外)。
 *   既存の reissue 処理は condition_events.document_id を新文書へ付け替えるが、
 *   condition_events.condition_line_id は旧明細を指したままなので、
 *   「新明細=残額満額 / 旧明細=消化済み」と残高が新旧に割れてしまう。
 *
 * 本関数は、旧版で実績を持つ明細を新版の明細へ **一意に対応付けできる場合だけ**
 * 実績・検収リンクを付け替える。少しでも曖昧(0件 or 複数マッチ)なら
 * その明細は触らず skipped に積んで呼び出し側が警告ログを出す。
 * ＝「取り違えるくらいなら何もしない」フェイルセーフ設計。
 *
 * 対応付けキー(content signature):
 *   payment_scheme | direction | amount_ex_tax(小数2桁) | 件名(subject→condition_name)
 *   旧版⇔新版で同一 signature が **旧1件・新1件のときだけ** ペアにする。
 *
 * 冪等: 2回目以降は旧明細に実績が残っていないため何もしない。
 * db.query のみに依存(server.ts 非依存＝単体テスト可能)。
 */

export interface CarryoverDb {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface CarryoverResult {
  carried: number;               // 付け替えた明細ペア数
  movedEvents: number;           // 付け替えた condition_events 件数
  skipped: Array<{ oldLineId: number; lineCode: string | null; reason: string }>;
}

interface LineRow {
  id: number;
  line_code: string | null;
  payment_scheme: string | null;
  direction: string | null;
  amount_ex_tax: any;
  sig_name: string | null;
}

/** 対応付け用の署名。金額は数値正規化して桁揺れを吸収。 */
function signature(r: LineRow): string {
  const amt = Number(String(r.amount_ex_tax ?? "").replace(/[^0-9.\-]/g, ""));
  const amtStr = Number.isFinite(amt) ? amt.toFixed(2) : "";
  const name = String(r.sig_name ?? "").trim();
  const scheme = String(r.payment_scheme ?? "").trim();
  const dir = String(r.direction ?? "").trim();
  return `${scheme}|${dir}|${amtStr}|${name}`;
}

const NEW_LINES_SQL = `
  SELECT cl.id, cl.line_code, cl.payment_scheme, cl.direction, cl.amount_ex_tax,
         COALESCE(NULLIF(cl.subject, ''), cl.condition_name) AS sig_name
    FROM condition_lines cl
    LEFT JOIN documents cc ON cc.id = cl.capability_id
    LEFT JOIN documents d ON d.id = cl.document_id
   WHERE COALESCE(cc.document_number, d.document_number) = $1`;

// 旧版(=同 base の別 document_number)で、有効な実績を持つ明細だけ。
const OLD_EVENT_LINES_SQL = `
  SELECT cl.id, cl.line_code, cl.payment_scheme, cl.direction, cl.amount_ex_tax,
         COALESCE(NULLIF(cl.subject, ''), cl.condition_name) AS sig_name
    FROM condition_lines cl
    LEFT JOIN documents cc ON cc.id = cl.capability_id
    LEFT JOIN documents d ON d.id = cl.document_id
   WHERE COALESCE(cc.base_document_number, d.base_document_number) = $1
     AND COALESCE(cc.document_number, d.document_number) <> $2
     AND EXISTS (
       SELECT 1 FROM condition_events ce
        WHERE ce.condition_line_id = cl.id AND ce.voided_at IS NULL
     )`;

/**
 * @param baseDocumentNumber 再発行系列の base（旧版・新版共通のベース番号）
 * @param newDocNumber       今回作成した新版の document_number
 */
export async function carryOverReissueConsumption(
  db: CarryoverDb,
  baseDocumentNumber: string | null | undefined,
  newDocNumber: string | null | undefined
): Promise<CarryoverResult> {
  const result: CarryoverResult = { carried: 0, movedEvents: 0, skipped: [] };
  const base = String(baseDocumentNumber ?? "").trim();
  const newDoc = String(newDocNumber ?? "").trim();
  if (!base || !newDoc) return result;

  const [newRes, oldRes] = await Promise.all([
    db.query(NEW_LINES_SQL, [newDoc]),
    db.query(OLD_EVENT_LINES_SQL, [base, newDoc]),
  ]);
  const newLines = newRes.rows as LineRow[];
  const oldLines = oldRes.rows as LineRow[];
  if (oldLines.length === 0 || newLines.length === 0) {
    // 旧版に実績付き明細が無い(通常の再発行) or 新版明細が拾えない → 何もしない。
    for (const o of oldLines) {
      result.skipped.push({
        oldLineId: o.id,
        lineCode: o.line_code,
        reason: newLines.length === 0 ? "新版明細を解決できない" : "対象なし",
      });
    }
    return result;
  }

  // signature → id[] の索引を作る。旧1件・新1件のときだけ一意ペアとみなす。
  const groupBySig = (rows: LineRow[]): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const r of rows) {
      const sig = signature(r);
      (m.get(sig) ?? m.set(sig, []).get(sig)!).push(r.id);
    }
    return m;
  };
  const newBySig = groupBySig(newLines);
  const oldBySig = groupBySig(oldLines);

  for (const o of oldLines) {
    const sig = signature(o);
    const olds = oldBySig.get(sig) ?? [];
    const news = newBySig.get(sig) ?? [];
    if (olds.length !== 1 || news.length !== 1) {
      result.skipped.push({
        oldLineId: o.id,
        lineCode: o.line_code,
        reason: `一意対応不可(旧${olds.length}件/新${news.length}件・内容編集の可能性)`,
      });
      continue;
    }
    const newLineId = news[0];

    // 実績・検収/計算リンクを新明細へ付け替える。event 行自体は同一のため
    //   delivery_line_items.condition_event_id はそのまま有効。
    const ev = await db.query(
      `UPDATE condition_events SET condition_line_id = $1
        WHERE condition_line_id = $2 AND voided_at IS NULL`,
      [newLineId, o.id]
    );
    await db.query(
      `UPDATE delivery_line_items SET condition_line_id = $1 WHERE condition_line_id = $2`,
      [newLineId, o.id]
    );
    await db.query(
      `UPDATE royalty_calculations SET condition_line_id = $1 WHERE condition_line_id = $2`,
      [newLineId, o.id]
    );
    result.carried += 1;
    result.movedEvents += Number(ev.rowCount || 0);
  }

  return result;
}
