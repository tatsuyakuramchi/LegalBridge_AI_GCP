# 新課題(統一課題)UI 設計

> [!WARNING]
> **Superseded by:** [`../plans/legalbridge-remediation-plan-20260714.md`](../plans/legalbridge-remediation-plan-20260714.md) — 2026-07-14 / Phase 0 基準固定。統一課題UIは上位の修正計画書 P1(Matterワークスペース)に統合。本書は草案(未実装)として経緯参照用に保持。

ステータス: **ドラフト(設計合意フェーズ)** / 2026-06-25 起票
関連: [`issue-control-consistency-plan.md`](./issue-control-consistency-plan.md)（2フェイズモデル・条件明細背骨）/ [`condition_lines_unification_design.md`](../condition_lines_unification_design.md)（第10章 課題詳細）

---

## 1. 背景・課題

現状、Backlog 課題は**フェイズ毎にバラバラ起案**される:
- **締結フェイズ**課題: 発注書 / 利用許諾条件書 の作成
- **支払フェイズ**課題: 納品報告 → 検収書、利用報告 → 計算書 の発行(取引が続く限り N 回)

同じ取引なのに課題が分散し、**追跡しづらい**。課題詳細画面では作成文書を見られるが、もっと見やすく、**1画面で作業が一通り完結**する形にしたい。

→ **「新課題」= フェイズ毎の個別 Backlog 課題を束ねる上位の統一エンティティ**を定義し、その新課題1画面で運用する。

## 2. 決定事項

- **D1. 束ねる単位 = 契約(capability)単位**【ユーザー決定】。1つの締結文書(発注書/利用許諾条件書)＝1 capability を親に、配下の支払(検収/計算書)を全部束ねる。
- **D2. 導出ビュー(新テーブルなし)**【ユーザー決定】。条件明細/契約の系譜から自動グルーピング。既存 `related_issue_keys`(condition-line-summary)を契約軸へ拡張。
- **D3. 画面で完結させる作業**【ユーザー決定】: ①文書作成の導線(次に出すべき文書=ghost行をその場で起案) ②課題の終結・統合 ③文書の送付/署名。
- **D4. ベース UI = Request UI(RequestsPage)**。新課題一覧を RequestsPage 流に新設し、行=新課題(契約)。

## 3. 新課題の定義（導出ルール）

**新課題 = 1 capability(structural_role='terms' の締結契約)** を背骨とする。1つの新課題に集まるもの:

```
新課題 = capability cc (締結契約)
├─ 取引先         : cc.vendor_id → vendors
├─ 締結文書       : documents d WHERE d.document_number = cc.document_number   (発注書/利用許諾条件書)
├─ 締結フェイズ課題: cc.backlog_issue_key                                      (1件)
├─ 条件明細       : condition_lines cl WHERE cl.capability_id = cc.id          (背骨・進捗)
│   └─ 完了条件   : payment_scheme(固定費=消化型 残額 / ロイヤリティ=継続型 期間)
└─ 支払フェイズ群 : condition_events ce WHERE ce.condition_line_id ∈ cl
    ├─ 支払文書   : ce.document_id → documents                                (検収書/計算書)
    └─ 支払フェイズ課題: DISTINCT ce.backlog_issue_key                         (N件)
```

- **構成課題** = {締結課題 cc.backlog_issue_key} ∪ {支払課題 DISTINCT condition_events.backlog_issue_key}。これが「バラバラ起案された兄弟課題」の集合。
- **新課題の識別キー** = capability_id(内部)。表示は締結文書番号(例 `ARC-PO-2026-0080`)＋取引先。URL は `/unified/:capabilityId`（または契約番号）。
- master→terms の暗黙 terms は terms 側を新課題単位とする(master は枠組み)。

**この定義は全て既存テーブルから導出可能**(condition-line-summary API の capability 軸版)。新スキーマ不要。

## 4. データ／API（読み取り導出）

### 4-1. 新課題一覧 `GET /api/unified-issues`
capability(terms/締結)単位で集約して返す。1行 =
- capability_id / 締結文書番号 / 取引先名 / contract_title
- フェイズ進捗: 締結(文書final有無) / 納品 / 検収 / 計算 の到達状況(段階レーン用)
- 完了状況サマリ: 条件明細数 / open / fulfilled / 当期未発行(next_actions) / 固定費残額合計 / ロイヤリティ期間
- 構成課題数(締結1＋支払N)・代表ステータス(締結課題の Backlog status)
- フィルタ: 取引先 / 進行中・完了 / 次アクション有り / 取引種別

