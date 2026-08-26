import type { BibleState } from "./bible.js";
import { bibleFacts, type Fact } from "./fact-text.js";

/**
 * Open-world sweep (docs/TESTING.md §6): every generated fact no positive
 * assertion claimed is judged against the source text for support. Verdicts
 * are judge-mediated estimates — reported separately, never folded into the
 * exact precision/recall scores.
 */

export interface SupportChecker {
  isSupportedBySource(request: { fact: string; sourceText: string }): Promise<boolean>;
}

export interface SweepFinding {
  readonly fact: Fact;
  readonly supported: boolean;
}

export interface SweepResult {
  readonly swept: number;
  readonly unsupported: number;
  /** Estimated fabrication rate: unsupported / swept; 0 when nothing swept. */
  readonly rate: number;
  readonly findings: readonly SweepFinding[];
}

/** Renders the whole book with labeled ordinals as the sweep's source view. */
export function bookSourceText(chapters: readonly { ordinal: number; text: string }[]): string {
  return chapters
    .map((chapter) => `[chapter ${chapter.ordinal}]\n${chapter.text}`)
    .join("\n\n");
}

export async function sweepUnmatchedFacts(
  state: BibleState,
  claimedKeys: ReadonlySet<string>,
  sourceText: string,
  checker: SupportChecker,
): Promise<SweepResult> {
  const unmatched = bibleFacts(state).filter((fact) => !claimedKeys.has(fact.key));
  const findings: SweepFinding[] = [];

  for (const fact of unmatched) {
    const supported = await checker.isSupportedBySource({ fact: fact.text, sourceText });
    findings.push({ fact, supported });
  }

  const unsupported = findings.filter((f) => !f.supported).length;
  return {
    swept: findings.length,
    unsupported,
    rate: findings.length === 0 ? 0 : unsupported / findings.length,
    findings,
  };
}
