/**
 * The LLM judge seam (docs/TESTING.md §6, ADR-0005).
 *
 * `EquivalenceChecker` is the hard-contract half: two values in, an
 * equivalent-or-not verdict out. Implementations embed a fixed rubric and
 * must never receive fixture text or rule on what the source establishes —
 * ground truth lives exclusively in the assertion set.
 *
 * `Judge` adds the open-world sweep's support check (§6): a rendered fact is
 * judged against source text for support. This operation deliberately sees
 * the source, so its verdicts are estimates and are reported separately from
 * exact scores — never mixed into precision/recall.
 */

export interface EquivalenceRequest {
  readonly left: string;
  readonly right: string;
}

export interface SourceSupportRequest {
  /** Rendered fact descriptor (see lib/fact-text.ts). */
  readonly fact: string;
  /** Source text the fact must be supported by to count as non-fabricated. */
  readonly sourceText: string;
}

/** ADR-0005 contract: equivalence-only verdicts on two values. */
export interface EquivalenceChecker {
  areEquivalent(request: EquivalenceRequest): Promise<boolean>;
}

export interface Judge extends EquivalenceChecker {
  isSupportedBySource(request: SourceSupportRequest): Promise<boolean>;
}
