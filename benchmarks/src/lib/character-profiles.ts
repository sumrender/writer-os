import { failSection, isPlainObject, nonEmptyString, positiveInt } from "./schema-primitives.js";
import { wholeNameRegExp } from "./name-text.js";
import type { CharacterProfile, CharacterRelationship, SectionCanon } from "./story-bible.js";
import type { StoryFacts } from "./story-facts.js";

/**
 * The character-profile slice of the Story Bible (issue #15): the section's
 * trust-boundary validator and its deterministic fake generator, registered
 * with the composition machinery in `bible-sections.ts`.
 *
 * Both sides derive profiles from Story Facts and chapter summaries, never
 * from the chapter text alone: the validator rejects profiles that introduce
 * unsourced entities (names the canon never establishes) and enforces the
 * ordinal contract; the fake distills the same canon deterministically —
 * appearance prose and traits from appearance facts, relationship prose from
 * relationship facts, mention ordinals from whole-name scans over the
 * summaries. Prose aspects no fact kind establishes (personality, background,
 * arc) stay empty in the fake: the fake is rule-based, not semantic, and
 * invents nothing.
 */

/** The registry key this slice owns — every rejection names it. */
const SECTION = "characterProfiles";

/** Every person name the canon establishes on any fact edge (DRY: one set). */
function establishedPersonNames(facts: StoryFacts): ReadonlySet<string> {
  const names = new Set<string>();
  for (const character of facts.characters) names.add(character.name);
  for (const appearance of facts.appearances) names.add(appearance.character);
  for (const relationship of facts.relationships) {
    names.add(relationship.from);
    names.add(relationship.to);
  }
  for (const item of facts.items) names.add(item.holder);
  return names;
}

function chapterCount(canon: SectionCanon): number {
  return canon.chapterSummaries.length;
}

/** Prose distillation of a character's canon appearance facts. */
function appearanceProse(facts: StoryFacts, name: string): string {
  const lines = facts.appearances
    .filter((appearance) => appearance.character === name)
    .map((appearance) => `${appearance.attribute}: ${appearance.contains}`);
  return lines.length === 0 ? "" : `${lines.join("; ")}.`;
}

/** The attributes the character "is known for" — canon's defining traits. */
function definingTraits(facts: StoryFacts, name: string): readonly string[] {
  return [
    ...new Set(
      facts.appearances
        .filter((appearance) => appearance.character === name)
        .map((appearance) => appearance.attribute),
    ),
  ];
}

/** Prose-form summaries of every canon relationship fact involving the character. */
function relationshipSummaries(
  facts: StoryFacts,
  name: string,
): readonly CharacterRelationship[] {
  const summaries: CharacterRelationship[] = [];
  for (const relationship of facts.relationships) {
    if (relationship.from === name) {
      summaries.push({
        other: relationship.to,
        summary: `${name} is the ${relationship.relationType} of ${relationship.to}.`,
      });
    } else if (relationship.to === name) {
      summaries.push({
        other: relationship.from,
        summary: `${relationship.from} is the ${relationship.relationType} of ${name}.`,
      });
    }
  }
  return summaries;
}

/** Ordinals whose summary mentions the character, ascending and unique. */
function summaryMentionOrdinals(canon: SectionCanon, name: string): readonly number[] {
  const pattern = wholeNameRegExp(name);
  return [...new Set(
    canon.chapterSummaries
      .filter((summary) => pattern.test(summary.summary))
      .map((summary) => summary.ordinal),
  )].sort((a, b) => a - b);
}

