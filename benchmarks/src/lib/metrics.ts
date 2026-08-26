import type { EntityKind } from "./bible.js";

/**
 * Grading arithmetic (docs/TESTING.md §6): per-kind precision/recall/F1 over
 * assertion outcomes, pooled global precision, and the run-protocol stats
 * (mean ± variance across repeated runs). Pure math — no I/O, no judging.
 */

/** Run-protocol default (docs/TESTING.md §9): shared by every axis. */
export const RUNS_PER_BOOK = 3;

export interface KindCounts {
  /** `must` assertions satisfied. */
  readonly tp: number;
  /** `must_not` assertions triggered — fabrications. */
  readonly fp: number;
  /** `must` assertions unsatisfied — omissions. */
  readonly fn: number;
  /** `must_not` assertions not triggered. */
  readonly tn: number;
}

export interface KindMetrics {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface Stats {
  readonly mean: number;
  readonly variance: number;
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

/**
 * precision = tp/(tp+fp). When nothing could have been fabricated
 * (tp+fp = 0): 0 if any must-assertion was missed (nothing right), else 1
 * (vacuously perfect). recall = tp/(tp+fn); with no must assertions it is 1
 * by convention — omissions are impossible.
 */
export function kindMetrics(counts: KindCounts): KindMetrics {
  const precisionDenominator = counts.tp + counts.fp;
  const precision =
    precisionDenominator === 0 ? (counts.fn > 0 ? 0 : 1) : ratio(counts.tp, precisionDenominator);
  const recall = counts.tp + counts.fn === 0 ? 1 : ratio(counts.tp, counts.tp + counts.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/** Pools tp/fp across kinds; same vacuous convention as kindMetrics. */
export function globalPrecision(kinds: readonly KindCounts[]): number {
  const tp = kinds.reduce((sum, k) => sum + k.tp, 0);
  const fp = kinds.reduce((sum, k) => sum + k.fp, 0);
  return tp + fp === 0 ? 1 : ratio(tp, tp + fp);
}

function requireNonEmpty(values: readonly number[], what: string): void {
  if (values.length === 0) {
    throw new Error(`${what} requires at least one observation`);
  }
}

export function mean(values: readonly number[]): number {
  requireNonEmpty(values, "mean");
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Population variance (mean squared deviation); one observation → 0. */
export function populationVariance(values: readonly number[]): number {
  requireNonEmpty(values, "populationVariance");
  const mu = mean(values);
  return mean(values.map((v) => (v - mu) ** 2));
}

export function statsOf(values: readonly number[]): Stats {
  requireNonEmpty(values, "statsOf");
  return { mean: mean(values), variance: populationVariance(values) };
}

