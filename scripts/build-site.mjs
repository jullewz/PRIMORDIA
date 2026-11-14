#!/usr/bin/env node
// Assemble the static site (for GitHub Pages or any static host) into ./site.
// Run `npm run build` first, or use `npm run site` which does both.
import { cp, mkdir, rm, access } from "node:fs/promises";

try {
  await access("dist/src/ui/main.js");
} catch {
  console.error("dist/ is missing. Run `npm run build` first.");
  process.exit(1);
}
await rm("site", { recursive: true, force: true });
await mkdir("site/dist/src", { recursive: true });
await cp("index.html", "site/index.html");
await cp("styles.css", "site/styles.css");
for (const dir of ["core", "sim", "ui"]) {
  await cp(`dist/src/${dir}`, `site/dist/src/${dir}`, { recursive: true, filter: (src) => !src.endsWith(".map") });
}
console.log("site/ is ready: upload it to any static host.");
