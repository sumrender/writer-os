import { useState } from "react";
import type {
  LocationProfile,
  StoryBible as StoryBibleState,
  WorldClassification,
  WorldRuleRelation,
} from "@writer-os/benchmark/events";
import { Characters } from "./Characters.js";
import { SectionCard, threadTone } from "./SectionCard.js";

/**
 * The Story Bible viewer shell (issue #14, #16, #17): every model section
 * rendered with an empty state, chapter summaries, and the derived graph as a
 * labeled placeholder — the data exists; the interactive rendering is the
 * Relationship Graph ticket's scope. The World section (issue #16) renders
 * the classification, description, and rules with their relation to
 * real-world (earth) rules. Characters render through their own section
 * (issue #15): cards plus a detail drawer. The Locations section (issue #17)
 * renders the location list and per-location detail (description,
 * significance, characters seen with first co-occurrence ordinal).
 */

function locationHasContent(location: LocationProfile): boolean {
  return (
    location.description !== "" ||
    location.significance !== "" ||
    location.charactersSeen.length > 0
  );
}

function LocationCard({ location }: { location: LocationProfile }) {
  return (
    <article className="space-y-1 border-l-2 border-zinc-800 pl-3">
      <h5 className="font-medium text-zinc-100">{location.name}</h5>
      {location.description !== "" ? (
        <p className="text-sm text-zinc-300">{location.description}</p>
      ) : null}
      {location.significance !== "" ? (
        <p className="text-xs italic text-zinc-400">{location.significance}</p>
      ) : null}
      {location.charactersSeen.length > 0 ? (
        <ul className="flex flex-wrap gap-1 pt-1">
          {location.charactersSeen.map((seen) => (
            <li
              key={`${location.name}-${seen.character}`}
              className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300"
            >
              {seen.character}
              <span className="ml-1 text-zinc-500">ch. {seen.firstCoOccurrenceOrdinal}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function classificationTone(classification: WorldClassification): string {
  if (classification === "earth") return "bg-sky-900/50 text-sky-200";
  if (classification === "hybrid") return "bg-violet-900/50 text-violet-200";
  return "bg-fuchsia-900/50 text-fuchsia-200";
}

function relationTone(relation: WorldRuleRelation): string {
  return relation === "deviates_from_earth"
    ? "bg-amber-900/50 text-amber-200"
    : "bg-emerald-900/50 text-emerald-200";
}

function WorldSectionView({ world }: { world: StoryBibleState["world"] }) {
  const established = world.description !== "" || world.rules.length > 0;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:col-span-2">
      <h4 className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-200">
        World
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${classificationTone(world.classification)}`}
        >
          {world.classification}
        </span>
      </h4>
      {!established ? (
        <p className="text-sm text-zinc-600">none yet</p>
      ) : (
        <>
          <p className="text-sm text-zinc-300">{world.description}</p>
          <ul className="mt-2 space-y-1">
            {world.rules.map((rule, index) => (
              <li key={`${index}-${rule.rule}`} className="text-zinc-300">
                <span className="font-medium text-zinc-100">{rule.rule}</span>{" "}
                <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${relationTone(rule.relation)}`}>
                  {rule.relation === "deviates_from_earth" ? "deviates from earth" : "same as earth"}
                </span>
                {rule.note !== "" && <span className="block text-zinc-400">{rule.note}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function StoryBible({ bible }: { bible: StoryBibleState }) {
  // The locations card's "count" is the number of entries with actual
  // content — a list of empty stubs (description, significance, and
  // charactersSeen all empty) is the same as no locations for the
  // empty-state UX, matching every other section's "no content" treatment.
  const populatedLocations = bible.locations.filter(locationHasContent);
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

      <WorldSectionView world={bible.world} />

      <Characters profiles={bible.characterProfiles} graph={bible.graph} />

      <SectionCard title="Locations" count={populatedLocations.length} emptyText="no locations established">
        <ul className="space-y-3">
          {populatedLocations.map((location) => (
            <li key={location.name}>
              <LocationCard location={location} />
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
