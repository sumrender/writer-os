import { isPlainObject, nonEmptyString, positiveInt } from "./schema-primitives.js";
import { factCount, isThreadStatus, THREAD_STATUSES, type StoryFacts } from "./story-facts.js";
import { threadStatusAssertions } from "./bible-fakes.js";
import type {
  BibleSynthesisContext,
  BookOverview,
  LexiconNote,
  ModelSectionKey,
  ModelSections,
  NamedDescription,
  OpenLoop,
  ProfileEntry,
  StyleField,
  ThreadRollup,
  WorldNote,
} from "./story-bible.js";
import { fakeBookOverview, fakeThreadRollups } from "./bible-fakes.js";
import { emptyStoryFacts } from "./story-facts.js";

/**
 * Composition machinery for Story Bible synthesis (issue #14, ADR-0007): the
 * registry through which every aspect contributes its section's prompt block,
 * wire shape, validator, and deterministic fake. The master prompt assembles
 * the per-section blocks; the master `validateBible` delegates per-section
 * validation; the deterministic fake dispatches per-section fakes. Aspects
 * grow the bible by adding registry entries — the machinery itself never
 * edits a stable core per section (CODING_STANDARDS §3.2). The overview and
 * thread-rollup sections (issue #19) carry canon-grounded validators and
 * fakes; every other section stays a shape-only validator and an empty fake.
 */

/** Tool-schema shape of one section's value on the synthesis wire. */
export type SectionWireSchema =
  | { readonly type: "string" }
  | {
      readonly type: "object";
      readonly properties: Readonly<Record<string, { readonly type: "string" }>>;
    }
  | {
      readonly type: "array";
      readonly items: { readonly type: "object" } | { readonly type: "string" };
    };

export interface BibleSectionSpec<K extends ModelSectionKey> {
  readonly key: K;
  /** snake_case property key on the monolithic wire payload. */
  readonly wireKey: string;
  /** The prompt block contributed for this section. */
  readonly instruction: string;
  readonly wireSchema: SectionWireSchema;
  /**
   * Trust-boundary validation: returns the precisely-typed section value or
   * throws with a `near:` raw-payload snippet. Unknown fields are dropped,
   * recoverable shapes normalized, missing/ambiguous shapes rejected.
   * Sections whose content must be grounded in canon (overview, thread
   * rollups) additionally reject values the graded Story Facts do not
   * support — invented threads, status changes without a basis in the
   * fact layer, plot events the canon has not established.
   */
  readonly validate: (raw: unknown, canon: StoryFacts) => ModelSections[K];
  /**
   * Deterministic baseline fake. Sections that synthesize prose over canon
   * derive their value from {@link BibleSynthesisContext}; every other
   * section ships its valid empty placeholder.
   */
  readonly fake: (input: BibleSynthesisContext) => ModelSections[K];
}

const SNIPPET_MAX = 160;

function snippet(raw: unknown): string {
  let text: string;
  try {
    text = raw === undefined ? "undefined" : (JSON.stringify(raw) ?? String(raw));
  } catch {
    text = String(raw);
  }
  return text.slice(0, SNIPPET_MAX);
}

function failSection(where: string, problem: string, raw: unknown): never {
  throw new Error(`${where}: ${problem} near: ${snippet(raw)}`);
}

/** A bare mention the model emitted where an object entry was expected. */
type BareStringRecovery<E> = (text: string) => E;

/**
 * Shared validator for object-array sections: each entry must be an object
 * carrying a non-empty identity field (a missing secondary field or an
 * explicit null normalizes to "") — or, when the section's secondary fields
 * are all recoverable, a bare string. Unknown entry fields are dropped
 * (canonical entries are reconstructed explicitly), mirroring the extraction
 * validator's noise-rejection discipline.
 */
