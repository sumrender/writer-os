import {
  failSection,
  isPlainObject,
  nonEmptyString,
  positiveInt,
} from "./schema-primitives.js";
import {
  THREAD_STATUSES,
  factCount,
  isThreadStatus,
  type StoryFacts,
} from "./story-facts.js";
import type { SectionWireSchema } from "./section-wire.js";
import { fakeCharacterProfiles, validateCharacterProfiles } from "./character-profiles.js";
import {
  WORLD_INSTRUCTION,
  WORLD_WIRE_SCHEMA,
  fakeWorld,
  validateWorld,
} from "./world-section.js";
import { fakeBookOverview, fakeThreadRollups, threadStatusAssertions } from "./bible-fakes.js";
import type {
  BookOverview,
  BookTimelineEntry,
  LexiconNote,
  LocationCharacterSeen,
  LocationProfile,
  ModelSectionKey,
  ModelSections,
  NamedDescription,
  OpenLoop,
  SectionCanon,
  StyleField,
  ThreadRollup,
  TimelineGrounding,
  WorldSection,
  WorldTimelineEvent,
} from "./story-bible.js";
import { TIMELINE_GROUNDINGS } from "./story-bible.js";

/**
 * Composition machinery for Story Bible synthesis (issue #14, #17, #19): the
 * registry through which every aspect contributes its section's prompt block,
 * wire shape, validator, and deterministic fake. The master prompt assembles
 * the per-section blocks; the master `validateBible` delegates per-section
 * validation; the deterministic fake dispatches per-section fakes. Validators
 * and fakes see the section canon (facts + summaries so far, issue #15), so
 * aspects ground their sections — e.g. character profiles reject unsourced
 * entities — and fakes populate from the same canon. The overview and
 * thread-rollup sections (issue #19) carry canon-grounded validators and
 * fakes. Aspects grow the bible by adding registry entries — the machinery
 * itself never edits a stable core per section (CODING_STANDARDS §3.2).
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
   * issue #16: unsupported world deviations; issue #19: invented threads and
   * status changes without a basis in the fact layer); sections needing no
   * check ignore it. The locations section (issue #17) stays pure-shape here:
   * its grounding consults the raw chapter texts, which the section canon
   * deliberately excludes, so the synthesis caller layers the grounding
   * checks on top (see `grounded-locations.ts`).
   */
  readonly validate: (raw: unknown, canon: SectionCanon) => ModelSections[K];
  /**
   * Deterministic fake seen through the section canon: an EMPTY placeholder
   * whenever the canon establishes nothing, canon-grounded content otherwise
   * (e.g. World, issue #16, derives even from bare canon; the overview and
   * thread rollups, issue #19).
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

function isTimelineGrounding(value: unknown): value is TimelineGrounding {
  return typeof value === "string" && (TIMELINE_GROUNDINGS as readonly string[]).includes(value);
}

/**
 * Strict structural validation for the `locations` section (issue #17).
 * Pure shape: no grounding context consulted. The grounding-aware variant
 * lives in `grounded-locations.ts` and imports this parser.
 */
