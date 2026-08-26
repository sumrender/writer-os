import { describe, expect, it } from "vitest";
import { validateBeatSet, type ValidationIssue } from "./beats.js";

const issuesOf = (result: ReturnType<typeof validateBeatSet>): ValidationIssue[] =>
  result.ok ? [] : result.errors;

const codesOf = (result: ReturnType<typeof validateBeatSet>): string[] =>
  issuesOf(result).map((issue) => issue.code);

const CTX = { bookId: "mini-book", maxOrdinal: 4 };

function baseSet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    book: "mini-book",
    chapters: [
      {
        ordinal: 4,
        beats: {
          must_include: ["the brass compass passes to Joren Vey"],
          must_not_include: ["Mara Vey and Joren Vey are revealed as sisters"],
        },
      },
    ],
    ...overrides,
  };
}

describe("validateBeatSet", () => {
  it("accepts a well-formed beat set and returns typed declarations", () => {
    const result = validateBeatSet(baseSet(), CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.set.book).toBe("mini-book");
    expect(result.set.chapters).toEqual([
      {
        ordinal: 4,
        mustInclude: ["the brass compass passes to Joren Vey"],
        mustNotInclude: ["Mara Vey and Joren Vey are revealed as sisters"],
      },
    ]);
  });

  it("defaults an omitted must_include or must_not_include to an empty list", () => {
    const result = validateBeatSet(
      baseSet({
        chapters: [{ ordinal: 3, beats: { must_include: ["the ledger burns"] } }],
      }),
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.set.chapters[0]).toEqual({
      ordinal: 3,
      mustInclude: ["the ledger burns"],
      mustNotInclude: [],
    });
  });

  it("rejects a non-object root", () => {
    const result = validateBeatSet([1, 2], CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
  });

  it("rejects unexpected top-level keys", () => {
    const result = validateBeatSet(baseSet({ extra: true }), CTX);
    expect(codesOf(result)).toContain("E_SCHEMA");
    expect(issuesOf(result).some((i) => i.message.includes('unexpected key "extra"'))).toBe(true);
  });

  it("requires book to match the validating book id", () => {
    const result = validateBeatSet(baseSet({ book: "tom-sawyer" }), CTX);
    expect(codesOf(result)).toEqual(["E_BOOK_MISMATCH"]);
  });

  it("requires a non-empty chapters array", () => {
    const result = validateBeatSet(baseSet({ chapters: [] }), CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"chapters" must be a non-empty array');
  });

  it("rejects a non-positive-integer ordinal", () => {
    const result = validateBeatSet(
      baseSet({ chapters: [{ ordinal: 0, beats: { must_include: ["x"] } }] }),
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
  });

  it("rejects an ordinal beyond the book's final ordinal", () => {
    const result = validateBeatSet(
      baseSet({ chapters: [{ ordinal: 99, beats: { must_include: ["x"] } }] }),
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_ORDINAL_OUT_OF_RANGE"]);
    expect(issuesOf(result)[0]?.message).toContain("99");
    expect(issuesOf(result)[0]?.message).toContain("final ordinal (4)");
  });

  it("rejects duplicate chapter ordinals", () => {
    const result = validateBeatSet(
      baseSet({
        chapters: [
          { ordinal: 4, beats: { must_include: ["a"] } },
          { ordinal: 4, beats: { must_include: ["b"] } },
        ],
      }),
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_ORDINAL_DUPLICATE"]);
    expect(issuesOf(result)[0]?.message).toContain("4");
  });

  it("rejects a chapter entry declaring neither must_include nor must_not_include", () => {
    const result = validateBeatSet(
      baseSet({ chapters: [{ ordinal: 4, beats: {} }] }),
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain("must declare at least one");
  });

  it("rejects must_include entries that are not non-empty strings", () => {
    const result = validateBeatSet(
      baseSet({ chapters: [{ ordinal: 4, beats: { must_include: [""] } }] }),
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
  });

  it("rejects unexpected keys on a chapter entry", () => {
    const result = validateBeatSet(
      baseSet({ chapters: [{ ordinal: 4, beats: { must_include: ["x"] }, extra: 1 }] }),
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('unexpected key "extra"');
  });

  it("rejects unexpected keys inside the beats object", () => {
    const result = validateBeatSet(
      baseSet({ chapters: [{ ordinal: 4, beats: { must_include: ["x"], extra: 1 } }] }),
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('unexpected key "extra"');
  });

  it("skips the ordinal range check when maxOrdinal is not given", () => {
    const result = validateBeatSet(baseSet({ chapters: [{ ordinal: 99, beats: { must_include: ["x"] } }] }), {
      bookId: "mini-book",
    });
    expect(result.ok).toBe(true);
  });
});
