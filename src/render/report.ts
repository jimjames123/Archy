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
  :root { color-scheme: light dark; }
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#f4f6f8; color:#1e2a36; }
  header { padding:20px 24px; }
  h1 { font-size:18px; margin:0 0 2px; }
  .sub { color:#6b7b8a; font-size:13px; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap:16px; padding:0 24px; }
  @media (max-width: 820px) { .grid { grid-template-columns:1fr; } }
  .card { background:#fff; border:1px solid #e3e8ee; border-radius:12px; padding:8px; overflow-x:auto; }
  .card svg { width:100%; height:auto; display:block; }
  .issues { padding:16px 24px 32px; }
  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; gap:10px; align-items:baseline; padding:8px 10px; border-bottom:1px solid #eef2f6; font-size:13px; }
  .badge { color:#fff; min-width:20px; height:20px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
  .disc { font-weight:600; text-transform:capitalize; }
  .sev { text-transform:uppercase; font-size:11px; font-weight:700; letter-spacing:.03em; }
  .msg { color:#42525f; }
  .note { padding:0 24px 24px; color:#8a97a3; font-size:12px; max-width:70ch; }
</style></head>
<body>
  <header><h1>${esc(title)}</h1>
    <div class="sub">${conflicts} conflict(s), ${issues.length} issue(s) total — one shared model, two views.</div>
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
