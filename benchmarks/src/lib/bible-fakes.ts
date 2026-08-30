import { factCount, isThreadStatus, type StoryFacts, type ThreadStatus } from "./story-facts.js";
import {
  emptyBookOverview,
  type BookOverview,
  type SectionCanon,
  type ThreadRollup,
} from "./story-bible.js";

/**
 * Deterministic, canon-grounded fakes for the two *prose* Story Bible
 * sections (issue #19): the book overview and the thread rollups. They are
 * the registered fakes' implementations — fully offline, hand-computable, and
 * derived strictly from the graded Story Facts and chapter summaries the
 * Synthesize port provides, so the output can never contradict the fact layer
 * or invent plot events (a fake, but grounded like the real synthesizer must
 * be). Where canon genuinely cannot ground a field (genre, era), the fake
 * says so instead of inventing a label.
 */

/** The thread-status phrase the canon uses and the validators scan for. */
const THREAD_STATUS_PHRASE = /plot thread "([^"]+)" stands (open|resolved|dormant)/g;

export interface ThreadStatusAssertion {
  readonly thread: string;
  readonly status: ThreadStatus;
}

/** Every `plot thread "X" stands Y` assertion in a text, in occurrence order. */
export function threadStatusAssertions(text: string): readonly ThreadStatusAssertion[] {
  const assertions: ThreadStatusAssertion[] = [];
  for (const match of text.matchAll(THREAD_STATUS_PHRASE)) {
    const thread = match[1];
    const status = match[2];
    if (thread !== undefined && isThreadStatus(status)) {
      assertions.push({ thread, status });
    }
  }
  return assertions;
}

/** The overview's per-ordinal deterministic baseline (issue #19). */
export function fakeBookOverview(facts: StoryFacts): BookOverview {
  if (factCount(facts) === 0) return emptyBookOverview();
  return {
    title: titleFrom(facts),
    genre: "unstated by the canon",
    era: "unstated by the canon",
    setting: settingFrom(facts),
    premise: premiseFrom(facts),
    synopsis: synopsisFrom(facts),
    themes: themesFrom(facts),
  };
}

/** The thread-rollup deterministic baseline (issue #19). */
export function fakeThreadRollups(canon: SectionCanon): readonly ThreadRollup[] {
  return canon.facts.threads.map((entry) => ({
    thread: entry.thread,
    status: entry.status,
    rollup: threadArc(canon, entry.thread, entry.status),
  }));
}

/**
 * One thread's arc through the story: the chapters whose summaries assert
 * its status, rendered as prose that never contradicts the fact-layer status
 * (the last asserted status is the canon's own). Falls back to a statement
 * of the canon when no summary mentions the thread.
 */
function threadArc(canon: SectionCanon, thread: string, status: ThreadStatus): string {
  const mentions = canon.chapterSummaries.flatMap((summary) =>
    threadStatusAssertions(summary.summary)
      .filter((assertion) => assertion.thread === thread)
      .map((assertion) => ({ ordinal: summary.ordinal, status: assertion.status })),
  );
  const openedBy = mentions[0]?.ordinal;
  const latest = mentions.at(-1)?.ordinal;
  if (openedBy !== undefined && latest !== undefined) {
    switch (status) {
      case "open":
        return `Opened by chapter ${openedBy} and still open as of chapter ${latest}.`;
      case "resolved":
        return `Opened by chapter ${openedBy} and resolved by chapter ${latest}.`;
      case "dormant":
        return `Opened by chapter ${openedBy} and dormant as of chapter ${latest}.`;
    }
  }
  return `The canon establishes: plot thread "${thread}" stands ${status}.`;
}

/** Title from the first established location, else character, else item. */
function titleFrom(facts: StoryFacts): string {
  const location = facts.locations[0];
  const character = facts.characters[0];
  const item = facts.items[0];
  if (location !== undefined) return `The ${titleCase(location.name.replace(/^the\s+/i, ""))}`;
  if (character !== undefined) return `${character.name}'s Tale`;
  if (item !== undefined) return `The ${titleCase(item.item.replace(/^the\s+/i, ""))}`;
  return "";
}

/** Canon-established places, falling back to world rules when no place. */
function settingFrom(facts: StoryFacts): string {
  if (facts.locations.length > 0) return facts.locations.map((l) => l.name).join("; ");
  return facts.worldRules.map((rule) => rule.topic).join("; ");
}

/** Premise from the established protagonist, opening thread, or world rule. */
function premiseFrom(facts: StoryFacts): string {
  const protagonist = facts.characters[0];
  const thread = facts.threads[0];
  if (protagonist !== undefined && thread !== undefined) {
    return `The tale of ${protagonist.name} and the matter of "${thread.thread}".`;
  }
  if (protagonist !== undefined) return `The tale of ${protagonist.name}.`;
  const rule = facts.worldRules[0];
  if (rule !== undefined) return `A tale where ${rule.topic}.`;
  return "";
}

/**
 * The per-ordinal synopsis: strictly the canon's own timeline events plus the
 * fact-layer thread statuses as of this ordinal — never an event or resolution
 * the canon has not established yet.
 */
function synopsisFrom(facts: StoryFacts): string {
  const parts: string[] = [];
  if (facts.timeline.length > 0) parts.push(facts.timeline.join("; "));
  for (const thread of facts.threads) {
    parts.push(`plot thread "${thread.thread}" stands ${thread.status}`);
  }
  return parts.length > 0 ? `${parts.join(". ")}.` : "";
}

/** Recurring elements the canon establishes: world rules, else items, etc. */
function themesFrom(facts: StoryFacts): string {
  if (facts.worldRules.length > 0) return facts.worldRules.map((rule) => rule.topic).join("; ");
  if (facts.items.length > 0) return facts.items.map((item) => item.item).join("; ");
  if (facts.locations.length > 0) return facts.locations.map((location) => location.name).join("; ");
  if (facts.characters.length > 0) return facts.characters.map((character) => character.name).join("; ");
  return "";
}

/** Title-cases a lower-cased canon phrase without touching punctuation. */
function titleCase(phrase: string): string {
  return phrase
    .split(" ")
    .map((word) => (word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}