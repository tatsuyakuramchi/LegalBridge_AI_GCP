// C2 batch 3b: byte-exact 抽出。form-context(710行)/ history ハンドラを
// services/api/server.ts から**転記せずに**取り出し、worker 用の登録モジュール
// services/worker/src/routes/formReadRoutes.ts を生成する。
//
// 依存: query, backlogService(getIssue / extractCustomFields)。worker は両方保有。
// 生成物は手編集しない。再生成は `node scripts/extract-form-routes.mjs`。

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcFile = path.join(root, "services/api/server.ts");
const outFile = path.join(root, "services/worker/src/routes/formReadRoutes.ts");

const lines = readFileSync(srcFile, "utf8").split("\n");

function findLine(re, from = 0) {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

const fcStart = findLine(/app\.get\(\s*"\/api\/backlog\/issues\/:key\/form-context"/);
const histStart = findLine(/app\.get\(\s*"\/api\/backlog\/issues\/:key\/history"/, fcStart + 1);
// history の後の最初の app.METHOD ルートで history ブロックを区切る
const afterHist = findLine(/^\s{2}app\.(get|post|patch|put|delete)\(/, histStart + 1);
if (fcStart < 0 || histStart < 0 || afterHist < 0) {
  throw new Error(`boundary not found: fc=${fcStart} hist=${histStart} after=${afterHist}`);
}

function block(start, endExclusive) {
  // [start, endExclusive) の中で、ハンドラ本体の閉じ `  });` の最後の出現までを切り出す
  // (閉じ括弧の後に続くコメント行を含めない)。
  let closeIdx = -1;
  for (let i = endExclusive - 1; i >= start; i--) {
    if (/^\s{2}\}\);\s*$/.test(lines[i])) { closeIdx = i; break; }
  }
  if (closeIdx < 0) throw new Error(`closing '  });' not found in [${start},${endExclusive})`);
  return lines.slice(start, closeIdx + 1).join("\n");
}

const formBlock = block(fcStart, histStart);
const histBlock = block(histStart, afterHist);

// 外部参照の簡易チェック(query/backlogService/標準以外の怪しい呼び出し)
const combined = formBlock + "\n" + histBlock;
const calls = [...combined.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map((m) => m[1]);
const allowed = new Set([
  "query", "if", "for", "while", "String", "Number", "Boolean", "Array", "Object", "JSON",
  "map", "filter", "find", "push", "join", "split", "trim", "test", "match", "replace",
  "includes", "startsWith", "endsWith", "toString", "parseInt", "parseFloat", "isNaN",
  "Set", "Map", "Date", "forEach", "some", "every", "slice", "keys", "values", "entries",
  "min", "max", "floor", "ceil", "round", "abs", "json", "status", "send", "setHeader",
  "warn", "error", "log", "toLocaleDateString", "toISOString", "toFixed", "toLowerCase",
  "toUpperCase", "getTime", "NumberFormat", "format", "get", "has", "catch", "then",
  "padStart", "padEnd", "concat", "sort", "reduce", "from", "isArray", "stringify", "parse",
]);
const suspicious = [...new Set(calls)].filter((c) => !allowed.has(c) && c !== "backlogService");
// backlogService.method() は backlogService が前置されるので calls には method 名が入る
const methodOnBacklog = ["getIssue", "extractCustomFields", "getIssues", "getStatuses", "getIssueTypes", "getCustomFields", "getCategories"];
const reallySuspicious = suspicious.filter((c) => !methodOnBacklog.includes(c));

const header = `// AUTO-GENERATED from services/api/server.ts by scripts/extract-form-routes.mjs.
// Do not edit. C2 batch 3b: backlog form-context / history の byte-exact 移植。
// 依存: query, backlogService(getIssue / extractCustomFields)。
import type { Express } from "express";

export function registerFormReadRoutes(
  app: Express,
  deps: { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>; backlogService: any }
): void {
  const { query, backlogService } = deps;

`;

writeFileSync(outFile, header + formBlock + "\n\n" + histBlock + "\n}\n", "utf8");

console.log(`form-context: lines ${fcStart + 1}-${histStart} (${histStart - fcStart} lines)`);
console.log(`history:      lines ${histStart + 1}-${afterHist} (${afterHist - histStart} lines)`);
console.log(`wrote ${outFile}`);
if (reallySuspicious.length) {
  console.log("⚠️ 想定外の外部参照(要確認):", reallySuspicious.join(", "));
} else {
  console.log("✓ 外部参照は query / backlogService / 標準のみ");
}
