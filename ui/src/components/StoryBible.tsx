import { useState } from "react";
import type { StoryBible as StoryBibleState } from "@writer-os/benchmark/events";
import { SectionCard, threadTone } from "./SectionCard.js";

/**
 * The Story Bible viewer shell (issue #14): every model section rendered with
 * an empty state, chapter summaries, and the derived graph as a labeled
 * placeholder — the data exists; the interactive rendering is the
 * Relationship Graph ticket's scope.
 */

export function StoryBible({ bible }: { bible: StoryBibleState }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:col-span-2">
        <h4 className="mb-2 text-sm font-semibold text-zinc-200">Book overview</h4>
        {bible.bookOverview === "" ? (
          <p className="text-sm text-zinc-600">none yet</p>
        ) : (
          <p className="text-sm text-zinc-300">{bible.bookOverview}</p>
        )}
      </section>

      <SectionCard title="World" count={bible.world.length}>
        <ul className="space-y-1">
          {bible.world.map((w) => (
            <li key={w.topic} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{w.topic}</span>: {w.note}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Character profiles" count={bible.characterProfiles.length}>
        <ul className="space-y-1">
          {bible.characterProfiles.map((p) => (
            <li key={p.name} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{p.name}</span>: {p.profile}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Location profiles" count={bible.locationProfiles.length}>
        <ul className="space-y-1">
          {bible.locationProfiles.map((p) => (
            <li key={p.name} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{p.name}</span>: {p.profile}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Thread rollups" count={bible.threadRollups.length}>
        <ul className="space-y-1">
          {bible.threadRollups.map((t) => (
            <li key={t.thread} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{t.thread}</span>{" "}
              <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${threadTone(t.status)}`}>
                {t.status}
              </span>
              <span className="block">{t.rollup}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Groups & factions" count={bible.groups.length}>
        <ul className="space-y-1">
          {bible.groups.map((g) => (
            <li key={g.name} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{g.name}</span>: {g.description}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Items of significance" count={bible.itemsOfSignificance.length}>
        <ul className="space-y-1">
          {bible.itemsOfSignificance.map((it) => (
            <li key={it.name} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{it.name}</span>: {it.description}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Lexicon notes" count={bible.lexiconNotes.length}>
        <ul className="space-y-1">
          {bible.lexiconNotes.map((l) => (
            <li key={l.term} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{l.term}</span>: {l.note}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Open loops & foreshadowing" count={bible.openLoops.length}>
        <ul className="space-y-1">
          {bible.openLoops.map((o, i) => (
            <li key={i} className="text-zinc-300">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                opened ch. {o.openedAtOrdinal}
              </span>{" "}
              {o.description}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Style rollup" count={bible.styleRollup.length}>
        <ul className="space-y-1">
          {bible.styleRollup.map((s) => (
            <li key={s.field} className="text-zinc-300">
              <span className="font-medium text-zinc-100">{s.field}</span>: {s.value}
            </li>
          ))}
        </ul>
      </SectionCard>

      <TimelinesCard worldTimeline={bible.worldTimeline} bookTimeline={bible.bookTimeline} />

      <SectionCard title="Chapter summaries" count={bible.chapterSummaries.length}>
        <ol className="list-decimal space-y-1 pl-5">
          {bible.chapterSummaries.map((s) => (
            <li key={s.ordinal} className="text-zinc-300">
              {s.summary}
            </li>
          ))}
        </ol>
      </SectionCard>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <h4 className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-200">
          Relationship graph
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {bible.graph.nodes.length} nodes · {bible.graph.edges.length} edges
          </span>
        </h4>
        <p className="text-sm text-zinc-600">
          Derived from Story Facts; the interactive graph ships with the Relationship Graph ticket.
        </p>
      </section>
    </div>
  );
}

function TimelinesCard({
  worldTimeline,
  bookTimeline,
}: {
  worldTimeline: StoryBibleState["worldTimeline"];
  bookTimeline: StoryBibleState["bookTimeline"];
}) {
  const [view, setView] = useState<"world" | "book">("world");
  const totalEvents = view === "world" ? worldTimeline.length : bookTimeline.reduce((sum, e) => sum + e.events.length, 0);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-zinc-200">Timelines</h4>
        <div className="flex rounded-md border border-zinc-700 bg-zinc-950">
          <button
            type="button"
            onClick={() => setView("world")}
            className={`px-3 py-1 text-xs font-medium transition ${
              view === "world"
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            World
          </button>
          <button
            type="button"
            onClick={() => setView("book")}
            className={`px-3 py-1 text-xs font-medium transition ${
              view === "book"
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Book
          </button>
        </div>
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        {view === "world"
          ? "In-world chronological order — events marked stated (directly from canon prose) or inferred (synthesized ordering)."
          : "Narration order keyed by chapter ordinal."}
      </p>
      {totalEvents === 0 ? (
        <p className="text-sm text-zinc-600">none yet</p>
      ) : view === "world" ? (
        <ol className="list-decimal space-y-1 pl-5">
          {worldTimeline.map((entry, i) => (
            <li key={i} className="text-zinc-300">
              {entry.event}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                  entry.grounding === "stated"
                    ? "bg-emerald-900/50 text-emerald-200"
                    : "bg-amber-900/50 text-amber-200"
                }`}
              >
                {entry.grounding}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="list-decimal space-y-2 pl-5">
          {bookTimeline.map((entry) => (
            <li key={entry.ordinal} className="text-zinc-300">
              <span className="mr-2 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                ch. {entry.ordinal}
              </span>
              {entry.events.join("; ")}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
