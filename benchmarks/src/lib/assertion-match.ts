import type { Assertion } from "./assertions.js";
import type { BibleState, EntityKind } from "./bible.js";
import { entryKey } from "./fact-text.js";
import type { EquivalenceChecker } from "./judge.js";

/**
 * Assertion-to-bible matching (docs/TESTING.md §6). Deterministic exact
 * checks run first; only superficially-differing *judgable* values —
 * relationship types, appearance descriptions, style values, world-rule
 * topics, timeline event wording — route to the equivalence judge.
 * Names, holders, statuses, and spellings never depend on a model's opinion,
 * so a mismatch on those is final and judge-free.
 *
 * Judge mediation serves `must` assertions only: it decides whether an
 * extracted fact satisfies a required one. `must_not` probes are
 * deterministic tripwires — they trigger on exact matches alone, and a
 * paraphrased violation they miss surfaces through the open-world sweep
 * instead, keeping fabrication estimates separate from exact scores.
 */

export interface MatchOutcome {
  readonly mode: "exact" | "judged";
  /** Content keys of the bible entries the match consumed. */
  readonly claimedKeys: readonly string[];
}

const exactMatch = (kind: EntityKind, payload: unknown): MatchOutcome => ({
  mode: "exact",
  claimedKeys: [entryKey(kind, payload)],
});

/** Finds a match for `assertion` in `state`, or undefined when none exists. */
export async function findMatch(
  assertion: Assertion,
  state: BibleState,
  checker: EquivalenceChecker,
): Promise<MatchOutcome | undefined> {
  const mayJudge = assertion.expect === "must";

  switch (assertion.kind) {
    case "character": {
      const entry = state.characters.find((c) => c.name === assertion.name);
      return entry ? exactMatch("character", entry) : undefined;
    }
    case "appearance":
      for (const entry of state.appearances) {
        if (entry.character !== assertion.character) continue;
        if (entry.attribute !== assertion.attribute) continue;
        if (entry.contains === assertion.contains) return exactMatch("appearance", entry);
        if (!mayJudge) continue;
        if (await checker.areEquivalent({ left: assertion.contains, right: entry.contains })) {
          return { mode: "judged", claimedKeys: [entryKey("appearance", entry)] };
        }
      }
      return undefined;
    case "relationship":
      for (const entry of state.relationships) {
        if (entry.from !== assertion.from || entry.to !== assertion.to) continue;
        if (entry.relationType === assertion.relationType) return exactMatch("relationship", entry);
        if (!mayJudge) continue;
        if (
          await checker.areEquivalent({
            left: assertion.relationType,
            right: entry.relationType,
          })
        ) {
          return { mode: "judged", claimedKeys: [entryKey("relationship", entry)] };
        }
      }
      return undefined;
    case "item": {
      const entry = state.items.find((i) => i.item === assertion.item);
      if (!entry || entry.holder !== assertion.holder) return undefined;
      return exactMatch("item", entry);
    }
    case "thread": {
      const entry = state.threads.find((t) => t.thread === assertion.thread);
      if (!entry || entry.status !== assertion.status) return undefined;
      return exactMatch("thread", entry);
    }
    case "world_rule":
      for (const entry of state.worldRules) {
        if (entry.topic === assertion.topic) return exactMatch("world_rule", entry);
        if (!mayJudge) continue;
        if (await checker.areEquivalent({ left: assertion.topic, right: entry.topic })) {
          return { mode: "judged", claimedKeys: [entryKey("world_rule", entry)] };
        }
      }
      return undefined;
    case "timeline":
      return matchTimeline(assertion.sequence, state.timeline, checker, mayJudge);
    case "lexicon": {
      const entry = state.lexicon.find(
        (l) => l.term === assertion.term && l.lockedSpelling === assertion.lockedSpelling,
      );
      return entry ? exactMatch("lexicon", entry) : undefined;
    }
    case "style":
      for (const entry of state.style) {
        if (entry.field !== assertion.field) continue;
        if (entry.value === assertion.value) return exactMatch("style", entry);
        if (!mayJudge) continue;
        if (await checker.areEquivalent({ left: assertion.value, right: entry.value })) {
          return { mode: "judged", claimedKeys: [entryKey("style", entry)] };
        }
      }
      return undefined;
  }
}

/**
 * The asserted sequence must appear in the extracted timeline as an ordered
 * subsequence. Exact hits win before any judging; reworded events align via
 * the judge (for must assertions only), but ordering itself stays structural.
 */
async function matchTimeline(
  sequence: readonly string[],
  extracted: readonly string[],
  checker: EquivalenceChecker,
  mayJudge: boolean,
): Promise<MatchOutcome | undefined> {
  let cursor = 0;
  let judgedAny = false;
  const claimed: string[] = [];

  for (const event of sequence) {
    const rest = extracted.slice(cursor);
    let relative = rest.indexOf(event);
    if (relative === -1 && mayJudge) {
      for (let i = 0; i < rest.length; i++) {
        const candidate = rest[i];
        if (candidate === undefined) continue;
        if (await checker.areEquivalent({ left: event, right: candidate })) {
          relative = i;
          judgedAny = true;
          break;
        }
      }
    }
    if (relative === -1) return undefined;

    const matchedEvent = rest[relative];
    if (matchedEvent === undefined) return undefined;
    claimed.push(entryKey("timeline", matchedEvent));
    cursor += relative + 1;
  }

  return { mode: judgedAny ? "judged" : "exact", claimedKeys: claimed };
}
