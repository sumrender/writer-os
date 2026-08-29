import type { StoryFacts as StoryFactsState, ThreadStatus } from "@writer-os/benchmark/events";

/**
 * The Story Facts viewer (issue #11 stories 24–27): Canon grouped by the nine
 * entity kinds, each rendered with the fields the benchmark's StoryFacts
 * actually carries. The benchmark model is deliberately simpler than the PRD
 * product model, so this renders what exists rather than inventing fields.
 */

export function StoryFacts({ facts }: { facts: StoryFactsState }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <KindSection title="Characters" count={facts.characters.length}>
        <ul className="space-y-1">
          {facts.characters.map((c) => (
            <li key={c.name} className="font-medium text-zinc-100">
              {c.name}
            </li>
          ))}
        </ul>
      </KindSection>

      <KindSection title="Appearances" count={facts.appearances.length}>
        <ul className="space-y-1">
          {facts.appearances.map((a, i) => (
            <li key={i} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{a.character}</span> · {a.attribute}:{" "}
              {a.contains}
            </li>
          ))}
        </ul>
      </KindSection>

      <KindSection title="Relationships" count={facts.relationships.length}>
        <ul className="space-y-1">
          {facts.relationships.map((r, i) => (
            <li key={i} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{r.from}</span> is {r.relationType} of{" "}
              <span className="font-medium text-zinc-100">{r.to}</span>
            </li>
          ))}
        </ul>
      </KindSection>

      <KindSection title="Items" count={facts.items.length}>
        <ul className="space-y-1">
          {facts.items.map((it, i) => (
            <li key={i} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{it.item}</span> held by {it.holder}
            </li>
          ))}
        </ul>
      </KindSection>

      <KindSection title="Plot threads" count={facts.threads.length}>
        <ul className="space-y-1">
          {facts.threads.map((t, i) => (
            <li key={i} className="flex items-center justify-between text-zinc-300">
              <span className="font-medium text-zinc-100">{t.thread}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${threadTone(t.status)}`}
              >
                {t.status}
              </span>
            </li>
          ))}
        </ul>
      </KindSection>

      <KindSection title="World rules" count={facts.worldRules.length}>
        <ul className="space-y-1">
          {facts.worldRules.map((w, i) => (
            <li key={i} className="text-zinc-300">
              {w.topic}
            </li>
          ))}
        </ul>
      </KindSection>

      <KindSection title="Timeline" count={facts.timeline.length}>
        <ol className="list-decimal space-y-1 pl-5">
          {facts.timeline.map((event, i) => (
            <li key={i} className="text-zinc-300">
              {event}
            </li>
          ))}
        </ol>
      </KindSection>

      <KindSection title="Lexicon" count={facts.lexicon.length}>
        <ul className="space-y-1">
          {facts.lexicon.map((l) => (
            <li key={l.term} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{l.term}</span>
              {l.lockedSpelling && (
                <span className="ml-2 rounded bg-violet-900/50 px-1.5 py-0.5 text-xs text-violet-200">
                  locked spelling
                </span>
              )}
            </li>
          ))}
        </ul>
      </KindSection>

      <KindSection title="Style" count={facts.style.length}>
        <ul className="space-y-1">
          {facts.style.map((s, i) => (
            <li key={i} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{s.field}</span>: {s.value}
            </li>
          ))}
        </ul>
      </KindSection>
    </div>
  );
}

function threadTone(status: ThreadStatus): string {
  if (status === "resolved") return "bg-emerald-900/50 text-emerald-200";
  if (status === "open") return "bg-amber-900/50 text-amber-200";
  return "bg-zinc-800 text-zinc-300";
}

function KindSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h4 className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-200">
        {title}
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{count}</span>
      </h4>
      {count === 0 ? (
        <p className="text-sm text-zinc-600">none yet</p>
      ) : (
        children
      )}
    </section>
  );
}