function parseObjectArray<E>(
  where: string,
  raw: unknown,
  fields: { readonly identity: string; readonly secondary: string },
  build: (identity: string, secondary: string, entry: Record<string, unknown>) => E,
  recoverBareString?: BareStringRecovery<E>,
): readonly E[] {
  if (!Array.isArray(raw)) {
    failSection(where, `must be an array of {${fields.identity}, ${fields.secondary}} entries`, raw);
  }
  return raw.map((entry, index): E => {
    if (typeof entry === "string") {
      if (recoverBareString === undefined || !nonEmptyString(entry)) {
        failSection(
          where,
          `entry #${index} must be an object with a non-empty "${fields.identity}"`,
          entry,
        );
      }
      return recoverBareString(entry);
    }
    if (!isPlainObject(entry)) {
      failSection(where, `entry #${index} must be an object or a bare string`, entry);
    }
    const identity = entry[fields.identity];
    if (!nonEmptyString(identity)) {
      failSection(where, `entry #${index} "${fields.identity}" must be a non-empty string`, entry);
    }
    const secondaryRaw = entry[fields.secondary];
    const secondary = nonEmptyString(secondaryRaw) ? secondaryRaw : "";
    return build(identity, secondary, entry);
  });
}

function parseStringArray(where: string, raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) {
    failSection(where, "must be an array of strings", raw);
  }
  return raw.map((entry, index) => {
    if (!nonEmptyString(entry)) {
      failSection(where, `entry #${index} must be a non-empty string`, entry);
    }
    return entry;
  });
}

const BOOK_OVERVIEW_FIELDS = [
  "title",
  "genre",
  "era",
  "setting",
  "premise",
  "synopsis",
  "themes",
] as const;

/**
 * Shape-validates the overview object: every field must be a string when
 * present (recoverable null/missing normalizes to ""), unknown fields are
 * dropped, and a genuinely non-string field hard-fails.
 */
function parseBookOverview(raw: unknown): BookOverview {
  if (!isPlainObject(raw)) {
    failSection("bookOverview", "must be an object with string fields", raw);
  }
  const overview: Record<string, string> = {};
  for (const field of BOOK_OVERVIEW_FIELDS) {
    const value = raw[field];
    if (typeof value === "string") {
      overview[field] = value;
    } else if (value !== undefined && value !== null) {
      failSection("bookOverview", `"${field}" must be a string`, value);
    } else {
      overview[field] = "";
    }
  }
  return {
    title: overview["title"] ?? "",
    genre: overview["genre"] ?? "",
    era: overview["era"] ?? "",
    setting: overview["setting"] ?? "",
    premise: overview["premise"] ?? "",
    synopsis: overview["synopsis"] ?? "",
    themes: overview["themes"] ?? "",
  };
}

/**
 * Canon-grounded overview check (issue #19): an overview is valid only when
 * the canon establishes something to ground it, and the premise/synopsis may
 * not assert a thread status that contradicts the fact layer or reference a
 * thread that is not established — the deterministic "no invented plot
 * events" and "no status changes without a basis" guard.
 */
function assertBookOverviewGrounded(overview: BookOverview, canon: StoryFacts): void {
  if (factCount(canon) === 0) {
    if (BOOK_OVERVIEW_FIELDS.some((field) => overview[field] !== "")) {
      failSection("bookOverview", "canon establishes nothing; the overview must be empty", overview);
    }
    return;
  }
  assertThreadAssertionsGrounded(overview.premise, canon, "bookOverview");
  assertThreadAssertionsGrounded(overview.synopsis, canon, "bookOverview");
}

/**
 * Scans prose for `plot thread "X" stands Y` assertions (the canon's own
 * phrase currency) and rejects any assertion the fact layer does not support:
 * an unestablished thread or a status change without a basis in canon.
 */
function assertThreadAssertionsGrounded(text: string, canon: StoryFacts, where: string): void {
  const byThread = new Map(canon.threads.map((thread) => [thread.thread, thread.status]));
  for (const assertion of threadStatusAssertions(text)) {
    const established = byThread.get(assertion.thread);
    if (established === undefined) {
      failSection(where, `thread \"${assertion.thread}\" is not established in canon`, assertion);
    }
    if (established !== assertion.status) {
      failSection(
        where,
        `thread \"${assertion.thread}\" is asserted \"${assertion.status}\" but canon establishes \"${established}\"`,
        assertion,
      );
    }
  }
}

/**
 * Canon-grounded thread-rollup check (issue #19): every rollup must name a
 * thread the fact layer establishes and carry that thread's exact fact-layer
 * status — the rollups summarize canon, never revise it.
 */
