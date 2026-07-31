-- 0151_text_snippets.sql
-- 定型文言(ひな形)ライブラリ。発注書の「特約・備考」「業務明細(成果物)」等で
--   よく使う文言を登録しておき、専用ページで一覧表示してコピペ運用する(簡易運用)。
--   カテゴリで分類し、並び順・有効フラグを持つ。additive・冪等。

CREATE TABLE IF NOT EXISTS text_snippets (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'special_terms', -- special_terms(特約・備考) / work_item(業務明細) / other
  title       TEXT NOT NULL,                          -- 一覧の見出し(例: 秘密保持)
  body        TEXT NOT NULL DEFAULT '',               -- 実際に貼り付ける本文
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_text_snippets_cat ON text_snippets(category, sort_order, id);

-- スターター例(既に何か入っていれば重複投入しない)。実文言は画面から追加/編集してください。
INSERT INTO text_snippets (category, title, body, sort_order)
SELECT * FROM (VALUES
  ('special_terms', '秘密保持',
   '乙は、本件業務に関して知り得た甲の技術上・営業上その他一切の情報を、甲の事前の書面による承諾なく第三者に開示・漏洩してはならず、本件業務の目的以外に使用してはならない。', 10),
  ('special_terms', '再委託の制限',
   '乙は、本件業務の全部又は一部を、甲の事前の書面による承諾なく第三者に再委託してはならない。', 20),
  ('special_terms', '権利帰属',
   '本件業務に基づき乙が作成した成果物に関する著作権(著作権法第27条及び第28条の権利を含む)その他一切の知的財産権は、甲乙間で別途定める場合を除き、対価の支払をもって甲に帰属する。', 30),
  ('work_item', '成果物一式',
   '本件業務に係る成果物一式(デザインデータ・関連資料を含む)を、甲の指定する形式で納品する。', 10),
  ('work_item', '修正対応',
   '納品後、甲の指示に基づく軽微な修正対応を◯回まで行う(大幅な仕様変更は別途協議)。', 20)
) AS v(category, title, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM text_snippets);
