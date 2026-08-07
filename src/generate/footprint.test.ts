import { describe, expect, it } from "vitest";
import { generateFootprint, type SiteInput } from "./footprint.js";
import { RulesEngine } from "../rules/engine.js";
import { loadPathRule } from "../rules/loadPath.js";
import { supportBeneathRule } from "../rules/supportBeneath.js";
import { headroomRule } from "../rules/headroom.js";
import { egressRule } from "../rules/egress.js";
import { doorClearanceRule } from "../rules/doorClearance.js";

const engine = new RulesEngine()
  .register(loadPathRule())
  .register(supportBeneathRule())
  .register(headroomRule())
  .register(egressRule())
  .register(doorClearanceRule());

const base: SiteInput = {
  land: { width: 10000, depth: 8000 },
  setbacks: { front: 1500, rear: 1500, left: 1200, right: 1200 },
  rooms: 3,
  frontFaces: "S",
};

describe("generateFootprint", () => {
  it("fits the footprint inside the buildable envelope", () => {
    const { report } = generateFootprint(base);
    expect(report.footprint.widthM).toBe(7.6); // 10 - 1.2 - 1.2
    expect(report.footprint.depthM).toBe(5); // 8 - 1.5 - 1.5
    expect(report.rooms).toHaveLength(3);
    // Room areas sum to the footprint area.
    const sum = report.rooms.reduce((a, r) => a + r.areaM2, 0);
    expect(Math.abs(sum - report.footprintAreaM2)).toBeLessThan(0.2);
    expect(report.coverage).toBeGreaterThan(0);
    expect(report.coverage).toBeLessThan(1);
  });

  it("produces a fully coordinated starter (no conflicts)", () => {
    for (const rooms of [1, 2, 3, 4, 5]) {
      const { model } = generateFootprint({ ...base, rooms });
      const conflicts = engine.evaluateAll(model).filter((i) => i.severity === "conflict");
      expect(conflicts, `rooms=${rooms}`).toEqual([]);
    }
  });

  it("marks every generated element as a proposal, not fixed", () => {
    const { model } = generateFootprint(base);
    for (const el of model.allElements()) {
      expect(el.provenance.source).toBe("generated");
      expect(el.provenance.confidence).toBeLessThan(1);
    }
  });

  it("rejects setbacks that leave no buildable envelope", () => {
    expect(() =>
      generateFootprint({ ...base, setbacks: { front: 4000, rear: 4000, left: 100, right: 100 } }),
    ).toThrow(/buildable envelope/);
  });
});