### 4-2. 新課題詳細 `GET /api/unified-issues/:capabilityId`
1 capability の全構成を返す(condition-line-summary を capability 軸に再構成):
- ヘッダ(取引先・締結文書・契約期間)
- **構成課題**: 締結課題＋支払課題、各 Backlog status（issue_workflows / backlog）
- **文書一覧**: 締結文書＋支払文書(検収/計算)、lifecycle/ is_primary / drive_link / 送付状態
- **条件明細進捗**: status_v/balance_v(固定費=consumed/amount・残額、ロイヤリティ=期間/更新)
- **未発行 ghost 行**: next_template_type(完了明細は除外)
- 取引種別・direction

→ 既存 `GET /api/issues/:issueKey/condition-line-summary`(server.ts:11941)の集約ロジックを capability 軸に一般化して再利用。

## 5. UI（ベース=RequestsPage）

### 5-1. 新課題一覧ページ `/unified`（RequestsPage 流）
- 行 = 新課題(契約)。列: 取引先 / 締結文書 / **段階レーン(締結→納品→利用→検収→計算)** / 完了条件の残(固定費 残額 or ロイヤリティ 期間) / 構成課題数 / 次アクション(ghost有無)
- フィルタ・検索(取引先・文書番号・進行中/完了・次アクション有り)
- 行クリック → 新課題詳細へ

### 5-2. 新課題詳細ページ `/unified/:capabilityId`（IssueDetailPage を契約軸へ格上げ）
1画面で D3 の作業を完結:
- **ヘッダ**: 取引先・締結文書・契約期間・進捗バッジ
- **取引循環進捗**(段階レーン＋条件明細別。既存 SEC·01 を流用拡張)。固定費=残額/分納、ロイヤリティ=期間/更新
- **構成課題リスト**: 締結課題＋支払課題を一覧(フェイズバッジ・Backlog status)。各課題へのリンク
- **文書一覧**(見やすく): 締結文書＋検収/計算書。lifecycle バッジ、**送付/CloudSign 署名ボタン**（D3③、既存送信フロー流用）
- **次に出すべき文書(ghost 行)** → その場で起案(既存 prefill: `/documents/new?template=...&prefill=1`、setSelectedIssue は支払フェイズの課題キー or 新規起票)（D3①）
- **課題の終結・統合**(D3②、既存 merge/terminate API 流用)

既存 IssueDetailPage(1 Backlog 課題単位)は当面**併存**(個別課題の入口として残す)。新課題詳細から各個別課題へリンク。

## 6. Phase 計画

### Phase U0 — 導出 API（読み取り専用）
- [ ] U0-1. `GET /api/unified-issues`（一覧集約）。
- [ ] U0-2. `GET /api/unified-issues/:capabilityId`（詳細集約。condition-line-summary を capability 軸へ一般化）。
- リスク: 低（参照のみ）。

### Phase U1 — 新課題詳細ページ
- [ ] U1-1. `/unified/:capabilityId` ページ（取引循環進捗・構成課題・文書一覧）。
- [ ] U1-2. 文書作成導線(ghost→prefill)。
- [ ] U1-3. 送付/署名ボタン(既存フロー流用)。
- [ ] U1-4. 終結/統合(既存 API)。

### Phase U2 — 新課題一覧ページ
- [ ] U2-1. `/unified` 一覧（RequestsPage 流・段階レーン・フィルタ）。
- [ ] U2-2. ナビゲーション追加、RequestsPage からの相互導線。

### Phase U3 — 仕上げ
- [ ] U3-1. 既存 RequestsPage / IssueDetailPage との関係整理（重複導線の整理、デフォルト入口の決定）。
- [ ] U3-2. 起案時に締結課題と支払課題を新課題へ自然に紐づける導線（バラバラ起案の抑制）。

## 7. オープン事項

- O1. 新課題の URL/識別キーは capability_id か締結文書番号か（人間可読性 vs 安定性）。
- O2. 一覧の「代表ステータス」をどう決めるか（締結課題の Backlog status / 進捗の導出ステータス）。
- O3. 締結フェイズ課題が無い契約(取込・登録条件)も新課題として出すか（capability はあるが締結 Backlog 課題なし）。
- O4. 支払フェイズの新規起票(納品報告/利用報告)を新課題画面から直接起票するか（Backlog 起票導線の有無）。
- O5. 既存 IssueDetailPage を将来的に新課題詳細へ統合（吸収）するか、個別課題ビューとして残すか。
