import { isPlainObject, nonEmptyString } from "./schema-primitives.js";
import { failSection } from "./section-errors.js";
import type { StoryFacts } from "./story-facts.js";
import type { BibleSynthesisInput } from "./pipeline.js";
import {
  WORLD_CLASSIFICATIONS,
  WORLD_RULE_RELATIONS,
  type WorldClassification,
  type WorldRule,
  type WorldRuleRelation,
  type WorldSection,
} from "./story-bible.js";
import type { SectionWireSchema } from "./section-wire.js";

/**
 * The World slice of the Story Bible (issue #16): classification
 * (earth / fantasy / supernatural / hybrid), description, and the world's
 * rules each stated in explicit relation to real-world (earth) rules.
 * Derives from world-rule facts and chapter summaries — the validator
 * rejects world content the canon does not support (a non-earth
 * classification, or a deviating rule, with no world-rule facts behind it),
 * and the deterministic fake derives its section from the synthesis inputs
 * without inventing rules.
 */

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A canon world rule supports a deviating rule only when the emitted rule
 * actually quotes or wraps the canon topic (case/whitespace-insensitive): the
 * model may dress the topic in prose but may not replace or truncate it. */
function supportedByCanon(rule: string, canon: StoryFacts): boolean {
  const haystack = normalize(rule);
  return canon.worldRules.some((entry) => {
    const topic = normalize(entry.topic);
    return topic.length > 0 && haystack.includes(topic);
  });
}

