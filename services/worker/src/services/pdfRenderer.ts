/**
 * pdfRenderer — HTML (Handlebars 出力) を PDF にレンダリングする小さな
 * ラッパー。
 *
 * なぜ puppeteer-core なのか:
 *   Cloud Run のコンテナ image には apt 経由で chromium を入れ、
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium を指定している。
 *   puppeteer 本体だと bundled Chromium を二重に落としてしまうため、
 *   軽量な puppeteer-core を使う。
 *
 * 制限:
 *   - 単発のブラウザ起動・終了。並行リクエストは同時にブラウザを
 *     立ち上げるが、Cloud Run は 1 リクエスト = 1 インスタンスの
 *     コンセプトに近いので問題は少ない。スループットが必要なら
 *     browser インスタンスをモジュールスコープで再利用する。
 */

import puppeteer, { type PaperFormat } from "puppeteer-core";

const EXECUTABLE_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

const DEFAULT_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage", // Cloud Run の /dev/shm が小さいことの回避
  "--disable-gpu",
  "--font-render-hinting=none",
  // 注意: --single-process / --no-zygote を足してはいけない。新しめの
  // Chromium は --single-process だと "Cannot use V8 Proxy resolver in
  // single process mode" で起動に失敗する (2026-07-06 の障害で確認)。
  // 新 Chromium は第1世代 Cloud Run (gVisor) 自体で起動不能のため、
  // 実行環境は cloudbuild-worker.yaml で gen2 に固定してある。
];

export interface RenderPdfOptions {
  format?: PaperFormat; // "A4" / "Letter" など (default: A4)
  landscape?: boolean;
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
  printBackground?: boolean; // CSS の背景色を PDF にも出すか (default: true)
}

/**
 * HTML 文字列を PDF Buffer に変換する。CSS の @page / @media print は
 * そのまま尊重される。Tailwind や inline-style 経由のレイアウトも
 * 通常の Chrome レンダリングなので、ほぼ画面通りに出る。
 */
export async function renderHtmlToPdf(
  html: string,
  options: RenderPdfOptions = {}
): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: EXECUTABLE_PATH,
    args: DEFAULT_ARGS,
  });
  try {
    const page = await browser.newPage();
    // base64 / data: スキームで画像を埋め込んでいる場合があるので、
    // ネットワークアイドル待ちは緩めに (= 'load' で十分)。
    await page.setContent(html, {
      waitUntil: "load",
      timeout: 30_000,
    });
    // emulate "print" CSS media query — 通常はこちらで適切な余白・改ページ
    await page.emulateMediaType("print");
    const pdfBuffer = await page.pdf({
      format: options.format || "A4",
      landscape: options.landscape || false,
      printBackground: options.printBackground !== false,
      margin: {
        top: options.marginTop || "12mm",
        bottom: options.marginBottom || "12mm",
        left: options.marginLeft || "12mm",
        right: options.marginRight || "12mm",
      },
    });
    // puppeteer-core は Uint8Array を返すので Buffer に変換
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close().catch(() => {
      /* swallow */
    });
  }
}