function assertThreadRollupsGrounded(rollups: readonly ThreadRollup[], canon: StoryFacts): void {
  if (canon.threads.length === 0 && rollups.length > 0) {
    failSection("threadRollups", "no threads established in canon; rollups must be empty", rollups);
  }
  const byThread = new Map(canon.threads.map((thread) => [thread.thread, thread.status]));
  for (const rollup of rollups) {
    const established = byThread.get(rollup.thread);
    if (established === undefined) {
      failSection("threadRollups", `thread \"${rollup.thread}\" is not established in canon`, rollup);
    }
    if (established !== rollup.status) {
      failSection(
        "threadRollups",
        `thread \"${rollup.thread}\" is asserted \"${rollup.status}\" but canon establishes \"${established}\"`,
        rollup,
      );
    }
    assertThreadAssertionsGrounded(rollup.rollup, canon, "threadRollups");
  }
}

const REGISTRY = {
  bookOverview: {
    key: "bookOverview",
    wireKey: "book_overview",
    instruction: [
      "book_overview: the book's overview as of this canon — the fields title, genre, era, setting, premise, one-page synopsis grounded strictly in what the canon as of this ordinal establishes (never later events or resolutions), and themes.",
      "Value: an object with string fields {title, genre, era, setting, premise, synopsis, themes}; an empty string is valid wherever the canon establishes nothing for that field yet.",
      "When the synopsis states a thread's status, use the canon's phrase form: plot thread \"...\" stands open|resolved|dormant, matching the Story Facts exactly.",
    ].join(" "),
    wireSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        genre: { type: "string" },
        era: { type: "string" },
        setting: { type: "string" },
        premise: { type: "string" },
        synopsis: { type: "string" },
        themes: { type: "string" },
      },
    },
    validate: (raw, canon): BookOverview => {
      const overview = parseBookOverview(raw);
      assertBookOverviewGrounded(overview, canon);
      return overview;
    },
    fake: ({ facts }) => fakeBookOverview(facts),
  },
  world: {
    key: "world",
    wireKey: "world",
    instruction:
      "world: notes on the world's rules, settings, and background as established by canon. Value: an array of {topic, note} objects.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly WorldNote[] =>
      parseObjectArray<WorldNote>(
        "world",
        raw,
        { identity: "topic", secondary: "note" },
        (topic, note) => ({ topic, note }),
        (topic) => ({ topic, note: "" }),
      ),
    fake: () => [],
  },
  characterProfiles: {
    key: "characterProfiles",
    wireKey: "character_profiles",
    instruction:
      "character_profiles: per-character profile distillations drawn from canon. Value: an array of {name, profile} objects.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly ProfileEntry[] =>
      parseObjectArray<ProfileEntry>(
        "characterProfiles",
        raw,
        { identity: "name", secondary: "profile" },
        (name, profile) => ({ name, profile }),
        (name) => ({ name, profile: "" }),
      ),
    fake: () => [],
  },
  locationProfiles: {
    key: "locationProfiles",
    wireKey: "location_profiles",
    instruction:
      "location_profiles: per-location profile distillations drawn from canon. Value: an array of {name, profile} objects.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly ProfileEntry[] =>
      parseObjectArray<ProfileEntry>(
        "locationProfiles",
        raw,
        { identity: "name", secondary: "profile" },
        (name, profile) => ({ name, profile }),
        (name) => ({ name, profile: "" }),
      ),
    fake: () => [],
  },
  threadRollups: {
    key: "threadRollups",
    wireKey: "thread_rollups",
    instruction:
      "thread_rollups: per-thread rollups summarizing each established thread's arc through the story so far. Value: an array of {thread, status, rollup} objects, one per canon thread, where status must equal the Story Facts status exactly (open, resolved, or dormant) — never change a status the fact layer has not changed.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw, canon): readonly ThreadRollup[] => {
      const rollups = parseObjectArray<ThreadRollup>(
        "threadRollups",
        raw,
        { identity: "thread", secondary: "rollup" },
        (thread, rollup, entry) => {
          const status = entry["status"];
          if (!isThreadStatus(status)) {
            failSection(
              "threadRollups",
              `"status" must be one of ${THREAD_STATUSES.join(", ")}`,
              entry,
            );
          }
          return { thread, status, rollup };
        },
      );
      assertThreadRollupsGrounded(rollups, canon);
      return rollups;
    },
    fake: (input) => fakeThreadRollups(input),
  },
  groups: {
    key: "groups",
    wireKey: "groups",
    instruction:
      "groups: groups, factions, and organizations. Value: an array of {name, description} objects.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly NamedDescription[] =>
      parseObjectArray<NamedDescription>(
        "groups",
        raw,
        { identity: "name", secondary: "description" },
        (name, description) => ({ name, description }),
        (name) => ({ name, description: "" }),
      ),
    fake: () => [],
  },
  itemsOfSignificance: {
    key: "itemsOfSignificance",
    wireKey: "items_of_significance",
    instruction:
      "items_of_significance: items of significance and what they mean to the story. Value: an array of {name, description} objects.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly NamedDescription[] =>
      parseObjectArray<NamedDescription>(
        "itemsOfSignificance",
        raw,
        { identity: "name", secondary: "description" },
        (name, description) => ({ name, description }),
        (name) => ({ name, description: "" }),
      ),
    fake: () => [],
  },
  lexiconNotes: {
    key: "lexiconNotes",
    wireKey: "lexicon_notes",
    instruction:
      "lexicon_notes: vocabulary notes for in-world terms and their locked spellings. Value: an array of {term, note} objects.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly LexiconNote[] =>
      parseObjectArray<LexiconNote>(
        "lexiconNotes",
        raw,
        { identity: "term", secondary: "note" },
        (term, note) => ({ term, note }),
        (term) => ({ term, note: "" }),
      ),
    fake: () => [],
  },
  openLoops: {
    key: "openLoops",
    wireKey: "open_loops",
    instruction:
      "open_loops: open loops and unresolved foreshadowing. Value: an array of {description, openedAtOrdinal} objects where openedAtOrdinal is the chapter ordinal that opened the loop.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly OpenLoop[] => {
      if (!Array.isArray(raw)) {
        failSection("openLoops", "must be an array of {description, openedAtOrdinal} entries", raw);
      }
      return raw.map((entry, index): OpenLoop => {
        if (!isPlainObject(entry)) {
          failSection("openLoops", `entry #${index} must be an object`, entry);
        }
        const description = entry["description"];
        if (!nonEmptyString(description)) {
          failSection(
            "openLoops",
            `entry #${index} "description" must be a non-empty string`,
            entry,
          );
        }
        const openedAtOrdinal = entry["openedAtOrdinal"];
        if (!positiveInt(openedAtOrdinal)) {
          failSection(
            "openLoops",
            `entry #${index} "openedAtOrdinal" must be a positive integer`,
            entry,
          );
        }
        return { description, openedAtOrdinal };
      });
    },
    fake: () => [],
  },
  styleRollup: {
    key: "styleRollup",
    wireKey: "style_rollup",
    instruction:
      "style_rollup: the book's style guide as established by canon. Value: an array of {field, value} objects.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly StyleField[] =>
      parseObjectArray<StyleField>(
        "styleRollup",
        raw,
        { identity: "field", secondary: "value" },
        (field, value) => ({ field, value }),
        (field) => ({ field, value: "" }),
      ),
    fake: () => [],
  },
  worldTimeline: {
    key: "worldTimeline",
    wireKey: "world_timeline",
    instruction:
      "world_timeline: in-world events in established order, independent of the book's telling. Value: an array of strings.",
    wireSchema: { type: "array", items: { type: "string" } },
    validate: (raw): readonly string[] => parseStringArray("worldTimeline", raw),
    fake: () => [],
  },
  bookTimeline: {
    key: "bookTimeline",
    wireKey: "book_timeline",
    instruction:
      "book_timeline: the book's events in narration order. Value: an array of strings.",
    wireSchema: { type: "array", items: { type: "string" } },
    validate: (raw): readonly string[] => parseStringArray("bookTimeline", raw),
    fake: () => [],
  },
} satisfies { readonly [K in ModelSectionKey]: BibleSectionSpec<K> };

