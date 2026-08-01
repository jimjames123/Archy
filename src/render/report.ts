/**
 * Combines the 2D plan, the 3D view, and the coordination issue list into a
 * single self-contained HTML page — the human-facing output of a validation
 * pass. Both drawings are inline SVG from the same model.
 */
import type { BuildingModel } from "../model/graph.js";
import type { Issue } from "../rules/engine.js";
import { esc, SEVERITY_COLOR } from "./svg.js";
import { renderPlanSVG } from "./plan2d.js";
import { renderIsoSVG } from "./iso.js";

export function renderReportHTML(
  model: BuildingModel,
  issues: Issue[],
  opts: { title?: string } = {},
): string {
  const title = opts.title ?? "Archy — coordinated plan";
  const plan = renderPlanSVG(model, issues, { title: "Plan" });
  const iso = renderIsoSVG(model, issues, { title: "3D massing" });
  const conflicts = issues.filter((i) => i.severity === "conflict").length;

  const rows = issues
    .map((issue, i) => {
      const col = SEVERITY_COLOR[issue.severity];
      return `<li><span class="badge" style="background:${col}">${i + 1}</span>
        <span class="disc">${esc(issue.discipline)}</span>
        <span class="sev" style="color:${col}">${esc(issue.severity)}</span>
        <span class="msg">${esc(issue.message)}</span></li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  :root {
    --paper:#f4f1ea; --card:#fffefb; --ink:#1b1a17; --ink-2:#57544d; --ink-3:#8b877c;
    --line:#e7e3d8; --accent:#b0542f; --ok:#3e7d52;
    --serif: ui-serif, Georgia, "Times New Roman", serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background:var(--paper); color:var(--ink); -webkit-font-smoothing:antialiased; }
  header { padding:24px 28px 8px; }
  h1 { font-family:var(--serif); font-weight:500; font-size:24px; letter-spacing:-.01em; margin:0 0 4px; }
  .sub { color:var(--ink-3); font-size:13px; font-family:var(--mono); letter-spacing:.02em; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap:18px; padding:16px 28px 0; }
  @media (max-width: 820px) { .grid { grid-template-columns:1fr; } }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:10px; overflow-x:auto; box-shadow:0 1px 2px rgba(27,26,23,.03); }
  .card svg { width:100%; height:auto; display:block; }
  .issues { padding:18px 28px 8px; }
  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; gap:11px; align-items:baseline; padding:10px 6px; border-bottom:1px solid var(--line); font-size:13px; line-height:1.45; }
  li:last-child { border-bottom:none; }
  .badge { color:#fff; min-width:20px; height:20px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
  .disc { font-weight:600; text-transform:capitalize; }
  .sev { text-transform:uppercase; font-size:11px; font-weight:700; letter-spacing:.04em; font-family:var(--mono); }
  .msg { color:var(--ink-2); }
  .note { padding:8px 28px 28px; color:var(--ink-3); font-size:11px; line-height:1.5; max-width:74ch; }
</style></head>
<body>
  <header><h1>${esc(title)}</h1>
    <div class="sub">${conflicts} conflict(s) · ${issues.length} issue(s) total — one shared model, two views.</div>
  </header>
  <div class="grid">
    <div class="card">${plan}</div>
    <div class="card">${iso}</div>
  </div>
  <div class="issues"><ul>${rows || "<li>No issues detected.</li>"}</ul></div>
  <p class="note">Design assistance against configurable baselines — not a certified engineering
  or code review. Structural flags indicate a member is required and must be sized by a licensed engineer.</p>
</body></html>`;
}
