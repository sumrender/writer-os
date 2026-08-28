import type { ExtractionAxisReport, KindReport } from "./extraction-axis.js";
import type { CheckerAxisReport } from "./checker-axis.js";
import type { GenerationAxisReport } from "./generation-axis.js";

/**
 * Presentation of axis reports (docs/TESTING.md §9): everything a run
 * produces prints to terminal/CI — nothing is written to tracked paths.
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

function checkerCaseLine(entry: CheckerAxisReport["cases"][number]): string {
  const outcome = entry.expected === "flag" ? "caught" : "false-positive";
  return `  ${entry.kind.padEnd(12)}${entry.caseId.padEnd(24)}expect ${entry.expected.padEnd(9)}${outcome} rate ${fixed3(
    entry.raisedRate.mean,
  )} ±${fixed3(entry.raisedRate.variance)}`;
}

export function formatCheckerTextReport(report: CheckerAxisReport): string[] {
  const lines: string[] = [];
  lines.push(`checker — ${report.book} (runs: ${report.runs})`);
  if (report.cases.length === 0) {
    lines.push("  no perturbation or control cases authored for this book");
  } else {
    lines.push("  per-case flag rate, mean ± variance:");
    for (const entry of report.cases) {
      lines.push(checkerCaseLine(entry));
      // Diagnose deviations in place: a missed perturbation or a flagged
      // control is only interpretable with the offending flag text visible.
      const missedPerturbation = entry.expected === "flag" && entry.raisedRate.mean < 1;
      const falsePositive = entry.expected === "no_flags" && entry.raisedRate.mean > 0;
      if (missedPerturbation || falsePositive) {
        if (entry.flagMessages.length === 0) {
          lines.push("      (deviation recorded without flag text)");
        }
        for (const message of entry.flagMessages.slice(0, 3)) {
          lines.push(`      flag: ${message}`);
        }
        if (entry.flagMessages.length > 3) {
          lines.push(`      … ${entry.flagMessages.length - 3} more distinct flag(s)`);
        }
      }
    }
  }
  lines.push(
    `  perturbation catch rate ${fixed3(report.perturbationCatchRate.mean)} ±${fixed3(
      report.perturbationCatchRate.variance,
    )} (must-flag)`,
  );
  lines.push(
    `  control false-positive rate ${fixed3(report.controlFalsePositiveRate.mean)} ±${fixed3(
      report.controlFalsePositiveRate.variance,
    )} (over-flagging risk)`,
  );
  lines.push(report.passed ? "  gates: PASS" : "  gates: FAIL");
  return lines;
}

export function formatCheckerJsonReport(report: CheckerAxisReport): string {
  return JSON.stringify(report, null, 2);
}

function generationChapterLine(entry: GenerationAxisReport["chapters"][number]): string {
  return [
    `  chapter ${entry.ordinal}`,
    `beat failure rate ${fixed3(entry.beatFailureRate.mean)} ±${fixed3(entry.beatFailureRate.variance)}`,
    `assembly failure rate ${fixed3(entry.assemblyFailureRate.mean)} ±${fixed3(entry.assemblyFailureRate.variance)}`,
    `factual flags/run ${fixed3(entry.factualFlags.mean)} ±${fixed3(entry.factualFlags.variance)}`,
    `pass rate ${fixed3(entry.verdict.mean)} ±${fixed3(entry.verdict.variance)}`,
  ].join("  ");
}

/** Failure evidence lines under a chapter whose runs were not all clean. */
function generationEvidenceLines(entry: GenerationAxisReport["chapters"][number]): string[] {
  const lines: string[] = [];
  for (const beat of entry.missedBeats.slice(0, 3)) {
    lines.push(`      missing beat: ${beat}`);
  }
  if (entry.missedBeats.length > 3) {
    lines.push(`      … ${entry.missedBeats.length - 3} more distinct missing beat(s)`);
  }
  for (const beat of entry.violatedBeats.slice(0, 3)) {
    lines.push(`      violated beat: ${beat}`);
  }
  if (entry.violatedBeats.length > 3) {
    lines.push(`      … ${entry.violatedBeats.length - 3} more distinct violated beat(s)`);
  }
  for (const flag of entry.flagMessages.slice(0, 3)) {
    lines.push(`      flag: ${flag}`);
  }
  if (entry.flagMessages.length > 3) {
    lines.push(`      … ${entry.flagMessages.length - 3} more distinct flag(s)`);
  }
  return lines;
}

export function formatGenerationTextReport(report: GenerationAxisReport): string[] {
  const lines: string[] = [];
  lines.push(`generation — ${report.book} (runs: ${report.runs})`);
  if (report.chapters.length === 0) {
    lines.push("  no beat chapters declared for this book");
  } else {
    lines.push("  per-chapter verdict and failure rates, mean ± variance:");
    for (const entry of report.chapters) {
      lines.push(generationChapterLine(entry));
      // Diagnose in place: a sub-1 pass rate is only interpretable with the
      // missed/violated beats and raised flags visible beneath it.
      if (entry.verdict.mean < 1) {
        lines.push(...generationEvidenceLines(entry));
      }
    }
  }
  lines.push(report.passed ? "  gates: PASS" : "  gates: FAIL");
  return lines;
}

export function formatGenerationJsonReport(report: GenerationAxisReport): string {
  return JSON.stringify(report, null, 2);
}
