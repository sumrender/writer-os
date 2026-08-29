import type {
  ExtractionAxisReport,
  ExtractionEvidenceLine,
} from "@writer-os/benchmark/events";
import { percent, statsPercent } from "../shared/format.js";

/**
 * The grading report view (issue #11 stories 20–23): per-kind precision /
 * recall / F1, gate verdicts with their floors and measured values, the
 * open-world sweep's estimated Fabrication rate, and the Omission /
 * Fabrication evidence lines for failing kinds.
 */

export function ReportView({
  report,
  evidence,
}: {
  report: ExtractionAxisReport;
  evidence: readonly ExtractionEvidenceLine[];
}) {
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-zinc-400">
            <tr>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 font-medium">Precision</th>
              <th className="px-4 py-2 font-medium">Recall</th>
              <th className="px-4 py-2 font-medium">F1</th>
              <th className="px-4 py-2 font-medium">TP / FP / FN</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {report.kinds.map(({ kind, report: r }) => (
              <tr key={kind} className="text-zinc-200">
                <td className="px-4 py-2 font-medium capitalize">{kind}</td>
                <td className="px-4 py-2">{statsPercent(r.precision)}</td>
                <td className="px-4 py-2">{statsPercent(r.recall)}</td>
                <td className="px-4 py-2">{statsPercent(r.f1)}</td>
                <td className="px-4 py-2 text-zinc-400">
                  {r.tp.mean.toFixed(1)} / {r.fp.mean.toFixed(1)} / {r.fn.mean.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-zinc-200">
            Gate verdicts
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                report.gates.passed
                  ? "bg-emerald-900/60 text-emerald-200"
                  : "bg-rose-900/60 text-rose-200"
              }`}
            >
              {report.gates.passed ? "PASS" : "FAIL"}
            </span>
          </h3>
          <ul className="space-y-2 text-sm">
            {report.gates.checks.map((check) => (
              <li key={check.gate} className="flex items-center justify-between">
                <span className="text-zinc-300">{check.gate}</span>
                <span className="text-zinc-500">
                  {percent(check.value)} / floor {percent(check.floor)}{" "}
                  <span className={check.passed ? "text-emerald-400" : "text-rose-400"}>
                    {check.passed ? "✓" : "✗"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">Open-world sweep</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">Facts swept</dt>
              <dd className="text-zinc-200">{report.sweep.swept.mean.toFixed(1)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Unsupported</dt>
              <dd className="text-zinc-200">{report.sweep.unsupported.mean.toFixed(1)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Est. Fabrication rate</dt>
              <dd className="font-medium text-zinc-100">
                {statsPercent(report.sweep.estimatedFabricationRate)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Global precision</dt>
              <dd className="text-zinc-200">{statsPercent(report.globalPrecision)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {evidence.length > 0 && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">
            Evidence ({evidence.length})
          </h3>
          <ul className="space-y-1 text-sm">
            {evidence.map((line, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-zinc-300">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    line.verdict === "omission"
                      ? "bg-amber-900/50 text-amber-200"
                      : "bg-rose-900/50 text-rose-200"
                  }`}
                >
                  {line.verdict}
                </span>
                <span className="capitalize text-zinc-400">{line.kind}</span>
                <span className="font-mono text-xs text-zinc-500">{line.assertionId}</span>
                <span className="text-zinc-600">
                  run {line.runIndex} · graded @ ch{line.gradedAtOrdinal}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
