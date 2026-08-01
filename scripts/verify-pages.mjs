/** Serves docs/ like GitHub Pages and confirms the minified build renders. */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const DOCS = resolve("docs");
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer((req, res) => {
  let p = join(DOCS, decodeURIComponent((req.url || "/").split("?")[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) return res.writeHead(404).end("nf");
  res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1480, height: 820 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll("#canvas svg line").length > 0);
const walls = await page.$$eval("#canvas svg line", (ls) => ls.length);
const has3d = await page.$$eval("#view3d svg polygon", (p) => p.length);
const status = await page.textContent("#status");
await page.screenshot({ path: "docs/preview.png" });
await browser.close();
server.close();

console.log(`walls=${walls} 3d-faces=${has3d} status="${status}" errors=${errors.length}`);
if (errors.length || walls === 0 || has3d === 0) {
  console.error("FAILED", errors);
  process.exit(1);
}
console.log("OK — docs/ build renders");