/** The trust-boundary validator for the `characterProfiles` section. */
export function validateCharacterProfiles(
  raw: unknown,
  canon: SectionCanon,
): readonly CharacterProfile[] {
  if (!Array.isArray(raw)) {
    failSection(SECTION, "must be an array of character profile entries", raw);
  }
  const established = establishedPersonNames(canon.facts);
  const maxOrdinal = chapterCount(canon);

  const profiles = raw.map((entry, index): CharacterProfile => {
    if (!isPlainObject(entry)) {
      failSection(
        SECTION,
        `entry #${index} must be an object with a non-empty "name"`,
        entry,
      );
    }
    const name = entry["name"];
    if (!nonEmptyString(name)) {
      failSection(SECTION, `entry #${index} "name" must be a non-empty string`, entry);
    }
    if (!established.has(name)) {
      failSection(
        SECTION,
        `entry #${index} introduces unsourced character "${name}"`,
        entry,
      );
    }

    const firstAppearanceOrdinal = entry["firstAppearanceOrdinal"];
    if (!positiveInt(firstAppearanceOrdinal)) {
      failSection(
        SECTION,
        `entry #${index} "firstAppearanceOrdinal" must be a positive integer`,
        entry,
      );
    }
    if (firstAppearanceOrdinal > maxOrdinal) {
      failSection(
        SECTION,
        `entry #${index} "firstAppearanceOrdinal" must be a chapter ordinal within 1..${maxOrdinal}`,
        entry,
      );
    }

    const rawMentions = entry["mentionOrdinals"];
    if (!Array.isArray(rawMentions)) {
      failSection(
        SECTION,
        `entry #${index} "mentionOrdinals" must be an array of chapter ordinals`,
        entry,
      );
    }
    for (const mention of rawMentions) {
      if (!positiveInt(mention) || mention > maxOrdinal) {
        failSection(
          SECTION,
          `entry #${index} "mentionOrdinals" entries must be chapter ordinals within 1..${maxOrdinal}`,
          entry,
        );
      }
    }
    // Sorted+deduped order is recoverable normalization; absence is not.
    const mentionOrdinals = [...new Set<number>(rawMentions)].sort((a, b) => a - b);
    if (mentionOrdinals.length === 0) {
      failSection(
        SECTION,
        `entry #${index} "mentionOrdinals" must not be empty for an established character`,
        entry,
      );
    }
    if (!mentionOrdinals.includes(firstAppearanceOrdinal)) {
      failSection(
        SECTION,
        `entry #${index} "mentionOrdinals" must include firstAppearanceOrdinal`,
        entry,
      );
    }

    const rawTraits = entry["definingTraits"] ?? [];
    if (!Array.isArray(rawTraits)) {
      failSection(
        SECTION,
        `entry #${index} "definingTraits" must be an array of non-empty strings`,
        entry,
      );
    }
    for (const trait of rawTraits) {
      if (!nonEmptyString(trait)) {
        failSection(
          SECTION,
          `entry #${index} "definingTraits" entries must be non-empty strings`,
          entry,
        );
      }
    }

    const rawRelationships = entry["relationships"] ?? [];
    if (!Array.isArray(rawRelationships)) {
      failSection(
        SECTION,
        `entry #${index} "relationships" must be an array of {other, summary} entries`,
        entry,
      );
    }
    const relationships = rawRelationships.map((rel): CharacterRelationship => {
      if (!isPlainObject(rel)) {
        failSection(
          SECTION,
          `entry #${index} "relationships" entries must be objects`,
          rel,
        );
      }
      const other = rel["other"];
      if (!nonEmptyString(other)) {
        failSection(
          SECTION,
          `entry #${index} "relationships" "other" must be a non-empty string`,
          rel,
        );
      }
      if (!established.has(other)) {
        failSection(
          SECTION,
          `entry #${index} introduces unsourced relationship partner "${other}"`,
          rel,
        );
      }
      const summary = rel["summary"];
      if (!nonEmptyString(summary)) {
        failSection(
          SECTION,
          `entry #${index} "relationships" "summary" must be a non-empty string`,
          rel,
        );
      }
      return { other, summary };
    });

    // Missing prose normalizes to "" — canon may establish nothing for an
    // aspect, and forcing prose would invite fabrication.
    const prose = (field: string): string => {
      const value = entry[field];
      return nonEmptyString(value) ? value : "";
    };

    return {
      name,
      appearance: prose("appearance"),
      personality: prose("personality"),
      definingTraits: [...rawTraits],
      background: prose("background"),
      arc: prose("arc"),
      firstAppearanceOrdinal,
      mentionOrdinals,
      relationships,
    };
  });

  // Coverage: the section synthesizes a profile for every established
  // character, exactly once.
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.name)) {
      failSection(SECTION, `duplicate profile for "${profile.name}"`, profiles);
    }
    seen.add(profile.name);
  }
  for (const character of canon.facts.characters) {
    if (!seen.has(character.name)) {
      failSection(
        SECTION,
        `missing profile for established character "${character.name}"`,
        profiles,
      );
    }
  }

  return profiles;
}

/** The deterministic fake generator for the `characterProfiles` section. */
export function fakeCharacterProfiles(canon: SectionCanon): readonly CharacterProfile[] {
  return canon.facts.characters.map((character): CharacterProfile => {
    const mentionOrdinals = summaryMentionOrdinals(canon, character.name);
    return {
      name: character.name,
      appearance: appearanceProse(canon.facts, character.name),
      personality: "",
      definingTraits: definingTraits(canon.facts, character.name),
      background: "",
      arc: "",
      // A character fact is always established by some chapter, so its
      // summary scan is non-empty for every canon the Synthesize port can
      // produce (summaries cover ordinals 1..N); the fallback only serves
      // hand-built canon outside that contract.
      firstAppearanceOrdinal: mentionOrdinals[0] ?? 1,
      mentionOrdinals,
      relationships: relationshipSummaries(canon.facts, character.name),
    };
  });
}
