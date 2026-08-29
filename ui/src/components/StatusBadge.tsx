import type { RunStatus } from "../server/run-manager.js";

const TONE: Record<RunStatus, string> = {
  running: "bg-sky-900/50 text-sky-200 border-sky-700",
  completed: "bg-emerald-900/50 text-emerald-200 border-emerald-700",
  failed: "bg-rose-900/50 text-rose-200 border-rose-700",
  cancelled: "bg-zinc-800 text-zinc-300 border-zinc-700",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[status]}`}
    >
      {status}
    </span>
  );
}