function isWorldClassification(value: unknown): value is WorldClassification {
  return (
    typeof value === "string" &&
    (WORLD_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

function isWorldRuleRelation(value: unknown): value is WorldRuleRelation {
  return typeof value === "string" && (WORLD_RULE_RELATIONS as readonly string[]).includes(value);
}

function parseWorldRuleEntry(where: string, raw: unknown, index: number): WorldRule {
  if (!isPlainObject(raw)) {
    failSection(where, `rule #${index} must be an object with {rule, relation, note}`, raw);
  }
  const rule = raw["rule"];
  if (!nonEmptyString(rule)) {
    failSection(where, `rule #${index} "rule" must be a non-empty string`, raw);
  }
  const relation = raw["relation"];
  if (!isWorldRuleRelation(relation)) {
    failSection(
      where,
      `rule #${index} "relation" must be one of ${WORLD_RULE_RELATIONS.join(", ")}`,
      raw,
    );
  }
  const note = raw["note"];
  return { rule, relation, note: nonEmptyString(note) ? note : "" };
}

/**
 * Trust-boundary validation of the world section against the canon: shape
 * first (classification enum, string description, well-formed rules), then
 * support — a non-earth classification requires world-rule facts, every
 * deviating rule must trace to a canon world rule, and an earth
 * classification may not carry deviating rules.
 */
export function validateWorld(raw: unknown, canon: StoryFacts): WorldSection {
  const where = "world";
  if (!isPlainObject(raw)) {
    failSection(where, "must be an object with {classification, description, rules}", raw);
  }
  const classification = raw["classification"];
  if (!isWorldClassification(classification)) {
    failSection(where, `"classification" must be one of ${WORLD_CLASSIFICATIONS.join(", ")}`, raw);
  }
  const descriptionRaw = raw["description"];
  if (descriptionRaw !== undefined && descriptionRaw !== null && typeof descriptionRaw !== "string") {
    failSection(where, `"description" must be a string`, raw);
  }
  const rulesRaw = raw["rules"];
  if (!Array.isArray(rulesRaw)) {
    failSection(where, `"rules" must be an array of {rule, relation, note} objects`, raw);
  }
  const rules = rulesRaw.map((entry, index) => parseWorldRuleEntry(where, entry, index));
  const description = typeof descriptionRaw === "string" ? descriptionRaw : "";

  if (classification !== "earth") {
    if (canon.worldRules.length === 0) {
      failSection(
        where,
        `classification "${classification}" is unsupported — canon establishes no world rules deviating from real-world (earth) rules`,
        raw,
      );
    }
    // A classified world must be described and carry the deviating rule(s)
    // the classification rests on (issue #16: present and non-empty once the
    // world is established).
    if (!nonEmptyString(description)) {
      failSection(
        where,
        `"description" must be non-empty for a "${classification}" classification`,
        raw,
      );
    }
    if (!rules.some((entry) => entry.relation === "deviates_from_earth")) {
      failSection(
        where,
        `classification "${classification}" requires at least one rule deviating from earth rules`,
        raw,
      );
    }
  }
  for (const entry of rules) {
    if (entry.relation !== "deviates_from_earth") continue;
    if (classification === "earth") {
      failSection(where, `classification "earth" contradicts deviating rule "${entry.rule}"`, raw);
    }
    if (!supportedByCanon(entry.rule, canon)) {
      failSection(
        where,
        `rule "${entry.rule}" deviates from earth rules but no canon world rule supports it`,
        raw,
      );
    }
  }
  return { classification, description, rules };
}

/** The wire shape of one world rule entry. */
const WORLD_RULE_WIRE_SCHEMA = {
  type: "object",
  properties: {
    rule: { type: "string" },
    relation: { type: "string", enum: WORLD_RULE_RELATIONS },
    note: { type: "string" },
  },
  required: ["rule", "relation"],
} as const satisfies SectionWireSchema;

/** The wire shape of the world section object. */
export const WORLD_WIRE_SCHEMA = {
  type: "object",
  properties: {
    classification: { type: "string", enum: WORLD_CLASSIFICATIONS },
    description: { type: "string" },
    rules: { type: "array", items: WORLD_RULE_WIRE_SCHEMA },
  },
  required: ["classification", "description", "rules"],
} as const satisfies SectionWireSchema;

/** The per-section prompt instruction block for the World section. The enum
 * vocabularies are interpolated from the shared constants, never re-spelled
 * (CODING_STANDARDS §2.1). */
export const WORLD_INSTRUCTION = [
  "world: the story's world as established by canon — its classification (one of",
  `${WORLD_CLASSIFICATIONS.join(", ")}), a description, and the world's rules each stated in relation to`,
  `real-world (earth) rules (relation is one of ${WORLD_RULE_RELATIONS.join(", ")}).`,
  "Value: an object {classification, description, rules:[{rule, relation, note}]}.",
  "Classify non-earth only when canon establishes world rules that deviate from",
  "real-world rules; never invent rules the canon does not support. When canon",
  'establishes no deviating rule, classify the world "earth" and state its',
  'relation to real-world rules (or emit {classification: "earth", description: "",',
  'rules: []} if the world is not yet established at all).',
].join(" ");

/** Occult vocabulary the fake uses to tell a supernatural world apart from a
 * merely rule-bending hybrid one. A deterministic keyword heuristic — the
 * real classification is the vendor synthesizer's judgment, graded by the
 * judge, not by this reference fake. */
const SUPERNATURAL_MARKERS = [
  "magic",
  "magical",
  "ghost",
  "witch",
  "spell",
  "curse",
  "cursed",
  "undead",
  "spirit",
  "supernatural",
  "sorcery",
  "necro",
] as const;

function hasSupernaturalMarker(topics: readonly string[]): boolean {
  const text = topics.join(" ").toLowerCase();
  return SUPERNATURAL_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Deterministic fake: derives the world from the synthesis inputs — one
 * deviating rule per canon world rule, an earth-baseline rule when canon
 * establishes none, and a description composed only from established
 * settings and world rules. Invents nothing: every claim traces to a fact.
 *
 * Classification ladder (all inputs are canon, so no class is ever asserted
 * without a supporting world rule): earth when canon establishes no deviating
 * rule; fantasy when the deviations sit in a wholly invented world (no
 * earth-like character/location/item anchors); supernatural when an earth-like
 * world's deviations are occult; hybrid otherwise (earth-like world bending
 * real rules without going full occult).
 */
export function fakeWorld(input: BibleSynthesisInput): WorldSection {
  const { facts, summaries } = input;
  const topics = facts.worldRules.map((entry) => entry.topic);
  const hasEarthAnchors =
    facts.characters.length > 0 || facts.locations.length > 0 || facts.items.length > 0;

  const classification: WorldClassification =
    topics.length === 0
      ? "earth"
      : !hasEarthAnchors
        ? "fantasy"
        : hasSupernaturalMarker(topics)
          ? "supernatural"
          : "hybrid";

  const rules: WorldRule[] =
    topics.length === 0
      ? [
          {
            rule: "The story's world follows real-world (earth) rules.",
            relation: "same_as_earth",
            note: "Canon establishes no supernatural or invented system as of this point.",
          },
        ]
      : topics.map((topic) => ({
          rule: topic,
          relation: "deviates_from_earth" as const,
          note: `Canon establishes "${topic}", which real-world (earth) rules do not allow.`,
        }));

  const through = `as of chapter ${summaries.length}`;
  const settings = facts.locations.map((location) => location.name);
  const description =
    topics.length === 0
      ? `An earth-classified world: the story follows real-world rules; canon establishes no supernatural or invented system ${through}.`
      : `A ${classification} world ${through}: ${topics.length} canon-established deviation(s) from real-world (earth) rules (${topics.join("; ")})${
          settings.length > 0 ? `; established settings: ${settings.join(", ")}` : ""
        }.`;

  return { classification, description, rules };
}
