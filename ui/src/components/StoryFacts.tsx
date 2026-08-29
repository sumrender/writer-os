import type { StoryFacts as StoryFactsState } from "@writer-os/benchmark/events";
import { SectionCard, threadTone } from "./SectionCard.js";

/**
 * The Story Facts viewer (issue #11 stories 24–27, extended in issue #14):
 * canon grouped by the ten entity kinds, each rendered with the fields the
 * benchmark's StoryFacts actually carries. The benchmark model is deliberately
 * simpler than the PRD product model, so this renders what exists rather than
 * inventing fields.
 */

export function StoryFacts({ facts }: { facts: StoryFactsState }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SectionCard title="Characters" count={facts.characters.length}>
        <ul className="space-y-1">
          {facts.characters.map((c) => (
            <li key={c.name} className="font-medium text-zinc-100">
              {c.name}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Locations" count={facts.locations.length}>
        <ul className="space-y-1">
          {facts.locations.map((l) => (
            <li key={l.name} className="font-medium text-zinc-100">
              {l.name}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Appearances" count={facts.appearances.length}>
        <ul className="space-y-1">
          {facts.appearances.map((a, i) => (
            <li key={i} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{a.character}</span> · {a.attribute}:{" "}
              {a.contains}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Relationships" count={facts.relationships.length}>
        <ul className="space-y-1">
          {facts.relationships.map((r, i) => (
            <li key={i} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{r.from}</span> is {r.relationType} of{" "}
              <span className="font-medium text-zinc-100">{r.to}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Items" count={facts.items.length}>
        <ul className="space-y-1">
          {facts.items.map((it, i) => (
            <li key={i} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{it.item}</span> held by {it.holder}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Plot threads" count={facts.threads.length}>
        <ul className="space-y-1">
          {facts.threads.map((t, i) => (
            <li key={i} className="flex items-center justify-between text-zinc-300">
              <span className="font-medium text-zinc-100">{t.thread}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${threadTone(t.status)}`}>
                {t.status}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="World rules" count={facts.worldRules.length}>
        <ul className="space-y-1">
          {facts.worldRules.map((w, i) => (
            <li key={i} className="text-zinc-300">
              {w.topic}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Timeline" count={facts.timeline.length}>
        <ol className="list-decimal space-y-1 pl-5">
          {facts.timeline.map((event, i) => (
            <li key={i} className="text-zinc-300">
              {event}
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Lexicon" count={facts.lexicon.length}>
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
      </SectionCard>

      <SectionCard title="Style" count={facts.style.length}>
        <ul className="space-y-1">
          {facts.style.map((s, i) => (
            <li key={i} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{s.field}</span>: {s.value}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
