/**
 * apiRoutingRules — /api/* の read/write サービス振り分け規則(単一ソース)。
 *
 * Phase 6(API・認証): この規則は 2 箇所から参照される。
 *   1. server.ts(admin-ui の薄い Express ホスト)の同一オリジン BFF プロキシ
 *      — ブラウザは相対 /api/* を叩き、サーバ側でここの規則により
 *        search-api(read) / document-worker(write) へ転送する(正本経路)。
 *   2. src/lib/apiRouter.ts の window.fetch monkey-patch
 *      — VITE_API_SAME_ORIGIN=1 の本番では休眠。ロールバック用に残す。
 *
 * 凍結ルール(計画 §8): 新しいルートをここに足すのは「実装サービスが規則の
 * 既定(GET=read / 変更系=write)と異なる場合」のみ。ドメインAPIクライアント
 * (Phase 6 第2弾以降)への移行が完了したルートから削除していく。
 */

// GET でも WRITE(document-worker)へ振るルート。
export const WRITE_PATHS_ON_GET: RegExp[] = [
  // CloudSign 送信履歴 GET は worker のみ実装。READ_PATHS_ON_GET の
  //   /api/contracts/\d+ より先に評価されるのでここで WRITE に明示する。
  /^\/api\/contracts\/\d+\/cloudsign(?:\/|\?|$)/,
  // 課題の CloudSign ルート/まとめ送信(GET route)は worker のみ実装。
  /^\/api\/issues\/[^/]+\/cloudsign(?:\/|\?|$)/,
  // ラインIDでの明細 lookup は worker のみ実装。
  /^\/api\/line-items(?:\/|\?|$)/,
  // 課題詳細の条件明細サマリは worker のみ実装。
  /^\/api\/issues\/[^/]+\/condition-line-summary(?:\?|$)/,
  // 個別課題→所属する新課題(統一課題)リゾルバも worker のみ実装。
  /^\/api\/issues\/[^/]+\/unified(?:\?|$)/,
  // CloudSign の接続テスト(/api/cloudsign/health)等の GET も worker のみ実装。
  /^\/api\/cloudsign(?:\/|\?|$)/,
  // メール送信の接続テスト(/api/email/health)も worker のみ実装。
  /^\/api\/email(?:\/|\?|$)/,
  /^\/api\/templates(?:\/|$)/,
  /^\/api\/master\/workflow-settings(?:\/|$)/,
  /^\/api\/numbering(?:\/|$)/,
  // Phase 10: CSV テンプレ DL は worker に常駐 (text/csv レスポンス)
  /^\/api\/imports\/bulk\/templates(?:\/|$)/,
  /^\/api\/imports\/bulk\/inspection\/trigger-waiting\.csv(?:\?|$)/,
  // 統合修正: v2 一括取込のテンプレ DL も worker のみが提供する(GET)。
  //   これが無いと READ(search-api)へ振られて 404(発注書等のサンプルCSVが落ちない)。
  /^\/api\/imports\/v2\/templates(?:\/|\?|$)/,
  // 汎用スキーマ駆動 CSV 取込（一覧・テンプレ DL の GET）は worker のみ実装。
  //   一覧 /api/imports/tables、テンプレ /api/imports/tables/:name/template.csv。
  /^\/api\/imports\/tables(?:\/|\?|$)/,
  // データモデル整理: 連結チェック(整合性点検)は worker のみ実装。
  /^\/api\/admin\/data-linkage\/check(?:\?|$)/,
  // 課題コントロール整合性監査(読み取り専用)も worker のみ実装。
  /^\/api\/audit\/issue-consistency(?:\?|$)/,
  // 新課題(統一課題)導出API(一覧/詳細・読み取り専用)も worker のみ実装。
  /^\/api\/unified-issues(?:\/[^/]+)?(?:\?|$)/,
  // 案件(matter)管理API(一覧/詳細/CRUD)は worker のみ実装。GET も worker へ。
  /^\/api\/matters(?:\/.*)?(?:\?|$)/,
  // 統合 Phase2 ドライラン(読み取り専用集計)は worker のみ実装。
  /^\/api\/admin\/unify\/phase2-dryrun(?:\?|$)/,
  // Phase 15/16: 個別ドキュメント取得 + PDF 未作成キューは worker のみ
  // (form_data 全件返却 + jsonb 操作のため)
  /^\/api\/documents\/pending-pdf(?:\?|$)/,
  // Excel バッチ出力キュー (未発行集計) は worker のみ実装 (form_data 集計)。
  /^\/api\/excel-batches\/pending(?:\?|$)/,
  /^\/api\/documents\/by-number\/(?:\/|\?|$|.)/,
  /^\/api\/documents\/\d+(?:\/|\?|$)/,
  // Phase 22.21.48 / 22.21.59: 部分検索エンドポイントも worker のみ実装。
  //   旧仕様の by-number (完全一致) と違い、search-api 側にミラーが無いので
  //   明示的に WRITE 経路にルーティングしないと search-api で 404 になる。
  /^\/api\/documents\/search(?:\?|$|\/)/,
  // Phase 17: 稟議マスタの read/write は worker (junction テーブル含む)
  /^\/api\/ringi(?:\/|$|\?)/,
  // Phase 22.21.79: 文書 draft (一時保存) は worker のみで GET/POST/DELETE
  //   admin-ui DocumentEditorPage の「DBSYNC」ボタンと
  //   閲覧/編集モードトグル時に直叩きする。
  /^\/api\/document-drafts(?:\/|$|\?)/,
  // Phase 3 (LB-F10/§7): 連携疎通ステータスと実ファイル台帳サマリは worker のみ実装。
  //   エディタフッターの接続表示 / Drive 健全性の俯瞰で GET する。
  /^\/api\/integrations\/status(?:\?|$)/,
  /^\/api\/drive\/file-health(?:\?|$)/,
  // Phase 23.6.12: /api/management/* は worker のみに実装。
  //   GET /api/management/issues/:issueKey/line-items (WorkflowPanel)
  //   PATCH /api/management/order-line-items/:id/deadline
  //   PATCH /api/management/issues/:issueKey/deadline
  //   POST  /api/management/issues/:issueKey/deadline-change
  //   GET   /api/management/alerts / /api/management/deliveries は
  //         api/server.ts にも mirror がある (上書きされて WRITE に行く)
  //         が、search-api 経路でも問題ないので broaden しない。
  //   ここでは line-items GET を WRITE に明示的に振る。
  /^\/api\/management\/issues\/[^/]+\/line-items(?:\?|$|\/)/,
  // 設計 v1.4 DQ-02/04: データ完全性 API(rules/issues/summary の GET)は worker のみ実装。
  //   これが無いと search-api へ振られて 404(完全性 Badge/Issue が出ない)。POST/PATCH は既定で write。
  /^\/api\/data-quality\//,
];

