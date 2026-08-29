import type { ThreadStatus } from "@writer-os/benchmark/events";

/** Shared presentation primitives for the Story Facts and Story Bible views. */

export function threadTone(status: ThreadStatus): string {
  if (status === "resolved") return "bg-emerald-900/50 text-emerald-200";
  if (status === "open") return "bg-amber-900/50 text-amber-200";
  return "bg-zinc-800 text-zinc-300";
}

export function SectionCard({
  title,
  count,
  emptyText = "none yet",
  children,
}: {
  title: string;
  count: number;
  emptyText?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-200">
        {title}
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{count}</span>
      </h4>
      {count === 0 ? <p className="text-sm text-zinc-600">{emptyText}</p> : children}
    </section>
  );
}
