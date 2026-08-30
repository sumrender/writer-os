import { isPlainObject, nonEmptyString, positiveInt } from "./schema-primitives.js";
import { THREAD_STATUSES, type ThreadStatus } from "./story-facts.js";
import type {
  BookTimelineEntry,
  LexiconNote,
  ModelSectionKey,
  ModelSections,
  NamedDescription,
  OpenLoop,
  ProfileEntry,
  StyleField,
  ThreadRollup,
  TimelineGrounding,
  WorldNote,
  WorldTimelineEvent,
} from "./story-bible.js";
import { TIMELINE_GROUNDINGS } from "./story-bible.js";

/**
 * Composition machinery for Story Bible synthesis (issue #14, ADR-0007): the
 * registry through which every aspect contributes its section's prompt block,
 * wire shape, validator, and deterministic fake. The master prompt assembles
 * the per-section blocks; the master `validateBible` delegates per-section
 * validation; the deterministic fake dispatches per-section fakes. Aspects
 * grow the bible by adding registry entries — the machinery itself never
 * edits a stable core per section (CODING_STANDARDS §3.2).
 */

/** Tool-schema shape of one section's value on the synthesis wire. */
export type SectionWireSchema =
  | { readonly type: "string" }
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
   */
  readonly validate: (raw: unknown) => ModelSections[K];
  /** Deterministic baseline fake: a valid EMPTY placeholder. */
  readonly fake: () => ModelSections[K];
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

function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === "string" && (THREAD_STATUSES as readonly string[]).includes(value);
}

function isTimelineGrounding(value: unknown): value is TimelineGrounding {
  return typeof value === "string" && (TIMELINE_GROUNDINGS as readonly string[]).includes(value);
}

const REGISTRY = {
  bookOverview: {
    key: "bookOverview",
    wireKey: "book_overview",
    instruction:
      "book_overview: a one-paragraph overview of the whole book so far — premise, stakes, and where the story now stands. Value: a single string.",
    wireSchema: { type: "string" },
    validate: (raw): string =>
      typeof raw === "string" ? raw : failSection("bookOverview", "must be a string", raw),
    fake: () => "",
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
      "thread_rollups: per-thread status rollups. Value: an array of {thread, status, rollup} objects where status is one of open, resolved, dormant.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly ThreadRollup[] =>
      parseObjectArray<ThreadRollup>(
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
      ),
    fake: () => [],
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
      "world_timeline: in-world events in established chronological order, independent of the book's telling. Value: an array of {event, grounding} objects where grounding is one of stated, inferred.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly WorldTimelineEvent[] => {
      if (!Array.isArray(raw)) {
        failSection("worldTimeline", "must be an array of {event, grounding} entries", raw);
      }
      return raw.map((entry, index): WorldTimelineEvent => {
        if (!isPlainObject(entry)) {
          failSection("worldTimeline", `entry #${index} must be an object`, entry);
        }
        const event = entry["event"];
        if (!nonEmptyString(event)) {
          failSection("worldTimeline", `entry #${index} "event" must be a non-empty string`, entry);
        }
        const grounding = entry["grounding"];
        if (!isTimelineGrounding(grounding)) {
          failSection(
            "worldTimeline",
            `entry #${index} "grounding" must be one of ${TIMELINE_GROUNDINGS.join(", ")}`,
            entry,
          );
        }
        return { event, grounding };
      });
    },
    fake: () => [],
  },
  bookTimeline: {
    key: "bookTimeline",
    wireKey: "book_timeline",
    instruction:
      "book_timeline: the book's events mapped to chapter ordinals in narration order. Value: an array of {ordinal, events} objects where ordinal is the chapter ordinal and events is an array of strings.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly BookTimelineEntry[] => {
      if (!Array.isArray(raw)) {
        failSection("bookTimeline", "must be an array of {ordinal, events} entries", raw);
      }
      return raw.map((entry, index): BookTimelineEntry => {
        if (!isPlainObject(entry)) {
          failSection("bookTimeline", `entry #${index} must be an object`, entry);
        }
        const ordinal = entry["ordinal"];
        if (!positiveInt(ordinal)) {
          failSection("bookTimeline", `entry #${index} "ordinal" must be a positive integer`, entry);
        }
        const eventsRaw = entry["events"];
        const events = parseStringArray(`bookTimeline[${ordinal}]events`, eventsRaw);
        return { ordinal, events };
      });
    },
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
 * validator, a missing section rejected. Genuinely malformed or ambiguous
 * section values propagate the precise per-section rejection — nothing
 * silently reaches the bible.
 */