// READS_TO_WORKER=1 でも常に READ(search-api)へ振る GET。worker にミラーが
// 無い search-api 専用 read のため、ここで明示しないと 404 になる。
//   - /api/contracts/search  : 親契約 picker (registerContractsV2)
//   - /api/contracts/:id      : 契約詳細 (registerContractsV2)
export const READ_PATHS_ON_GET: RegExp[] = [
  /^\/api\/contracts\/search(?:\?|$)/,
  /^\/api\/contracts\/\d+(?:\/|\?|$)/,
  // 統合 P3-2: 条件明細横断検索は search-api 専用 read。
  /^\/api\/conditions(?:\/|\?|$)/,
  // /api/v3/* は全て search-api 専用 read(worker に v3 GET ミラーは無い)。
  //   READS_TO_WORKER=1 でも worker へ振らず常に search-api へ。原作/作品/契約ピッカーに加え
  //   vendors / license-capabilities / condition-lines(by-document) / source-ips 配下の
  //   マテリアル条件等を含む(限定列挙だと新規 v3 read を都度足す必要があり 404 を招く)。
  /^\/api\/v3\//,
  // 統合 P3-5: 作品モデル CSV サンプル(template)も search-api 専用 read。
  /^\/api\/v3\/import\/[^/]+\/template\.csv(?:\?|$)/,
  // 統合 P3-3: 請求権受領(sublicense)は search-api 専用。read/CSV を含む。
  /^\/api\/sublicense(?:\/|\?|$)/,
  // 統合 P3-4: 分配構造マップ(receivable-map)と作品別名(aliases)read。
  /^\/api\/receivable-map(?:\/|\?|$)/,
  /^\/api\/works\/\d+\/aliases(?:\?|$)/,
];

