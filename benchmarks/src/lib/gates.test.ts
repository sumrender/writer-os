import { describe, expect, it } from "vitest";
import { DEFAULT_GATES, evaluateGates, parseGateConfig } from "./gates.js";
import type { GateInputs } from "./gates.js";

describe("parseGateConfig", () => {
  it("falls back to lenient defaults for absent or empty input", () => {
    expect(parseGateConfig(undefined)).toEqual(DEFAULT_GATES);
    expect(parseGateConfig({})).toEqual(DEFAULT_GATES);
    expect(DEFAULT_GATES.globalPrecisionMin).toBe(0.5);
    expect(DEFAULT_GATES.recallMin).toEqual({});
  });

  it("parses a global precision floor and per-kind recall floors", () => {
    const config = parseGateConfig({
      global_precision_min: 0.9,
      recall_min: { character: 0.8, item: 0.5 },
    });
    expect(config.globalPrecisionMin).toBe(0.9);
    expect(config.recallMin).toEqual({ character: 0.8, item: 0.5 });
  });

  it("rejects malformed configs precisely", () => {
    expect(() => parseGateConfig("nope")).toThrow(/object/i);
    expect(() => parseGateConfig({ global_precision_min: "high" })).toThrow(/global_precision_min/);
    expect(() => parseGateConfig({ global_precision_min: 1.5 })).toThrow(/between 0 and 1/);
    expect(() => parseGateConfig({ recall_min: { wizard: 0.5 } })).toThrow(/wizard/);
    expect(() => parseGateConfig({ recall_min: { item: -1 } })).toThrow(/recall_min\.item/);
    expect(() => parseGateConfig({ mystery: true })).toThrow(/mystery/);
  });
});

describe("evaluateGates", () => {
  const inputs = (overrides: Partial<GateInputs>): GateInputs => ({
    kindsPresent: ["character", "item"],
    globalPrecision: 0.95,
    recallByKind: { character: 0.9, item: 0.7 },
    ...overrides,
  });

  it("passes when every floor holds (>= is passing)", () => {
    const evaluation = evaluateGates(
      { ...DEFAULT_GATES, recallMin: { character: 0.9 } },
      inputs({}),
    );
    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.map((c) => c.gate)).toContain("recall.character");
  });

  it("fails the run when the pooled precision drops below the floor", () => {
    const evaluation = evaluateGates(DEFAULT_GATES, inputs({ globalPrecision: 0.4 }));
    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.some((c) => !c.passed && c.gate === "global_precision")).toBe(true);
  });

  it("fails only the kinds whose recall misses their floor", () => {
    const config = { ...DEFAULT_GATES, recallMin: { character: 0.95, item: 0.3 } };
    const evaluation = evaluateGates(config, inputs({}));
    const failed = evaluation.checks.filter((c) => !c.passed).map((c) => c.gate);
    expect(failed).toEqual(["recall.character"]);
    expect(evaluation.passed).toBe(false);
  });

  it("ignores floors configured for kinds the assertion set does not cover", () => {
    const config = { ...DEFAULT_GATES, recallMin: { thread: 0.99 } };
    const evaluation = evaluateGates(config, inputs({}));
    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.every((c) => c.passed)).toBe(true);
  });
});
