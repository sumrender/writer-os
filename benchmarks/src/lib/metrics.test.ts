import { describe, expect, it } from "vitest";
import {
  globalPrecision,
  kindMetrics,
  mean,
  populationVariance,
  statsOf,
  type KindCounts,
} from "./metrics.js";

const counts = (tp: number, fp: number, fn: number, tn = 0): KindCounts => ({ tp, fp, fn, tn });

describe("kindMetrics", () => {
  it("scores a fully correct kind as 1/1/1", () => {
    const m = kindMetrics(counts(2, 0, 0));
    expect(m).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it("counts triggered must_not probes against precision only", () => {
    const m = kindMetrics(counts(3, 1, 1));
    expect(m.precision).toBeCloseTo(0.75);
    expect(m.recall).toBeCloseTo(0.75);
    expect(m.f1).toBeCloseTo(0.75);
  });

  it("treats omissions as zero precision when nothing was right", () => {
    const m = kindMetrics(counts(0, 0, 2));
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });

  it("gives a fabrication-only kind precision 0 but recall 1 by convention", () => {
    const m = kindMetrics(counts(0, 2, 0));
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(0);
  });

  it("scores an assertion-free-but-present kind vacuously perfect", () => {
    const m = kindMetrics(counts(0, 0, 0, 4));
    expect(m).toEqual({ precision: 1, recall: 1, f1: 1 });
  });
});

describe("globalPrecision", () => {
  it("pools true positives and fabrications across kinds", () => {
    expect(globalPrecision([counts(2, 0, 0), counts(3, 1, 0)])).toBeCloseTo(5 / 6);
  });

  it("is 1 when no assertion could have fabricated anything", () => {
    expect(globalPrecision([counts(2, 0, 0), counts(0, 0, 0, 5)])).toBe(1);
  });
});

describe("mean / populationVariance / statsOf", () => {
  it("computes the arithmetic mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it("computes population variance about the mean", () => {
    expect(populationVariance([1, 2, 3, 4])).toBeCloseTo(1.25);
  });

  it("gives a single observation zero variance and refuses empties", () => {
    expect(statsOf([7])).toEqual({ mean: 7, variance: 0 });
    expect(() => statsOf([])).toThrow(/at least one/i);
    expect(() => mean([])).toThrow(/at least one/i);
    expect(() => populationVariance([])).toThrow(/at least one/i);
  });
});
