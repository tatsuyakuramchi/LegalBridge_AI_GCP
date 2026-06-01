/**
 * pdfRenderer — HTML (Handlebars 出力) を PDF にレンダリングする小さな
 * ラッパー。
 *
 * canonical: services/worker/src/services/pdfRenderer.ts の忠実コピー。
 *   B5b で search-api がプレビュー PDF をローカル生成(worker proxy 撤去)
 *   するため、worker と同一実装・同一オプションを持たせて出力を一致させる。
 *   worker 側を変更したら本ファイルも追従させること。
 *
 * なぜ puppeteer-core なのか:
 *   Cloud Run のコンテナ image には apt 経由で chromium を入れ、
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium を指定している。
 *   puppeteer 本体だと bundled Chromium を二重に落としてしまうため、
 *   軽量な puppeteer-core を使う。
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
 * そのまま尊重される。
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
    await page.setContent(html, {
      waitUntil: "load",
      timeout: 30_000,
    });
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
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close().catch(() => {
      /* swallow */
    });
  }
}
