import type { StoryFacts } from "./story-facts.js";
import { storyFacts, type Fact } from "./fact-text.js";
import { silentLogger, type Logger } from "./logger.js";

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
  state: StoryFacts,
  claimedKeys: ReadonlySet<string>,
  sourceText: string,
  checker: SupportChecker,
  log: Logger = silentLogger,
): Promise<SweepResult> {
  const unmatched = storyFacts(state).filter((fact) => !claimedKeys.has(fact.key));
  log.debug(`    sweep: ${unmatched.length} fact(s) to check (${claimedKeys.size} already claimed)`);
  const findings: SweepFinding[] = [];

  for (const fact of unmatched) {
    log.debug(`      sweep fact: "${fact.text.slice(0, 80)}"`);
    const supported = await checker.isSupportedBySource({ fact: fact.text, sourceText });
    log.debug(`        → ${supported ? "supported" : "unsupported"}`);
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
