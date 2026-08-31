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
 * supplies so the locations validator can reject invented places and attach
 * the authoritative co-occurrences. Not a registry concern — only the
 * synthesis path can construct this.
 */
export interface SectionGrounding {
  /**
   * Names the location facts establish; entries outside this set are
   * rejected as invented places.
   */
  readonly knownLocationNames: ReadonlySet<string>;
  /**
   * Per-location co-occurrence map: location name → the ordered list of
   * (character, ordinal) pairs the derivation produced. This is the
   * authoritative `charactersSeen` the validator attaches to every accepted
   * entry — the model's own list is discarded, never consulted.
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

/**
 * Parse the locations section, then apply the grounding rules. The model owns
 * the prose (`description`, `significance`) and the choice of which canon
 * places to describe; `charactersSeen` is a deterministic derivation, never
 * model-authored (`bible-locations.ts` is its single source of truth), so this
 * validator OVERWRITES whatever the model emitted for it with the canon-derived
 * co-occurrences — a model cannot inject a character or an ordinal the chapter
 * texts do not support. The only model-authored field still policed is the
 * place name: an entry naming a place the location facts never establish is
 * rejected. (Why the contract is overwrite-not-reproduce: docs/TESTING.md §9.7.)
 */
export function validateLocationsGrounded(
  raw: unknown,
  grounding: SectionGrounding,
): readonly LocationProfile[] {
  const entries = parseLocations(raw);
  return entries.map((entry, index) => {
    if (!grounding.knownLocationNames.has(entry.name)) {
      failGround(
        "locations",
        `entry #${index} "name" "${entry.name}" is not in canon — invented places are rejected`,
        raw,
      );
    }
    const derived = grounding.coOccurrenceByLocation.get(entry.name);
    if (derived === undefined) {
      failGround(
        "locations",
        `entry #${index} "name" "${entry.name}" has no co-occurrence derivation`,
        raw,
      );
    }
    return { ...entry, charactersSeen: derived };
  });
}
