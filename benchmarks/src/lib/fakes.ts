import {
  THREAD_STATUSES,
  emptyStoryFacts,
  type StoryFacts,
  type ThreadStatus,
} from "./story-facts.js";
import { emptyStoryBible, storyBibleFromSections } from "./story-bible.js";
import type {
  Check,
  CheckResult,
  Extract,
  Generate,
  GeneratedChapter,
  SynthesizeBible,
  SynthesizeChapterSummary,
} from "./pipeline.js";
import { applyFact, type ExtractedFact } from "./fact-merge.js";
import { storyFacts } from "./fact-text.js";
import { fakeModelSections } from "./bible-sections.js";
import { deriveGraphData } from "./bible-graph.js";
import { deriveLocationProfiles, type DeriveLocationProfiles } from "./bible-locations.js";

/**
 * Rule-based deterministic pipeline fakes. The mini-book fixture
 * (books/mini-book) is written against the same sentence grammar, so fake
 * extraction over it yields hand-computable fact states.
 *
 * Grammar — one fact per line, exact templates, case-sensitive:
 *   Introducing <Name>, <tagline>.                       → character
 *   <A> is known for <attribute>: <contains>.            → appearance
 *   <A> is the <relation> of <B>.                        → relationship
 *   The <item> rests with <holder>.                      → item (holder replaces)
 *   The scene is set in <place>.                         → location (append-when-new by name)
 *   The matter of <thread> stands open|resolved|dormant. → thread (status replaces)
 *   In this world, <topic>.                              → world_rule
 *   It happened that <event>.                            → timeline (appended in read order)
 *   Say always "<term>", never otherwise.                → lexicon (locked spelling)
 *   Style decree — <field>: <value>.                     → style
 *
 * Lines outside the grammar are ignored: the fake is rule-based, not semantic.
 * Known limits, deliberate until real pipelines land: fakeCheck flags only
 * structural contradictions (item holder, thread status, relationship type);
 * fakeGenerate draws on nothing but its inputs' determinism.
 */

const NAME = "[A-Z][A-Za-z'’-]*(?: [A-Za-z][A-Za-z'’-]*)*";
const FREE = "[^.]+";

interface FactRule {
  readonly pattern: RegExp;
  readonly fact: (match: RegExpMatchArray) => ExtractedFact;
}

/**
 * Capture group `index` exists whenever the rule's pattern matched, so an
 * undefined group can only mean the pattern and this accessor drifted apart —
 * asserted once here instead of scattering `!` across every accessor.
 */
function group(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`fake grammar: capture group ${index} missing (pattern/accessor drift)`);
  }
  return value;
}

function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === "string" && (THREAD_STATUSES as readonly string[]).includes(value);
}

const RULES: readonly FactRule[] = [
  {
    pattern: new RegExp(`^Introducing (${NAME}), (.+)\\.$`),
    fact: (m) => ({ kind: "character", name: group(m, 1) }),
  },
  {
    pattern: new RegExp(`^(${NAME}) is known for ([^.:]+): ([^.]+)\\.$`),
    fact: (m) => ({
      kind: "appearance",
      character: group(m, 1),
      attribute: group(m, 2).trim(),
      contains: group(m, 3).trim(),
    }),
  },
  {
    pattern: new RegExp(`^(${NAME}) is the ([a-z -]+?) of (${NAME})\\.$`),
    fact: (m) => ({
      kind: "relationship",
      from: group(m, 1),
      to: group(m, 3),
      relationType: group(m, 2).trim(),
    }),
  },
  {
    pattern: new RegExp(`^The (${FREE}?) rests with (${NAME})\\.$`),
    fact: (m) => ({ kind: "item", item: group(m, 1).trim(), holder: group(m, 2) }),
  },
  {
    pattern: new RegExp(`^The scene is set in (${FREE}?)\\.$`),
    fact: (m) => ({ kind: "location", name: group(m, 1).trim() }),
  },
  {
    pattern: /^The matter of (.+?) stands (.+?)\.$/,
    fact: (m) => {
      const status = group(m, 2);
      if (!isThreadStatus(status)) {
        throw new Error(
          `fake grammar: "${status}" is not a thread status (pattern/status drift)`,
        );
      }
      return { kind: "thread", thread: group(m, 1).trim(), status };
    },
  },
  {
    pattern: new RegExp(`^In this world, (${FREE}?)\\.$`),
    fact: (m) => ({ kind: "world_rule", topic: group(m, 1).trim() }),
  },
  {
    pattern: new RegExp(`^It happened that (${FREE}?)\\.$`),
    fact: (m) => ({ kind: "timeline", event: group(m, 1).trim() }),
  },
  {
    pattern: /^Say always "([^."]+)", never otherwise\.$/,
    fact: (m) => ({ kind: "lexicon", term: group(m, 1).trim(), lockedSpelling: true }),
  },
  {
    pattern: new RegExp(`^Style decree — ([^.:]+): (${FREE}?)\\.$`),
    fact: (m) => ({
      kind: "style",
      field: group(m, 1).trim(),
      value: group(m, 2).trim(),
    }),
  },
];

