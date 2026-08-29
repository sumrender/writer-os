import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type {
  BenchmarkEvent,
  StoryFacts,
  ExtractionAxisReport,
  ExtractionEvidenceLine,
  ExtractionSnapshot,
} from "@writer-os/benchmark/events";
import { cancelRun, getRun } from "../server/functions.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { StoryFacts as StoryFactsViewer } from "../components/StoryFacts.js";
import { ReportView } from "../components/ReportView.js";
import { elapsed } from "../shared/format.js";

export const Route = createFileRoute("/runs/$runId")({
  loader: async ({ params: { runId } }) => {
    const view = await getRun({ data: { id: runId, since: 0 } });
    return { view };
  },
  component: RunDetail,
});

interface ChapterRow {
  readonly runIndex: number;
  readonly ordinal: number;
  readonly elapsedMs: number;
  readonly canonEntries: number;
}

interface RunViewModel {
  readonly totalChapters: number | null;
  readonly runs: number | null;
  readonly chapters: ChapterRow[];
  readonly liveFacts: StoryFacts | null;
  readonly report: ExtractionAxisReport | null;
  readonly finalFacts: StoryFacts | null;
  readonly snapshots: readonly ExtractionSnapshot[];
  readonly evidence: readonly ExtractionEvidenceLine[];
  readonly failure: { exitCode: number; message: string } | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function reduceEvents(events: readonly BenchmarkEvent[]): RunViewModel {
  const model: Mutable<RunViewModel> = {
    totalChapters: null,
    runs: null,
    chapters: [],
    liveFacts: null,
    report: null,
    finalFacts: null,
    snapshots: [],
    evidence: [],
    failure: null,
  };
  for (const event of events) {
    switch (event.type) {
      case "run.started":
        model.totalChapters = event.totalChapters;
        model.runs = event.runs;
        break;
      case "chapter.completed":
        model.chapters.push({
          runIndex: event.runIndex,
          ordinal: event.ordinal,
          elapsedMs: event.elapsedMs,
          canonEntries: event.canonEntries,
        });
        model.liveFacts = event.facts;
        break;
      case "run.completed":
        model.report = event.report;
        model.finalFacts = event.facts;
        model.snapshots = event.snapshots;
        model.evidence = event.evidence;
        break;
      case "run.failed":
        model.failure = { exitCode: event.exitCode, message: event.message };
        break;
      default:
        break;
    }
  }
  return model;
}

function RunDetail() {
  const { runId } = Route.useParams();
  const initial = Route.useLoaderData();
  const missing = initial.view === null;
  const [status, setStatus] = useState(initial.view?.status ?? "failed");
  const [exitCode, setExitCode] = useState<number | null>(initial.view?.exitCode ?? null);
  const [events, setEvents] = useState<BenchmarkEvent[]>([...(initial.view?.events ?? [])]);
  const [stderr, setStderr] = useState<string[]>([...(initial.view?.stderr ?? [])]);
  const [since, setSince] = useState(initial.view?.nextIndex ?? 0);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (missing || status !== "running") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const view = await getRun({ data: { id: runId, since } });
        if (cancelled) return;
        // A vanished run (e.g. dropped from disk on restart) must not poll forever.
        if (view === null) {
          setStatus("failed");
          return;
        }
        if (view.events.length > 0) setEvents((prev) => [...prev, ...view.events]);
        setStderr([...view.stderr]);
        setSince(view.nextIndex);
        setStatus(view.status);
        setExitCode(view.exitCode);
      } catch {
        // Transient poll failure: keep the run open and retry next tick.
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [missing, status, since, runId]);

  const model = useMemo(() => reduceEvents(events), [events]);

  async function onCancel(): Promise<void> {
    setCancelling(true);
    try {
      await cancelRun({ data: { id: runId } });
    } finally {
      setCancelling(false);
    }
  }

