import type {
  StoryBible as StoryBibleState,
  WorldClassification,
  WorldRuleRelation,
} from "@writer-os/benchmark/events";
import { Characters } from "./Characters.js";
import { SectionCard, threadTone } from "./SectionCard.js";

/**
 * The Story Bible viewer shell (issue #14): every model section rendered with
 * an empty state, chapter summaries, and the derived graph as a labeled
 * placeholder — the data exists; the interactive rendering is the
 * Relationship Graph ticket's scope. The World section (issue #16) renders
 * the classification, description, and rules with their relation to
 * real-world (earth) rules. Characters render through their own section
 * (issue #15): cards plus a detail drawer.
 */

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

      <SectionCard title="World timeline" count={bible.worldTimeline.length}>
        <ol className="list-decimal space-y-1 pl-5">
          {bible.worldTimeline.map((event, i) => (
            <li key={i} className="text-zinc-300">
              {event}
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Book timeline" count={bible.bookTimeline.length}>
        <ol className="list-decimal space-y-1 pl-5">
          {bible.bookTimeline.map((event, i) => (
            <li key={i} className="text-zinc-300">
              {event}
            </li>
          ))}
        </ol>
      </SectionCard>

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