export function parseLocations(raw: unknown): readonly LocationProfile[] {
  if (!Array.isArray(raw)) {
    failSection("locations", "must be an array of {name, description, significance, charactersSeen} entries", raw);
  }
  return raw.map((entry, index): LocationProfile => {
    if (!isPlainObject(entry)) {
      failSection(
        "locations",
        `entry #${index} must be an object with a non-empty "name"`,
        entry,
      );
    }
    const name = entry["name"];
    if (!nonEmptyString(name)) {
      failSection("locations", `entry #${index} "name" must be a non-empty string`, entry);
    }
    const description = entry["description"];
    if (!nonEmptyString(description)) {
      failSection("locations", `entry #${index} "description" must be a non-empty string`, entry);
    }
    const significance = entry["significance"];
    if (!nonEmptyString(significance)) {
      failSection("locations", `entry #${index} "significance" must be a non-empty string`, entry);
    }
    const charactersSeenRaw = entry["charactersSeen"];
    if (!Array.isArray(charactersSeenRaw)) {
      failSection(
        "locations",
        `entry #${index} "charactersSeen" must be an array of {character, firstCoOccurrenceOrdinal} entries`,
        entry,
      );
    }
    const charactersSeen: LocationCharacterSeen[] = charactersSeenRaw.map((seen, seenIndex) => {
      if (!isPlainObject(seen)) {
        failSection(
          "locations",
          `entry #${index} "charactersSeen" #${seenIndex} must be an object`,
          seen,
        );
      }
      const character = seen["character"];
      if (!nonEmptyString(character)) {
        failSection(
          "locations",
          `entry #${index} "charactersSeen" #${seenIndex} "character" must be a non-empty string`,
          seen,
        );
      }
      const firstCoOccurrenceOrdinal = seen["firstCoOccurrenceOrdinal"];
      if (!positiveInt(firstCoOccurrenceOrdinal)) {
        failSection(
          "locations",
          `entry #${index} "charactersSeen" #${seenIndex} "firstCoOccurrenceOrdinal" must be a positive integer`,
          seen,
        );
      }
      return { character, firstCoOccurrenceOrdinal };
    });
    return { name, description, significance, charactersSeen };
  });
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
      assertBookOverviewGrounded(overview, canon.facts);
      return overview;
    },
    fake: ({ facts }) => fakeBookOverview(facts),
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
  locations: {
    key: "locations",
    wireKey: "locations",
    instruction:
      "locations: per-location bible entries drawn from canon. Value: an array of {name, description, significance, charactersSeen} objects. Emit one entry for each location the Story Facts establish, with a description and narrative significance grounded in the canon. The charactersSeen list is derived from the chapter texts by the system, not authored here — emit an empty array for it.",
    wireSchema: { type: "array", items: { type: "object" } },
    validate: (raw): readonly LocationProfile[] => parseLocations(raw),
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
      assertThreadRollupsGrounded(rollups, canon.facts);
      return rollups;
    },
    fake: (canon) => fakeThreadRollups(canon),
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
    fake: ({ facts }): readonly NamedDescription[] =>
      facts.items.map((entry) => ({
        name: entry.item,
        description: `Canon holds "${entry.item}" with "${entry.holder}".`,
      })),
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
    fake: ({ facts }): readonly LexiconNote[] =>
      facts.lexicon.map((entry) => ({
        term: entry.term,
        note: entry.lockedSpelling ? "Spelling locked by canon." : "",
      })),
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
    fake: ({ facts }): readonly StyleField[] =>
      facts.style.map((entry) => ({ field: entry.field, value: entry.value })),
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
 * validator against the section canon, a missing section rejected.
 * Genuinely malformed, ambiguous, or unsourced (e.g. a character profile
 * introducing an entity canon never establishes, a world deviation no
 * canon world rule supports, or a thread rollup contradicting the fact
 * layer) section values propagate the precise
 * per-section rejection — nothing silently reaches the bible. The locations
 * section's chapter-text grounding is NOT applied here (the canon cannot see
 * chapter texts): synthesis callers layer it via `grounded-locations.ts`
 * (issue #17).
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
    locations: BIBLE_SECTIONS.locations.validate(
      requireSectionValue(raw, BIBLE_SECTIONS.locations.wireKey),
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
  "Every section's content must be supported by the Story Facts as of the current ordinal — never invent plot events, threads, or status changes.",
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
 * canon; issue #19: the overview and thread rollups; issue #21: the items,
 * lexicon, and style rollups, each a direct 1:1 rendering of its fact kind).
 */
export function fakeModelSections(canon: SectionCanon): ModelSections {
  return {
    bookOverview: BIBLE_SECTIONS.bookOverview.fake(canon),
    world: BIBLE_SECTIONS.world.fake(canon),
    characterProfiles: BIBLE_SECTIONS.characterProfiles.fake(canon),
    locations: BIBLE_SECTIONS.locations.fake(canon),
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