export const BIBLE_SECTIONS: { readonly [K in ModelSectionKey]: BibleSectionSpec<K> } = REGISTRY;

/**
 * Object.keys widens to string[]; the `satisfies` above proves the registry's
 * keys are exactly ModelSectionKey, so the cast only restores that fact.
 */
export const MODEL_SECTION_KEYS = Object.keys(REGISTRY) as readonly ModelSectionKey[];

function requireSectionValue(
  payload: Record<string, unknown>,
  wireKey: string,
): unknown {
  const value = payload[wireKey];
  if (value === undefined) {
    failSection("bible", `missing section "${wireKey}"`, payload);
  }
  return value;
}

/**
 * Master monolithic validator: a flat payload of wireKey properties, unknown
 * top-level keys dropped, every section validated by its registered
 * validator, a missing section rejected. Canon-grounded sections also reject
 * values the given Story Facts do not support. Genuinely malformed or
 * ambiguous section values propagate the precise per-section rejection —
 * nothing silently reaches the bible.
 */
export function validateBible(raw: unknown, canon: StoryFacts = emptyStoryFacts()): ModelSections {
  if (!isPlainObject(raw)) {
    failSection("bible", "payload must be an object", raw);
  }
  return {
    bookOverview: BIBLE_SECTIONS.bookOverview.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.bookOverview.wireKey),
      canon,
    ),
    world: BIBLE_SECTIONS.world.validate(requireSectionValue(raw, BIBLE_SECTIONS.world.wireKey), canon),
    characterProfiles: BIBLE_SECTIONS.characterProfiles.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.characterProfiles.wireKey),
      canon,
    ),
    locationProfiles: BIBLE_SECTIONS.locationProfiles.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.locationProfiles.wireKey),
      canon,
    ),
    threadRollups: BIBLE_SECTIONS.threadRollups.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.threadRollups.wireKey),
      canon,
    ),
    groups: BIBLE_SECTIONS.groups.validate(requireSectionValue(raw, BIBLE_SECTIONS.groups.wireKey), canon),
    itemsOfSignificance: BIBLE_SECTIONS.itemsOfSignificance.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.itemsOfSignificance.wireKey),
      canon,
    ),
    lexiconNotes: BIBLE_SECTIONS.lexiconNotes.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.lexiconNotes.wireKey),
      canon,
    ),
    openLoops: BIBLE_SECTIONS.openLoops.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.openLoops.wireKey),
      canon,
    ),
    styleRollup: BIBLE_SECTIONS.styleRollup.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.styleRollup.wireKey),
      canon,
    ),
    worldTimeline: BIBLE_SECTIONS.worldTimeline.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.worldTimeline.wireKey),
      canon,
    ),
    bookTimeline: BIBLE_SECTIONS.bookTimeline.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.bookTimeline.wireKey),
      canon,
    ),
  };
}