  if (missing) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-center">
        <p className="text-sm text-zinc-300">Run "{runId}" was not found.</p>
        <Link to="/" className="mt-2 inline-block text-sm text-emerald-400 hover:underline">
          ← back to all runs
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← all runs
          </Link>
          <h2 className="mt-1 text-lg font-semibold capitalize">
            {initial.view?.config.book ?? "run"} · {initial.view?.config.axis ?? "extraction"}
          </h2>
          <p className="text-sm text-zinc-500">
            {initial.view?.config.pipeline}/{initial.view?.config.judge} ·{" "}
            {initial.view?.config.runs} run{initial.view?.config.runs !== 1 ? "s" : ""} · cache{" "}
            {initial.view?.config.cache ? "on" : "off"} · {initial.view?.id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          {status === "running" && (
            <button
              type="button"
              onClick={() => void onCancel()}
              disabled={cancelling}
              className="rounded-md border border-rose-700 px-3 py-1.5 text-sm text-rose-200 transition hover:bg-rose-950/50 disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel run"}
            </button>
          )}
        </div>
      </div>

      <Progress model={model} status={status} exitCode={exitCode} />

      {model.failure !== null && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
          <span className="font-semibold">Run failed (exit {model.failure.exitCode}):</span>{" "}
          {model.failure.message}
        </div>
      )}

      {model.report !== null && <ReportView report={model.report} evidence={model.evidence} />}

      <FactsSection model={model} />

      <EventLog events={events} stderr={stderr} />
    </div>
  );
}

function Progress({
  model,
  status,
  exitCode,
}: {
  model: RunViewModel;
  status: string;
  exitCode: number | null;
}) {
  const total = model.totalChapters !== null && model.runs !== null
    ? model.totalChapters * model.runs
    : null;
  const done = model.chapters.length;
  const pct = total === null ? 0 : Math.round((done / total) * 100);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold text-zinc-200">
          Progress {total !== null ? `${done} / ${total}` : done} chapters
        </span>
        {exitCode !== null && status !== "running" && (
          <span className="text-zinc-500">exit {exitCode}</span>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full transition-all ${
            status === "failed" ? "bg-rose-500" : status === "cancelled" ? "bg-zinc-500" : "bg-emerald-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {model.chapters.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-1 pr-4 font-medium">Run</th>
                <th className="py-1 pr-4 font-medium">Chapter</th>
                <th className="py-1 pr-4 font-medium">Time</th>
                <th className="py-1 font-medium">Canon entries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              {model.chapters.map((c, i) => (
                <tr key={i}>
                  <td className="py-1 pr-4">{c.runIndex}</td>
                  <td className="py-1 pr-4">{c.ordinal}</td>
                  <td className="py-1 pr-4">{elapsed(c.elapsedMs)}</td>
                  <td className="py-1">{c.canonEntries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FactsSection({ model }: { model: RunViewModel }) {
  const options = useMemo(() => {
    const list: Array<{ key: string; label: string; facts: StoryFacts }> = [];
    for (const snapshot of model.snapshots) {
      list.push({
        key: `snap-${snapshot.afterOrdinal}`,
        label: `as of chapter ${snapshot.afterOrdinal}`,
        facts: snapshot.facts,
      });
    }
    if (model.snapshots.length === 0 && model.liveFacts !== null) {
      const last = model.chapters[model.chapters.length - 1];
      list.push({
        key: "live",
        label: last ? `live · after chapter ${last.ordinal}` : "live",
        facts: model.liveFacts,
      });
    }
    return list;
  }, [model]);

  const [selected, setSelected] = useState<string | null>(null);
  const activeKey = selected ?? options[options.length - 1]?.key ?? null;
  const active = options.find((o) => o.key === activeKey) ?? null;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-200">Story Facts</h3>
        {options.length > 1 && (
          <select
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
            value={activeKey ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {active === null ? (
        <p className="text-sm text-zinc-500">
          {model.report === null ? "Waiting for the first chapter…" : "No Story Facts produced."}
        </p>
      ) : (
        <StoryFactsViewer facts={active.facts} />
      )}
    </section>
  );
}

function EventLog({ events, stderr }: { events: BenchmarkEvent[]; stderr: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-200"
      >
        Raw event log ({events.length} events)
        <span className="text-zinc-500">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="max-h-96 space-y-3 overflow-auto px-4 pb-4">
          <pre className="whitespace-pre-wrap break-all rounded bg-zinc-950 p-3 text-xs text-zinc-300">
            {events.map((e) => JSON.stringify(e)).join("\n") || "(no events)"}
          </pre>
          {stderr.length > 0 && (
            <pre className="whitespace-pre-wrap break-all rounded bg-zinc-950 p-3 text-xs text-amber-300/80">
              {stderr.join("\n")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
