import type { ExtractionAxisReport, KindReport } from "./extraction-axis.js";

/**
 * Presentation of extraction-axis reports (docs/TESTING.md §9): everything a
 * run produces prints to terminal/CI — nothing is written to tracked paths.
 * Text for humans, JSON for machines; both derive from the same structure.
 */

const fixed3 = (value: number): string => value.toFixed(3);

function kindLine(kind: string, report: KindReport): string {
  return [
    `  ${kind.padEnd(14)}`,
    `precision ${fixed3(report.precision.mean)} ±${fixed3(report.precision.variance)}`,
    `recall ${fixed3(report.recall.mean)} ±${fixed3(report.recall.variance)}`,
    `f1 ${fixed3(report.f1.mean)} ±${fixed3(report.f1.variance)}`,
    `(tp ${fixed3(report.tp.mean)} fn ${fixed3(report.fn.mean)} fp ${fixed3(report.fp.mean)})`,
  ].join("  ");
}

export function formatTextReport(report: ExtractionAxisReport): string[] {
  const lines: string[] = [];
  lines.push(`extraction — ${report.book} (runs: ${report.runs})`);
  lines.push("  per-kind precision / recall / f1, mean ± variance:");
  for (const entry of report.kinds) {
    lines.push(kindLine(entry.kind, entry.report));
  }
  const globalPrecisionCheck = report.gates.checks.find((c) => c.gate === "global_precision");
  lines.push(
    `  global precision ${fixed3(report.globalPrecision.mean)} ±${fixed3(
      report.globalPrecision.variance,
    )} (floor ${fixed3(globalPrecisionCheck?.floor ?? 0)})`,
  );
  lines.push(
    [
      `  open-world sweep: swept ${fixed3(report.sweep.swept.mean)}/run,`,
      `${fixed3(report.sweep.unsupported.mean)} unsupported →`,
      `estimated fabrication rate ${fixed3(report.sweep.estimatedFabricationRate.mean)} ±${fixed3(
        report.sweep.estimatedFabricationRate.variance,
      )} (judge-mediated estimate, not an exact score)`,
    ].join(" "),
  );
  if (report.gates.passed) {
    lines.push("  gates: PASS");
  } else {
    lines.push("  gates: FAIL");
    for (const check of report.gates.checks) {
      if (!check.passed) {
        lines.push(`    - ${check.gate}: ${fixed3(check.value)} < floor ${fixed3(check.floor)}`);
      }
    }
  }
  return lines;
}

export function formatJsonReport(report: ExtractionAxisReport): string {
  return JSON.stringify(report, null, 2);
}
