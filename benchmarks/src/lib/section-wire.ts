/**
 * The wire vocabulary for Story Bible section synthesis (issue #14): the
 * JSON-schema shape one section's value takes on the forced-tool wire. Its
 * own module so both the composition machinery (`bible-sections.ts`) and the
 * per-aspect section modules (e.g. `world-section.ts`) depend on it in one
 * direction — never on each other's types (CODING_STANDARDS §4.1).
 */
export type SectionWireSchema =
  | { readonly type: "string"; readonly enum?: readonly string[] }
  | { readonly type: "array"; readonly items: SectionWireSchema }
  | {
      readonly type: "object";
      readonly properties?: { readonly [key: string]: SectionWireSchema };
      readonly required?: readonly string[];
    };
