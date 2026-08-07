/**
 * Drives the built space planner in headless Chromium (real pointer drags) to
 * verify the room move / attach / resize loop and capture screenshots.
 * Run: node scripts/shoot.mjs
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
  if (!existsSync(p)) return res.writeHead(404).end("not found");
  res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1480, height: 820 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll("#canvas svg line").length > 0);

const roomCenter = (id) =>
  page.evaluate((rid) => {
    const ed = window.archy;
    const r = ed.rooms.find((x) => x.id === rid);
    const s = ed.vp.toScreen([r.x + r.w / 2, r.y + r.h / 2]);
    const rect = document.querySelector("#canvas svg").getBoundingClientRect();
    return { x: rect.left + s[0], y: rect.top + s[1], scale: ed.vp.scale };
  }, id);

async function dragBy(from, dxPx, dyPx) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dxPx, from.y + dyPx, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

await page.screenshot({ path: "web/dist/shot-1-initial.png" });
console.log("initial:", await page.textContent("#status"));

// Drag the kitchen left, onto the living room → overlap conflict.
let k = await roomCenter("room-kitchen");
await dragBy(k, -2200 * k.scale, 0);
await page.screenshot({ path: "web/dist/shot-2-overlap.png" });
console.log("overlapped:", await page.textContent("#status"));

// Drag it back right → snaps flush against the living room, conflict clears.
k = await roomCenter("room-kitchen");
await dragBy(k, 2600 * k.scale, 0);
await page.screenshot({ path: "web/dist/shot-3-attached.png" });
console.log("re-attached:", await page.textContent("#status"));

// Widen a room's window past the lintel span → structural load-path conflict.
const win = await page.evaluate(() => {
  const ed = window.archy;
  const h = ed.handles.find((x) => x.kind === "window" && x.roomId === "room-living");
  const s = ed.vp.toScreen(h.pos);
  const rect = document.querySelector("#canvas svg").getBoundingClientRect();
  return { x: rect.left + s[0], y: rect.top + s[1] };
});
await dragBy(win, 120, 0);
await page.screenshot({ path: "web/dist/shot-4-window.png" });
console.log("widened window:", await page.textContent("#status"));

// Generate a fresh layout from site inputs (44 x 32 ft, 4 rooms).
await page.fill("#in-w", "44");
await page.fill("#in-d", "32");
await page.fill("#in-rooms", "4");
await page.click("#generate");
await page.waitForTimeout(150);
await page.screenshot({ path: "web/dist/shot-5-generated.png" });
console.log("generated:", await page.textContent("#status"), "|", await page.textContent("#gen-note"));

await browser.close();
server.close();
