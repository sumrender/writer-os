import { ENTITY_KINDS, type EntityKind } from "./story-facts.js";

/**
 * Run gates (docs/TESTING.md §6): a global precision floor plus per-kind
 * recall floors. Deliberately lenient by default — baselines establish
 * reality before thresholds tighten — and configurable per run via a small
 * JSON file (validated here at the trust boundary).
 */

export interface GateConfig {
  readonly globalPrecisionMin: number;
  readonly recallMin: Partial<Record<EntityKind, number>>;
}

export const DEFAULT_GATES: GateConfig = { globalPrecisionMin: 0.5, recallMin: {} };

export interface GateInputs {
  /** Entity kinds the assertion set actually covers. */
  readonly kindsPresent: readonly EntityKind[];
  readonly globalPrecision: number;
  readonly recallByKind: Partial<Record<EntityKind, number>>;
}

export interface GateCheck {
  readonly gate: string;
  readonly value: number;
  readonly floor: number;
  readonly passed: boolean;
}

export interface GateEvaluation {
  readonly checks: readonly GateCheck[];
  readonly passed: boolean;
}

/**
 * Wire format (JSON):
 *   { "global_precision_min": 0..1,
 *     "recall_min": { "<entity kind>": 0..1 } }
 */
export function parseGateConfig(raw: unknown): GateConfig {
  if (raw === undefined) return DEFAULT_GATES;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("gate config must be a JSON object");
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "global_precision_min" && key !== "recall_min") {
      throw new Error(`gate config: unexpected key "${key}"`);
    }
  }

  const rawPrecision = record.global_precision_min;
  let globalPrecisionMin = DEFAULT_GATES.globalPrecisionMin;
  if (rawPrecision !== undefined) {
    if (!isUnitInterval(rawPrecision)) {
      throw new Error("gate config: \"global_precision_min\" must be a number between 0 and 1");
    }
    globalPrecisionMin = rawPrecision;
  }

  const rawRecall = record.recall_min;
  let recallMin: Partial<Record<EntityKind, number>> = {};
  if (rawRecall !== undefined) {
    if (typeof rawRecall !== "object" || rawRecall === null || Array.isArray(rawRecall)) {
      throw new Error('gate config: "recall_min" must be an object of kind → floor');
    }
    for (const [kind, floor] of Object.entries(rawRecall)) {
      if (!(ENTITY_KINDS as readonly string[]).includes(kind)) {
        throw new Error(`gate config: "recall_min.${kind}" is not an entity kind (${ENTITY_KINDS.join(", ")})`);
      }
      if (!isUnitInterval(floor)) {
        throw new Error(`gate config: "recall_min.${kind}" must be a number between 0 and 1`);
      }
      recallMin[kind as EntityKind] = floor;
    }
  }

  return { globalPrecisionMin, recallMin };
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** A floor passes when the metric meets it exactly or exceeds it. */
export function evaluateGates(config: GateConfig, inputs: GateInputs): GateEvaluation {
  const checks: GateCheck[] = [
    {
      gate: "global_precision",
      value: inputs.globalPrecision,
      floor: config.globalPrecisionMin,
      passed: inputs.globalPrecision >= config.globalPrecisionMin,
    },
  ];

  for (const kind of inputs.kindsPresent) {
    const floor = config.recallMin[kind];
    const recall = inputs.recallByKind[kind];
    if (floor === undefined) continue;
    checks.push({
      gate: `recall.${kind}`,
      value: recall ?? 0,
      floor,
      passed: (recall ?? 0) >= floor,
    });
  }

  return { checks, passed: checks.every((c) => c.passed) };
}
