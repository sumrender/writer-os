import type { LocationCharacterSeen, LocationProfile } from "./story-bible.js";
import { parseLocations } from "./bible-sections.js";

/**
 * Grounding-aware validator for the `locations` section (issue #17): the
 * pure-shape parser in `bible-sections.ts` is shared with the trust boundary;
 * this module wraps it with the extra rejections a caller with the canon in
 * hand can apply. Owned by the synthesis caller (`agnes-synthesize.ts`),
 * which builds the grounding context from `bible-locations.ts`'s derivation
 * — the composition machinery itself stays pure-shape.
 */

/**
 * The grounding context: the canon-derived lookups a synthesis caller
 * supplies so the locations validator can reject content that is
 * structurally well-formed but unsupported by the canon. Not a registry
 * concern — only the synthesis path can construct this.
 */
export interface SectionGrounding {
  /**
   * Names the location facts establish; entries outside this set are
   * rejected as invented places.
   */
  readonly knownLocationNames: ReadonlySet<string>;
  /** Names the character facts establish. */
  readonly knownCharacterNames: ReadonlySet<string>;
  /**
   * Per-location co-occurrence map: location name → the ordered list of
   * (character, ordinal) pairs the derivation produced. Used to confirm the
   * validator's ordinal agrees with what the chapter texts say; a mismatch
   * is rejected as fabrication.
   */
  readonly coOccurrenceByLocation: ReadonlyMap<string, readonly LocationCharacterSeen[]>;
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

function failGround(where: string, problem: string, raw: unknown): never {
  throw new Error(`${where}: ${problem} near: ${snippet(raw)}`);
}

function charactersByName(
  seen: readonly LocationCharacterSeen[],
): ReadonlyMap<string, number> {
  return new Map(seen.map((entry) => [entry.character, entry.firstCoOccurrenceOrdinal]));
}

/**
 * Parse the locations section, then run the grounding rejections: invented
 * places, invented characters, characters declared who never co-occur,
 * mismatched first-co-occurrence ordinals, omitted co-occurrences, locations
 * present in canon but absent from the derivation (a fabrication trigger —
 * the derivation runs against every canon location).
 */
export function validateLocationsGrounded(
  raw: unknown,
  grounding: SectionGrounding,
): readonly LocationProfile[] {
  const entries = parseLocations(raw);
  for (const [index, entry] of entries.entries()) {
    if (!grounding.knownLocationNames.has(entry.name)) {
      failGround(
        "locations",
        `entry #${index} "name" "${entry.name}" is not in canon — invented places are rejected`,
        raw,
      );
    }
    const expected = grounding.coOccurrenceByLocation.get(entry.name);
    if (expected === undefined) {
      failGround(
        "locations",
        `entry #${index} "name" "${entry.name}" has no co-occurrence derivation`,
        raw,
      );
    }
    const expectedByCharacter = charactersByName(expected);
    const declaredByCharacter = charactersByName(entry.charactersSeen);
    for (const [character, declaredOrdinal] of declaredByCharacter) {
      if (!grounding.knownCharacterNames.has(character)) {
        failGround(
          "locations",
          `entry #${index} "charactersSeen" includes "${character}" — not a canon character`,
          raw,
        );
      }
      const expectedOrdinal = expectedByCharacter.get(character);
      if (expectedOrdinal === undefined) {
        failGround(
          "locations",
          `entry #${index} "${character}" never appears at "${entry.name}" in the chapter texts`,
          raw,
        );
      }
      if (declaredOrdinal !== expectedOrdinal) {
        failGround(
          "locations",
          `entry #${index} "${character}" first co-occurs at chapter ${expectedOrdinal} in the chapter texts but the entry says ${declaredOrdinal}`,
          raw,
        );
      }
    }
    for (const character of expectedByCharacter.keys()) {
      if (!declaredByCharacter.has(character)) {
        failGround(
          "locations",
          `entry #${index} omits "${character}" who co-occurs at "${entry.name}" in the chapter texts`,
          raw,
        );
      }
    }
  }
  return entries;
}
