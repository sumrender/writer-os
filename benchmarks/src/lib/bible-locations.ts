import type { LocationCharacterSeen, LocationProfile } from "./story-bible.js";
import type { StoryFacts } from "./story-facts.js";
import { namePattern } from "./text-occurrence.js";

/**
 * Deterministic per-location derivation (issue #17): for every location the
 * canon establishes, which characters appear there, and the ordinal of their
 * first co-occurrence in the chapter texts. The location facts pin which
 * places exist; the chapter texts pin which characters ever share a chapter
 * with them. Synthesis runs per ordinal — at ordinal N, only chapters 1..N
 * count, so a character's first appearance at a location can only move
 * forward across ordinals (or never be reported at all, if it never happens).
 */

/**
 * Builds the lookup the trust-boundary validator consults: location name →
 * list of (character, firstCoOccurrenceOrdinal) for every canon-established
 * character who co-occurs with the location. Locations with no co-occurring
 * character appear with an empty list, so the validator can distinguish
 * "location has no co-occurrences in the canon" (entry is `[]`) from "location
 * has no derivation entry at all" (`undefined` from the map — a fabrication
 * trigger).
 */
export function coOccurrenceByLocation(
  profiles: readonly LocationProfile[],
): ReadonlyMap<string, readonly LocationCharacterSeen[]> {
  const map = new Map<string, readonly LocationCharacterSeen[]>();
  for (const profile of profiles) {
    map.set(profile.name, profile.charactersSeen);
  }
  return map;
}

export interface DeriveLocationProfilesInput {
  readonly facts: StoryFacts;
  /** Chapter texts in ordinal order (1..N); the index + 1 is the ordinal. */
  readonly chapterTexts: readonly string[];
}

/**
 * Derivation port: pure function from canon + chapter texts to per-location
 * profiles. The fake synthesizer and the real synthesizer both ground their
 * `locations` section through this same function so the two paths agree on
 * what the canon supports (Liskov — same contract, same output shape).
 */
export type DeriveLocationProfiles = (input: DeriveLocationProfilesInput) => readonly LocationProfile[];

export function deriveLocationProfiles({
  facts,
  chapterTexts,
}: DeriveLocationProfilesInput): readonly LocationProfile[] {
  return facts.locations.map((location): LocationProfile => {
    const charactersSeen: LocationCharacterSeen[] = [];
    for (const character of facts.characters) {
      const ordinal = firstCoOccurrenceOrdinal(chapterTexts, character.name, location.name);
      if (ordinal !== undefined) {
        charactersSeen.push({ character: character.name, firstCoOccurrenceOrdinal: ordinal });
      }
    }
    return {
      name: location.name,
      description: "",
      significance: "",
      charactersSeen,
    };
  });
}

/**
 * The first chapter ordinal (1-based) at which both `character` and `location`
 * names appear in the same chapter text. Returns `undefined` when the pair
 * never co-occurs. `namePattern` allocates a fresh `RegExp` per call so the
 * global `lastIndex` from a previous chapter cannot leak across the loop —
 * the carry-over would zero the next chapter's match attempt once one chapter
 * had a hit.
 */
function firstCoOccurrenceOrdinal(
  chapterTexts: readonly string[],
  character: string,
  location: string,
): number | undefined {
  for (let index = 0; index < chapterTexts.length; index += 1) {
    const text = chapterTexts[index];
    if (text === undefined) continue;
    if (namePattern(character).test(text) && namePattern(location).test(text)) {
      return index + 1;
    }
  }
  return undefined;
}

/**
 * Builds a location → name lookup set the trust-boundary validator uses to
 * reject invented places; pure type-narrowing helper so the validator does
 * not need to know the underlying facts shape.
 */
export function knownLocationNames(facts: StoryFacts): ReadonlySet<string> {
  return new Set(facts.locations.map((location) => location.name));
}

/** Same as {@link knownLocationNames} but for the character kind — the
 * validator needs both sets to reject invented names on either side. */
export function knownCharacterNames(facts: StoryFacts): ReadonlySet<string> {
  return new Set(facts.characters.map((character) => character.name));
}
