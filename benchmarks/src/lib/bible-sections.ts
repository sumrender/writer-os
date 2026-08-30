import {
  failSection,
  isPlainObject,
  nonEmptyString,
  positiveInt,
} from "./schema-primitives.js";
import { THREAD_STATUSES, type ThreadStatus } from "./story-facts.js";
import type { SectionWireSchema } from "./section-wire.js";
import { fakeCharacterProfiles, validateCharacterProfiles } from "./character-profiles.js";
import {
  WORLD_INSTRUCTION,
  WORLD_WIRE_SCHEMA,
  fakeWorld,
  validateWorld,
} from "./world-section.js";
import type {
  LexiconNote,
  ModelSectionKey,
  ModelSections,
  NamedDescription,
  OpenLoop,
  ProfileEntry,
  SectionCanon,
  StyleField,
  ThreadRollup,
  WorldSection,
} from "./story-bible.js";

/**
 * Composition machinery for Story Bible synthesis (issue #14, ADR-0007): the
 * registry through which every aspect contributes its section's prompt block,
 * wire shape, validator, and deterministic fake. The master prompt assembles
 * the per-section blocks; the master `validateBible` delegates per-section
 * validation; the deterministic fake dispatches per-section fakes. Validators
 * and fakes see the section canon (facts + summaries so far, issue #15), so
 * aspects ground their sections — e.g. character profiles reject unsourced
 * entities — and fakes populate from the same canon. Aspects grow the bible
 * by adding registry entries — the machinery itself never edits a stable core
 * per section (CODING_STANDARDS §3.2).
 */

/**
 * Tool-schema shape of one section's value on the synthesis wire. Lives in
 * `section-wire.ts` so section modules (e.g. World) can type their schema
 * against it without importing this module's values back (one-way deps).
 */
export type { SectionWireSchema } from "./section-wire.js";

export interface BibleSectionSpec<K extends ModelSectionKey> {
  readonly key: K;
  /** snake_case property key on the monolithic wire payload. */
  readonly wireKey: string;
  /** The prompt block contributed for this section. */
  readonly instruction: string;
  readonly wireSchema: SectionWireSchema;
  /**
   * Trust-boundary validation against the section canon: returns the
   * precisely-typed section value or throws with a `near:` raw-payload
   * snippet. Unknown fields are dropped, recoverable shapes normalized,
   * missing/ambiguous shapes rejected. Sections ground against the canon to
   * reject content it does not support (issue #15: unsourced characters;
   * issue #16: unsupported world deviations); sections needing no check
   * ignore it.
   */
  readonly validate: (raw: unknown, canon: SectionCanon) => ModelSections[K];
  /**
   * Deterministic fake seen through the section canon: an EMPTY placeholder
   * whenever the canon establishes nothing, canon-grounded content otherwise
   * (e.g. World, issue #16, derives even from bare canon).
   */
  readonly fake: (canon: SectionCanon) => ModelSections[K];
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
    instruction: WORLD_INSTRUCTION,
    wireSchema: WORLD_WIRE_SCHEMA,
    validate: (raw, canon): WorldSection => validateWorld(raw, canon.facts),
    fake: (canon): WorldSection => fakeWorld(canon),
  },
  characterProfiles: {
    key: "characterProfiles",
    wireKey: "character_profiles",
    instruction: [
      "character_profiles: one profile per established character, distilled from Story Facts and chapter summaries — never from the chapter text alone.",
      "Value: an array of {name, appearance, personality, definingTraits, background, arc, firstAppearanceOrdinal, mentionOrdinals, relationships} objects where",
      "appearance/personality/background/arc are prose (leave a field empty only when the canon establishes nothing for it),",
      "definingTraits is an array of short trait strings, firstAppearanceOrdinal is the first chapter ordinal mentioning the character,",
      "mentionOrdinals is the ascending list of chapter ordinals mentioning the character (it must include firstAppearanceOrdinal),",
      "and relationships is an array of {other, summary} objects — other is the counterpart's exact canon name and summary is the relationship in prose.",
      "Every established character needs exactly one profile; never introduce a name the canon does not establish.",
    ].join(" "),
    wireSchema: { type: "array", items: { type: "object" } },
    validate: validateCharacterProfiles,
    fake: fakeCharacterProfiles,
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
 * validator against the section canon, a missing section rejected.
 * Genuinely malformed, ambiguous, or unsourced (e.g. a character profile
 * introducing an entity canon never establishes, or a world deviation no
 * canon world rule supports) section values propagate the precise
 * per-section rejection — nothing silently reaches the bible.
 */
export function validateBible(raw: unknown, canon: SectionCanon): ModelSections {
  if (!isPlainObject(raw)) {
    failSection("bible", "payload must be an object", raw);
  }
  return {
    bookOverview: BIBLE_SECTIONS.bookOverview.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.bookOverview.wireKey),
      canon,
    ),
    world: BIBLE_SECTIONS.world.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.world.wireKey),
      canon,
    ),
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
    groups: BIBLE_SECTIONS.groups.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.groups.wireKey),
      canon,
    ),
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
  "An empty array (or empty overview) is valid whenever the canon establishes nothing for that section — never invent content.",
].join(" ");

/** The master synthesis prompt: header plus every registered section block. */
export function bibleMasterPrompt(): string {
  return [
    BIBLE_PROMPT_HEADER,
    ...MODEL_SECTION_KEYS.map((key) => `- ${BIBLE_SECTIONS[key].instruction}`),
  ].join("\n");
}

/**
 * Deterministic fake dispatch across every registered section fake, seen
 * through the section canon: sections the canon establishes nothing for
 * ship valid empty placeholders; grounded sections populate (issue #15:
 * character profiles; issue #16: the world, which derives even from bare
 * canon).
 */
export function fakeModelSections(canon: SectionCanon): ModelSections {
  return {
    bookOverview: BIBLE_SECTIONS.bookOverview.fake(canon),
    world: BIBLE_SECTIONS.world.fake(canon),
    characterProfiles: BIBLE_SECTIONS.characterProfiles.fake(canon),
    locationProfiles: BIBLE_SECTIONS.locationProfiles.fake(canon),
    threadRollups: BIBLE_SECTIONS.threadRollups.fake(canon),
    groups: BIBLE_SECTIONS.groups.fake(canon),
    itemsOfSignificance: BIBLE_SECTIONS.itemsOfSignificance.fake(canon),
    lexiconNotes: BIBLE_SECTIONS.lexiconNotes.fake(canon),
    openLoops: BIBLE_SECTIONS.openLoops.fake(canon),
    styleRollup: BIBLE_SECTIONS.styleRollup.fake(canon),
    worldTimeline: BIBLE_SECTIONS.worldTimeline.fake(canon),
    bookTimeline: BIBLE_SECTIONS.bookTimeline.fake(canon),
  };
}