// POST/PUT/PATCH でも READ(search-api)へ振るルート(D1: Search がマスター書込を所有)。
export const READ_PATHS_ON_POST: RegExp[] = [
  /^\/api\/contract-check(?:\/|$)/,
  // 全UIリニューアル A(ステップ1): 取引先 upsert (POST /api/master/vendors 完全一致)
  //   は worker へ移設済み(search-api 読取専用化)。worker が住所/口座 1:N + 数値正規化
  //   + contacts[] を含む同仕様を提供し、staging で永続化パリティを検証済み
  //   (verify-worker.sh: 住所/口座 primary ミラー確認)。既定で POST は worker(write)へ
  //   振られるため search-api への明示 pin を撤去。サブパス(/import-csv 等)は元々 worker。
  //   search-api 側の当該ルートは soak 後に撤去(ステップ2)。
  // 全UIリニューアル A(ステップ1): スタッフ役割変更 (PATCH
  //   /api/master/staff/:email/role) は worker へ移設済み(search-api 読取専用化)。
  //   worker が同仕様(app_role 更新 + staff_role_change 監査ログ)を提供し、staging
  //   で検証済み。既定で PATCH は worker(write)へ振られるため、ここでの search-api
  //   への明示 pin を撤去した。search-api 側の当該ルートは soak 後に撤去(ステップ2)。
  // 全UIリニューアル A(ステップ1): 条件明細リンク更新 (PUT /api/conditions/:id/links)
  //   と作品別名 write (POST /api/works/:id/aliases, DELETE /api/work-aliases/:id) は
  //   worker へ移設済み(staging 検証: 列/SQL 健全 + alias INSERT→DELETE round-trip)。
  //   既定で PUT/POST/DELETE は worker(write)へ振られるため search-api pin を撤去。
  //   閲覧 GET(/api/works/:id/aliases)は READ_PATHS_ON_GET により search-api(read)維持。
  //   search-api 側の当該 write ルートは soak 後に撤去(ステップ2)。
  // 統合 P3-3: 請求権受領(sublicense)の書込(deals/reports/receipts/import)は
  //   SSR ポータル専用(admin-ui 参照 0)。search-api に据え置き(別途評価)。
  /^\/api\/sublicense(?:\/|\?|$)/,
  // 統合 P3-5: 作品モデル(v3)の write(POST/PUT/import)は search-api 正規実装へ。
  /^\/api\/v3\//,
];

export type ApiTarget = "read" | "write";

/**
 * method + path(クエリ含んで良い)から転送先サービスを決める。
 * @param readsToWorker C1 フラグ: 明示リスト外の GET を worker(read superset)へ寄せる
 */
export function resolveApiTarget(
  method: string,
  path: string,
  readsToWorker: boolean
): ApiTarget {
  const m = method.toUpperCase();
  if (m === "GET") {
    if (WRITE_PATHS_ON_GET.some((re) => re.test(path))) return "write";
    if (READ_PATHS_ON_GET.some((re) => re.test(path))) return "read";
    return readsToWorker ? "write" : "read";
  }
  if (READ_PATHS_ON_POST.some((re) => re.test(path))) return "read";
  return "write";
}
