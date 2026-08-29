import { AXES, JUDGES, PIPELINES, type Axis, type JudgeKind, type PipelineKind } from "@writer-os/benchmark/events";

/**
 * The CLI selection enums the form exposes. They are re-exported from the
 * `@writer-os/benchmark/events` seam — the single source of truth — so the UI
 * can never drift from the flags the child process actually accepts
 * (CODING_STANDARDS §2.1). The CLI remains the authority and rejects anything
 * unknown with a usage error.
 */

export { AXES, JUDGES, PIPELINES };
export type { Axis, AxisKind, JudgeKind, PipelineKind };

type AxisKind = Axis;

/**
 * v1 enables only Extraction; the others are listed but disabled. This is the
 * UI's own policy (a scope decision, not CLI knowledge), so it lives here and
 * is the single place the "extraction only" rule is expressed.
 */
export const ENABLED_AXES: readonly AxisKind[] = ["extraction"];
