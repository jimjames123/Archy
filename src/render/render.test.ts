/** Smoke tests: the renderers produce well-formed SVG and surface conflicts. */
import { describe, expect, it } from "vitest";
import { makeRoomPlan } from "../model/fixtures.js";
import { RulesEngine } from "../rules/engine.js";
import { loadPathRule } from "../rules/loadPath.js";
import { headroomRule } from "../rules/headroom.js";
import { renderPlanSVG } from "./plan2d.js";
import { renderIsoSVG } from "./iso.js";
import { renderReportHTML } from "./report.js";
import { fitViewport } from "./viewport.js";

function scenario() {
  const { model, ids } = makeRoomPlan();
  model.commit([
    { op: "updateElement", id: ids.window, patch: { width: 2400 } as never },
    {
      op: "addElement",
      element: {
        type: "beam",
        id: "beam-1",
        storeyId: ids.storey,
        provenance: { source: "user", confidence: 1 },
        version: 0,
        line: [
          [500, 2000],
          [4500, 2000],
        ],
        depth: 600,
      },
    },
  ]);
  const issues = new RulesEngine()
    .register(loadPathRule())
    .register(headroomRule())
    .evaluateAll(model);
  return { model, issues };
}

describe("plan renderer", () => {
  it("emits a valid svg with walls and a conflict overlay", () => {
    const { model, issues } = scenario();
    expect(issues.length).toBeGreaterThan(0);
    const svg = renderPlanSVG(model, issues, { title: "Plan" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("<line"); // walls
    expect(svg).toContain("#e5484d"); // conflict colour drawn onto the plan
    expect(svg).toContain("issue(s)"); // legend
  });

  it("escapes text so messages cannot break the svg", () => {
    const { model } = makeRoomPlan();
    const svg = renderPlanSVG(model, [
      {
        ruleId: "x",
        discipline: "architectural",
        severity: "warn",
        elements: [],
        message: 'bad <tag> & "quote"',
      },
    ]);
    expect(svg).toContain("bad &lt;tag&gt; &amp; &quot;quote&quot;");
  });
});

describe("iso renderer", () => {
  it("extrudes walls into a valid svg", () => {
    const { model, issues } = scenario();
    const svg = renderIsoSVG(model, issues);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<polygon"); // extruded wall faces
  });
});

describe("viewport", () => {
  it("toModel inverts toScreen (needed for dragging)", () => {
    const vp = fitViewport([
      [0, 0],
      [5000, 4000],
    ]);
    for (const p of [
      [0, 0],
      [2500, 2000],
      [5000, 4000],
    ] as [number, number][]) {
      const back = vp.toModel(vp.toScreen(p));
      expect(back[0]).toBeCloseTo(p[0], 6);
      expect(back[1]).toBeCloseTo(p[1], 6);
    }
  });
});

describe("report", () => {
  it("embeds both views and lists issues", () => {
    const { model, issues } = scenario();
    const html = renderReportHTML(model, issues, { title: "Demo" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Plan");
    expect(html).toContain("3D massing");
    expect(html).toContain("not a certified engineering");
  });
});