const BIBLE_PROMPT_HEADER = [
  "You are the Story Bible synthesizer distilling graded Story Facts and chapter summaries into an author-facing bible (ADR-0007: two-layer canon).",
  "Emit exactly the requested sections; every section's value must match its documented shape precisely.",
  "Every section's content must be supported by the Story Facts as of the current ordinal — never invent plot events, threads, or status changes.",
  "An empty array (or empty overview) is valid whenever the canon establishes nothing for that section.",
].join(" ");

/** The master synthesis prompt: header plus every registered section block. */
export function bibleMasterPrompt(): string {
  return [
    BIBLE_PROMPT_HEADER,
    ...MODEL_SECTION_KEYS.map((key) => `- ${BIBLE_SECTIONS[key].instruction}`),
  ].join("\n");
}

const EMPTY_BIBLE_CONTEXT: BibleSynthesisContext = { facts: emptyStoryFacts(), summaries: [] };

/**
 * Deterministic fake dispatch across every registered section fake. The
 * default context is an empty canon, so the overview and thread-rollup fakes
 * ship their valid empty placeholders; pass the synthesis context to get the
 * canon-grounded prose baselines (issue #19).
 */
export function fakeModelSections(input: BibleSynthesisContext = EMPTY_BIBLE_CONTEXT): ModelSections {
  return {
    bookOverview: BIBLE_SECTIONS.bookOverview.fake(input),
    world: BIBLE_SECTIONS.world.fake(input),
    characterProfiles: BIBLE_SECTIONS.characterProfiles.fake(input),
    locationProfiles: BIBLE_SECTIONS.locationProfiles.fake(input),
    threadRollups: BIBLE_SECTIONS.threadRollups.fake(input),
    groups: BIBLE_SECTIONS.groups.fake(input),
    itemsOfSignificance: BIBLE_SECTIONS.itemsOfSignificance.fake(input),
    lexiconNotes: BIBLE_SECTIONS.lexiconNotes.fake(input),
    openLoops: BIBLE_SECTIONS.openLoops.fake(input),
    styleRollup: BIBLE_SECTIONS.styleRollup.fake(input),
    worldTimeline: BIBLE_SECTIONS.worldTimeline.fake(input),
    bookTimeline: BIBLE_SECTIONS.bookTimeline.fake(input),
  };
}
