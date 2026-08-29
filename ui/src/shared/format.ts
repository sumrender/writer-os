import type { Stats } from "@writer-os/benchmark/events";

/** Presentation-only formatting for the report and facts views. */

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** A Stats mean rendered as a percentage with its variance as ± points. */
export function statsPercent(stats: Stats): string {
  const spread = Math.sqrt(stats.variance) * 100;
  return `${(stats.mean * 100).toFixed(1)}% ±${spread.toFixed(1)}`;
}

export function elapsed(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}
