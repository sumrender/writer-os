import type { StoryBible as StoryBibleState } from "@writer-os/benchmark/events";
import type { BookOverview } from "@writer-os/benchmark/events";
import { SectionCard, threadTone } from "./SectionCard.js";

/**
 * The Story Bible viewer shell (issue #14): every model section rendered with
 * an empty state, chapter summaries, and the derived graph as a labeled
 * placeholder — the data exists; the interactive rendering is the
 * Relationship Graph ticket's scope. The book overview and thread-rollup
 * sections carry the issue #19 prose baselines.
 */

/** True when every overview field is still empty (nothing to show yet). */
function isOverviewEmpty(overview: BookOverview): boolean {
  return (
    overview.title === "" &&
    overview.genre === "" &&
    overview.era === "" &&
    overview.setting === "" &&
    overview.premise === "" &&
    overview.synopsis === "" &&
    overview.themes === ""
  );
}

function OverviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-300">{value === "" ? "—" : value}</dd>
    </div>
  );
}

export function StoryBible({ bible }: { bible: StoryBibleState }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:col-span-2">
        <h4 className="mb-2 text-sm font-semibold text-zinc-200">Book overview</h4>
        {isOverviewEmpty(bible.bookOverview) ? (
          <p className="text-sm text-zinc-600">none yet</p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            <OverviewField label="Title" value={bible.bookOverview.title} />
            <OverviewField label="Genre" value={bible.bookOverview.genre} />
            <OverviewField label="Era" value={bible.bookOverview.era} />
            <OverviewField label="Setting" value={bible.bookOverview.setting} />
            <OverviewField label="Premise" value={bible.bookOverview.premise} />
            <OverviewField label="Synopsis" value={bible.bookOverview.synopsis} />
            <OverviewField label="Themes" value={bible.bookOverview.themes} />
          </dl>
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
        <ul className="space-y-2">
          {bible.threadRollups.map((t) => (
            <li key={t.thread} className="text-zinc-300">
              <span className="flex items-center gap-2">
                <span className="font-medium text-zinc-100">{t.thread}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${threadTone(t.status)}`}>
                  {t.status}
                </span>
              </span>
              <span className="mt-1 block text-sm text-zinc-400">{t.rollup}</span>
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