/**
 * The fake grammar's line-level fact parser, exported for the fake chapter
 * summary: a summary of a chapter is the facts THAT chapter establishes,
 * rendered through the same fact-text currency as extraction.
 */
export function parseFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  for (const line of text.split(/\r?\n/).map((line) => line.trim())) {
    if (line.length === 0) continue;
    for (const rule of RULES) {
      const match = line.match(rule.pattern);
      if (match) {
        facts.push(rule.fact(match));
        break;
      }
    }
  }
  return facts;
}

export const fakeExtract: Extract = async (chapterText, _ordinal, factsSoFar) =>
  parseFacts(chapterText).reduce((state, fact) => applyFact(state, fact), factsSoFar);
export const fakeCheck: Check = async (
  factsAsOf,
  chapterText,
): Promise<CheckResult> => {
  const flags = [];
  for (const fact of parseFacts(chapterText)) {
    const flag = contradiction(factsAsOf, fact);
    if (flag) {
      flags.push(flag);
    }
  }
  return { flags };
};

function contradiction(
  canon: StoryFacts,
  fact: ExtractedFact,
): { kind: ExtractedFact["kind"]; message: string } | undefined {
  switch (fact.kind) {
    case "item": {
      const established = canon.items.find((i) => i.item === fact.item);
      if (established && established.holder !== fact.holder) {
        return {
          kind: "item",
          message: `item "${fact.item}" is held by "${established.holder}" in canon but the chapter asserts "${fact.holder}"`,
        };
      }
      return undefined;
    }
    case "thread": {
      const established = canon.threads.find((t) => t.thread === fact.thread);
      if (established && established.status !== fact.status) {
        return {
          kind: "thread",
          message: `thread "${fact.thread}" stands "${established.status}" in canon but the chapter asserts "${fact.status}"`,
        };
      }
      return undefined;
    }
    case "relationship": {
      const established = canon.relationships.find(
        (r) => r.from === fact.from && r.to === fact.to,
      );
      if (established && established.relationType !== fact.relationType) {
        return {
          kind: "relationship",
          message: `"${fact.from}" is the "${established.relationType}" of "${fact.to}" in canon but the chapter asserts "${fact.relationType}"`,
        };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

export const fakeGenerate: Generate = async (context, intent) => {
  const lines: string[] = [];
  for (const beat of intent?.beats ?? []) {
    lines.push(`The story turns on: ${beat}.`);
  }
  const ordinal = context.throughOrdinal + 1;
  lines.push(`Here ends chapter ${ordinal}.`);
  const chapter: GeneratedChapter = { ordinal, text: `${lines.join("\n")}\n` };
  return chapter;
};

export const fakeSynthesizeChapterSummary: SynthesizeChapterSummary = async ({
  ordinal,
  text,
}) => {
  const chapterFacts = parseFacts(text).reduce(
    (state, fact) => applyFact(state, fact),
    emptyStoryFacts(),
  );
  const summary = storyFacts(chapterFacts)
    .map((fact) => fact.text)
    .join("; ");
  return { ordinal, summary };
};

/**
 * Options for the deterministic fake bible synthesizer. `deriveLocations`
 * defaults to the production derivation so the fake matches the real
 * synthesizer's contract by default; tests that want the registry-uniform
 * placeholder behavior (every section is `BIBLE_SECTIONS.x.fake()`) inject
 * a deriver that returns `[]`.
 */
export interface FakeSynthesizeBibleOptions {
  readonly deriveLocations?: DeriveLocationProfiles;
}

/**
 * Deterministic fake bible synthesizer: seeds every model section via the
 * registry's `fake()` and replaces `locations` with the grounding
 * derivation. Mirrors the real synthesizer's contract — both always ground
 * their locations when the canon establishes places (Liskov: same inputs →
 * same shape).
 */
export function createFakeSynthesizeBible(
  options: FakeSynthesizeBibleOptions = {},
): SynthesizeBible {
  const deriveLocations = options.deriveLocations ?? deriveLocationProfiles;
  return async ({ chapters, facts, summaries }) => {
    const sections = fakeModelSections();
    return storyBibleFromSections(
      {
        ...sections,
        locations: deriveLocations({ facts, chapterTexts: chapters }),
      },
      summaries,
      deriveGraphData({ facts, chapterTexts: chapters }),
    );
  };
}

/**
 * Default-configured deterministic fake bible synthesizer. Mirrors the
 * production synthesizer's contract: every section is registry-faked and
 * `locations` is grounded via `deriveLocationProfiles`.
 */
export const fakeSynthesizeBible: SynthesizeBible = createFakeSynthesizeBible();
