import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DEFAULT_RUN_CONFIG,
  isLiveConfig,
  validateRunForm,
  type ConfigErrors,
} from "../shared/run-config.js";
import { AXES, ENABLED_AXES, JUDGES, PIPELINES, type AxisKind } from "../shared/enums.js";
import { getBooks, listRuns, startRun } from "../server/functions.js";
import { StatusBadge } from "../components/StatusBadge.js";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [books, runs] = await Promise.all([getBooks(), listRuns()]);
    return { books, runs };
  },
  component: BenchmarkForm,
});

type FieldName = "book" | "axis" | "runs" | "pipeline" | "judge" | "cache";
type FormFields = Record<FieldName, string>;

function initialFields(book: string): FormFields {
  return {
    book,
    axis: DEFAULT_RUN_CONFIG.axis,
    runs: String(DEFAULT_RUN_CONFIG.runs),
    pipeline: DEFAULT_RUN_CONFIG.pipeline,
    judge: DEFAULT_RUN_CONFIG.judge,
    cache: String(DEFAULT_RUN_CONFIG.cache),
  };
}

function BenchmarkForm() {
  const { books, runs } = Route.useLoaderData();
  const navigate = useNavigate();
  // Default to the offline-first mini-book fixture; fall back to the first
  // runnable book if it is somehow absent.
  const defaultBook =
    books.books.find((b) => b.id === DEFAULT_RUN_CONFIG.book && b.enabled) ??
    books.books.find((b) => b.enabled) ??
    books.books[0];
  const [fields, setFields] = useState<FormFields>(() => initialFields(defaultBook?.id ?? ""));
  const [errors, setErrors] = useState<ConfigErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const activeRun = runs.find((r) => r.status === "running") ?? null;
  const config = validateRunForm(fields).config;
  const live = config !== null && isLiveConfig(config);

  function setField(name: FieldName, value: string): void {
    setFields((prev) => ({ ...prev, [name]: value }));
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setServerError(null);
    const result = validateRunForm(fields);
    setErrors(result.errors);
    if (result.config === null) return;
    setSubmitting(true);
    try {
      const started = await startRun({ data: result.config });
      await navigate({ to: "/runs/$runId", params: { runId: started.id } });
    } catch (cause) {
      setServerError(cause instanceof Error ? cause.message : String(cause));
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="space-y-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6"
      >
        <Field label="Fixture book" error={errors.book}>
          <select
            className={inputClass(Boolean(errors.book))}
            value={fields.book}
            onChange={(e) => setField("book", e.target.value)}
          >
            {books.books.length === 0 && <option value="">No fixture books found</option>}
            {books.books.map((book) => (
              <option key={book.id} value={book.id} disabled={!book.enabled}>
                {book.title} ({book.chapters} chapters)
                {book.enabled ? "" : " — no assertion set yet"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Axis" error={errors.axis}>
          <div className="flex flex-wrap gap-2">
            {AXES.map((axis) => (
              <AxisOption
                key={axis}
                axis={axis}
                enabled={ENABLED_AXES.includes(axis)}
                selected={fields.axis === axis}
                onSelect={() => setField("axis", axis)}
              />
            ))}
          </div>
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Sequential runs" error={errors.runs}>
            <input
              type="number"
              min={1}
              step={1}
              className={inputClass(Boolean(errors.runs))}
              value={fields.runs}
              onChange={(e) => setField("runs", e.target.value)}
            />
          </Field>
          <Field label="Pipeline" error={errors.pipeline}>
            <select
              className={inputClass(Boolean(errors.pipeline))}
              value={fields.pipeline}
              onChange={(e) => setField("pipeline", e.target.value)}
            >
              {PIPELINES.map((p) => (
                <option key={p} value={p}>
                  {p === "fake" ? "fake (offline, deterministic)" : "live (Agnes)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Judge" error={errors.judge}>
            <select
              className={inputClass(Boolean(errors.judge))}
              value={fields.judge}
              onChange={(e) => setField("judge", e.target.value)}
            >
              {JUDGES.map((j) => (
                <option key={j} value={j}>
                  {j === "stub" ? "stub (offline, equivalence-only)" : "live (Agnes)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Response caching" error={errors.cache}>
            <select
              className={inputClass(Boolean(errors.cache))}
              value={fields.cache}
              onChange={(e) => setField("cache", e.target.value)}
            >
              <option value="true">on (reuse cached verdicts/responses)</option>
              <option value="false">off (every call hits the API fresh)</option>
            </select>
          </Field>
        </div>

        {live && (
          <div className="rounded-md border border-amber-700/60 bg-amber-950/40 p-3 text-sm text-amber-200">
            This run selects a live pipeline or judge — it will spend API quota.
            <div className="mt-1 text-amber-300/80">
              Agnes credentials:{" "}
              {books.agnesConfigured ? (
                <span className="font-medium text-emerald-300">configured</span>
              ) : (
                <span className="font-medium text-rose-300">
                  not configured (set AGNES_API_KEY in benchmarks/.env)
                </span>
              )}
            </div>
          </div>
        )}

        {serverError !== null && (
          <div className="rounded-md border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
            {serverError}
          </div>
        )}

        <button
          type="submit"
          disabled={activeRun !== null || submitting}
          className="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Start benchmark run"}
        </button>
        {activeRun !== null && (
          <p className="text-center text-sm text-zinc-400">
            A run is already active —{" "}
            <a className="text-emerald-400 underline" href={`/runs/${activeRun.id}`}>
              view it
            </a>
            .
          </p>
        )}
      </form>

      <HistoryPanel />
    </div>
  );
}

function HistoryPanel() {
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof listRuns>>>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const next = await listRuns();
      if (!cancelled) setRuns([...next]);
    };
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <aside className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Run history
      </h2>
      {runs.length === 0 ? (
        <p className="text-sm text-zinc-500">No runs yet.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li key={run.id}>
              <a
                href={`/runs/${run.id}`}
                className="block rounded-md border border-zinc-800 px-3 py-2 text-sm transition hover:border-zinc-600"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{run.config.book}</span>
                  <StatusBadge status={run.status} />
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {new Date(run.startedAt).toLocaleString()} · {run.config.pipeline}/
                  {run.config.judge} · {run.config.runs} run{run.config.runs > 1 ? "s" : ""}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function AxisOption({
  axis,
  enabled,
  selected,
  onSelect,
}: {
  axis: AxisKind;
  enabled: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!enabled}
      className={`rounded-md border px-3 py-1.5 text-sm capitalize transition ${
        selected
          ? "border-emerald-500 bg-emerald-600/20 text-emerald-200"
          : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
      } ${enabled ? "" : "cursor-not-allowed opacity-40"}`}
    >
      {axis}
      {!enabled && <span className="ml-1 text-xs text-zinc-500">(later)</span>}
    </button>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-300">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-400">{error}</span>}
    </label>
  );
}

function inputClass(invalid: boolean): string {
  return `w-full rounded-md border bg-zinc-950 px-3 py-2 text-sm outline-none focus:ring-1 ${
    invalid
      ? "border-rose-700 focus:ring-rose-600"
      : "border-zinc-700 focus:border-emerald-500 focus:ring-emerald-500"
  }`;
}
