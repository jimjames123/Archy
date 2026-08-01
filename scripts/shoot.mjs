/**
 * Drives the built editor in a real (headless) browser to verify the live
 * edit → re-validate loop and capture before/after screenshots. Not part of the
 * app; a harness for us. Run: node scripts/shoot.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const WEB = resolve("web");
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json", ".css": "text/css" };

const server = createServer((req, res) => {
  let p = join(WEB, decodeURIComponent((req.url || "/").split("?")[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}/index.html`;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1480, height: 820 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll("#canvas svg line").length > 0);

await page.screenshot({ path: "web/dist/shot-1-initial.png" });
console.log("initial:", await page.textContent("#status"));

// Locate the outer window-edge handle and drag it along the wall to widen it.
const drag = await page.evaluate(() => {
  const ed = window.archy;
  const svg = document.querySelector("#canvas svg");
  const r = svg.getBoundingClientRect();
  const edges = ed.handles.filter((h) => h.kind === "open-edge");
  const outer = edges.reduce((a, b) => (b.pos[0] > a.pos[0] ? b : a));
  const s = ed.vp.toScreen(outer.pos);
  return { x: r.left + s[0], y: r.top + s[1] };
});

await page.mouse.move(drag.x, drag.y);
await page.mouse.down();
await page.mouse.move(drag.x + 220, drag.y, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(120);

await page.screenshot({ path: "web/dist/shot-2-widened.png" });
console.log("after widening:", await page.textContent("#status"));

// Add a deep transfer beam to trigger the headroom cascade too.
await page.click("#add-beam");
await page.waitForTimeout(120);
await page.screenshot({ path: "web/dist/shot-3-beam.png" });
console.log("after beam:", await page.textContent("#status"));

// Reset, then drag a corner to reshape the room — exercises the coalesced drag
// path and confirms both views follow one model without the 3D rescaling.
await page.click("#reset");
await page.waitForTimeout(80);
const corner = await page.evaluate(() => {
  const ed = window.archy;
  const svg = document.querySelector("#canvas svg");
  const r = svg.getBoundingClientRect();
  const c = ed.handles.filter((h) => h.kind === "corner");
  const topRight = c.reduce((a, b) => (b.pos[0] - b.pos[1] > a.pos[0] - a.pos[1] ? b : a));
  const s = ed.vp.toScreen(topRight.pos);
  return { x: r.left + s[0], y: r.top + s[1] };
});
await page.mouse.move(corner.x, corner.y);
await page.mouse.down();
await page.mouse.move(corner.x - 90, corner.y + 70, { steps: 16 });
await page.mouse.up();
await page.waitForTimeout(120);
await page.screenshot({ path: "web/dist/shot-4-reshape.png" });
console.log("after reshape:", await page.textContent("#status"));

await browser.close();
server.close();
