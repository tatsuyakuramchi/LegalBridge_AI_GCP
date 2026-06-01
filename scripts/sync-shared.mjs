// Sync the canonical shared rendering module into each service's lib dir so it
// lives inside that service's Docker build context. Each service imports its
// local copy (./lib/shared-rendering.mjs). The COPIES are generated — do not
// edit them; edit shared/rendering/render.mjs and re-run this script.
//
//   node scripts/sync-shared.mjs
//
// (Repo convention: like extract-baseline.mjs / seed-templates.mjs, a committed
//  artifact generated from a single canonical source.)

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = path.join(root, "shared/rendering/render.mjs");
const targets = [
  "services/worker/src/lib/shared-rendering.mjs",
  "services/api/src/lib/shared-rendering.mjs",
];

const src = readFileSync(canonical, "utf8");
const banner =
  "// AUTO-SYNCED from shared/rendering/render.mjs by scripts/sync-shared.mjs.\n" +
  "// Do not edit here — edit the canonical source and re-run the sync.\n\n";

for (const rel of targets) {
  writeFileSync(path.join(root, rel), banner + src, "utf8");
  console.log(`synced -> ${rel}`);
}
