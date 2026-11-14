#!/usr/bin/env node
// Capture README screenshots from the real app. Development only.
// Needs Playwright (`npm i -D playwright`) and a Chrome/Chromium binary:
//   CHROME=/usr/bin/google-chrome node scripts/screenshots.mjs
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(process.env.PLAYWRIGHT_PATH ?? "/opt/npm-tools/node_modules/playwright"));
}

const port = 5187;
const seed = process.env.SEED ?? "darwin";
const warp = process.env.WARP ?? "24000";
const server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));
await mkdir("docs/assets", { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://127.0.0.1:${port}/#seed=${seed}&preset=balanced&warp=${warp}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 600_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/assets/overview.png" });

  await page.click('[data-tab="species"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/assets/species.png" });

  await page.click('[data-tab="overview"]');
  await page.waitForTimeout(600);
  await page.click("#fame button:nth-child(2)"); // the creature with the most offspring
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "docs/assets/creature.png" });

  await page.click('[data-tab="chronicle"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/assets/chronicle.png" });
  console.log("wrote docs/assets/{overview,species,creature,chronicle}.png");
} finally {
  await browser.close();
  server.kill();
}