export function validateBible(raw: unknown): ModelSections {
  if (!isPlainObject(raw)) {
    failSection("bible", "payload must be an object", raw);
  }
  return {
    bookOverview: BIBLE_SECTIONS.bookOverview.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.bookOverview.wireKey),
    ),
    world: BIBLE_SECTIONS.world.validate(requireSectionValue(raw, BIBLE_SECTIONS.world.wireKey)),
    characterProfiles: BIBLE_SECTIONS.characterProfiles.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.characterProfiles.wireKey),
    ),
    locationProfiles: BIBLE_SECTIONS.locationProfiles.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.locationProfiles.wireKey),
    ),
    threadRollups: BIBLE_SECTIONS.threadRollups.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.threadRollups.wireKey),
    ),
    groups: BIBLE_SECTIONS.groups.validate(requireSectionValue(raw, BIBLE_SECTIONS.groups.wireKey)),
    itemsOfSignificance: BIBLE_SECTIONS.itemsOfSignificance.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.itemsOfSignificance.wireKey),
    ),
    lexiconNotes: BIBLE_SECTIONS.lexiconNotes.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.lexiconNotes.wireKey),
    ),
    openLoops: BIBLE_SECTIONS.openLoops.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.openLoops.wireKey),
    ),
    styleRollup: BIBLE_SECTIONS.styleRollup.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.styleRollup.wireKey),
    ),
    worldTimeline: BIBLE_SECTIONS.worldTimeline.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.worldTimeline.wireKey),
    ),
    bookTimeline: BIBLE_SECTIONS.bookTimeline.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.bookTimeline.wireKey),
    ),
  };
}

const BIBLE_PROMPT_HEADER = [
  "You are the Story Bible synthesizer distilling graded Story Facts and chapter summaries into an author-facing bible (ADR-0007: two-layer canon).",
  "Emit exactly the requested sections; every section's value must match its documented shape precisely.",
  "An empty array (or empty overview) is valid whenever the canon establishes nothing for that section — never invent content.",
].join(" ");

/** The master synthesis prompt: header plus every registered section block. */
export function bibleMasterPrompt(): string {
  return [
    BIBLE_PROMPT_HEADER,
    ...MODEL_SECTION_KEYS.map((key) => `- ${BIBLE_SECTIONS[key].instruction}`),
  ].join("\n");
}

/** Deterministic fake dispatch across every registered section fake. */
export function fakeModelSections(): ModelSections {
  return {
    bookOverview: BIBLE_SECTIONS.bookOverview.fake(),
    world: BIBLE_SECTIONS.world.fake(),
    characterProfiles: BIBLE_SECTIONS.characterProfiles.fake(),
    locationProfiles: BIBLE_SECTIONS.locationProfiles.fake(),
    threadRollups: BIBLE_SECTIONS.threadRollups.fake(),
    groups: BIBLE_SECTIONS.groups.fake(),
    itemsOfSignificance: BIBLE_SECTIONS.itemsOfSignificance.fake(),
    lexiconNotes: BIBLE_SECTIONS.lexiconNotes.fake(),
    openLoops: BIBLE_SECTIONS.openLoops.fake(),
    styleRollup: BIBLE_SECTIONS.styleRollup.fake(),
    worldTimeline: BIBLE_SECTIONS.worldTimeline.fake(),
    bookTimeline: BIBLE_SECTIONS.bookTimeline.fake(),
  };
}
