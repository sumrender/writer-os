import { describe, expect, it } from "vitest";
import { validatePerturbationEntry, type ValidationIssue } from "./perturbation.js";

const issuesOf = (result: ReturnType<typeof validatePerturbationEntry>): ValidationIssue[] =>
  result.ok ? [] : result.errors;

const codesOf = (result: ReturnType<typeof validatePerturbationEntry>): string[] =>
  issuesOf(result).map((issue) => issue.code);

const CTX = { bookId: "mini-book", maxOrdinal: 4, assertionIds: new Set(["item-compass-not-bellins", "rel-mara-joren-not-sister"]) };

function basePerturbation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "perturbation",
    id: "ch03-holder-swap",
    base_ordinal: 3,
    file: "perturbations/ch03-holder-swap.txt",
    edits: [{ description: "compass holder swapped to Bellin" }],
    violates: ["item-compass-not-bellins"],
    expect: "flag",
    ...overrides,
  };
}

function baseControl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "control",
    id: "ch01-control",
    base_ordinal: 1,
    expect: "no_flags",
    ...overrides,
  };
}

describe("validatePerturbationEntry — perturbation kind", () => {
  it("accepts a well-formed perturbation entry", () => {
    const result = validatePerturbationEntry(basePerturbation(), CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry).toMatchObject({
        kind: "perturbation",
        id: "ch03-holder-swap",
        baseOrdinal: 3,
        file: "perturbations/ch03-holder-swap.txt",
        violates: ["item-compass-not-bellins"],
        expect: "flag",
      });
      expect(result.entry.kind === "perturbation" && result.entry.edits).toEqual([
        { description: "compass holder swapped to Bellin" },
      ]);
    }
  });

  it("rejects a non-object root", () => {
    const result = validatePerturbationEntry([1, 2], CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
  });

  it("rejects an unknown kind", () => {
    const result = validatePerturbationEntry(basePerturbation({ kind: "mutation" }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"kind" must be one of perturbation, control');
  });

  it("rejects an id that is not a lowercase slug", () => {
    const result = validatePerturbationEntry(basePerturbation({ id: "Ch03 Swap!" }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"id" must be a lowercase slug');
  });

  it("rejects base_ordinal beyond the book's final ordinal", () => {
    const result = validatePerturbationEntry(basePerturbation({ base_ordinal: 99 }), CTX);
    expect(codesOf(result)).toEqual(["E_BASE_ORDINAL_OUT_OF_RANGE"]);
    expect(issuesOf(result)[0]?.message).toContain("99");
    expect(issuesOf(result)[0]?.message).toContain("final ordinal (4)");
  });

  it("rejects a non-positive-integer base_ordinal", () => {
    const result = validatePerturbationEntry(basePerturbation({ base_ordinal: 0 }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
  });

  it("requires expect to be flag for a perturbation entry", () => {
    const result = validatePerturbationEntry(basePerturbation({ expect: "no_flags" }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"expect" must be "flag" for a perturbation entry');
  });

  it("requires a non-empty edits array", () => {
    const result = validatePerturbationEntry(basePerturbation({ edits: [] }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"edits" must be a non-empty array');
  });

  it("rejects edits entries missing a description", () => {
    const result = validatePerturbationEntry(basePerturbation({ edits: [{}] }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"description"');
  });

  it("requires a non-empty violates array", () => {
    const result = validatePerturbationEntry(basePerturbation({ violates: [] }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"violates" must be a non-empty array');
  });

  it("rejects violates ids unknown to the book's assertion set, naming them", () => {
    const result = validatePerturbationEntry(basePerturbation({ violates: ["ghost-id"] }), CTX);
    expect(codesOf(result)).toEqual(["E_VIOLATES_UNKNOWN_ID"]);
    expect(issuesOf(result)[0]?.message).toContain("ghost-id");
  });

  it("skips violates cross-checks when no assertionIds context is given", () => {
    const result = validatePerturbationEntry(basePerturbation({ violates: ["ghost-id"] }), {
      bookId: "mini-book",
      maxOrdinal: 4,
    });
    expect(result.ok).toBe(true);
  });

  it("requires a file field", () => {
    const entry = basePerturbation();
    delete entry.file;
    const result = validatePerturbationEntry(entry, CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"file"');
  });

  it("rejects a file field that is not a .txt path", () => {
    const result = validatePerturbationEntry(basePerturbation({ file: "perturbations/ch03.md" }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain(".txt");
  });

  it("rejects unexpected keys for a perturbation entry", () => {
    const result = validatePerturbationEntry(basePerturbation({ extra: true }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('unexpected key "extra"');
  });
});

describe("validatePerturbationEntry — control kind", () => {
  it("accepts a well-formed control entry", () => {
    const result = validatePerturbationEntry(baseControl(), CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry).toMatchObject({ kind: "control", id: "ch01-control", baseOrdinal: 1, expect: "no_flags" });
    }
  });

  it("requires expect to be no_flags for a control entry", () => {
    const result = validatePerturbationEntry(baseControl({ expect: "flag" }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"expect" must be "no_flags" for a control entry');
  });

  it("rejects perturbation-only fields on a control entry", () => {
    const result = validatePerturbationEntry(
      baseControl({ file: "perturbations/ch01.txt" }),
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('unexpected key "file"');
  });

  it("rejects base_ordinal beyond the book's final ordinal", () => {
    const result = validatePerturbationEntry(baseControl({ base_ordinal: 42 }), CTX);
    expect(codesOf(result)).toEqual(["E_BASE_ORDINAL_OUT_OF_RANGE"]);
  });
});
