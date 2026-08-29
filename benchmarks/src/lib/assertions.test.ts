import { describe, expect, it } from "vitest";
import {
  ASSERTION_KINDS,
  validateAssertionSet,
  type Assertion,
  type ValidationIssue,
} from "./assertions.js";

const issuesOf = (result: ReturnType<typeof validateAssertionSet>): ValidationIssue[] =>
  result.ok ? [] : result.errors;

const codesOf = (result: ReturnType<typeof validateAssertionSet>): string[] =>
  issuesOf(result).map((issue) => issue.code);

function baseEntry(kind: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `probe-${kind.replaceAll("_", "-")}`,
    kind,
    expect: "must",
    evidence: [1],
    ...overrides,
  };
}

const CTX = { bookId: "mini-book", maxOrdinal: 4 };

describe("validateAssertionSet", () => {
  it("accepts a well-formed set covering every kind and returns typed assertions", () => {
    const raw = {
      book: "mini-book",
      assertions: [
        baseEntry("character", { id: "char-mara", name: "Mara Vey" }),
        baseEntry("appearance", {
          id: "appear-mara-coat",
          character: "Mara Vey",
          attribute: "her coat",
          contains: "salt-white wool",
        }),
        baseEntry("relationship", {
          id: "rel-mara-joren-daughter",
          from: "Mara Vey",
          to: "Joren Vey",
          type: "daughter",
        }),
        baseEntry("item", { id: "item-compass", item: "the brass compass", holder: "Joren Vey" }),
        baseEntry("location", { id: "loc-light", name: "the northern light" }),
        baseEntry("thread", {
          id: "thread-ledger",
          thread: "the missing ledger",
          status: "resolved",
          as_of: 4,
        }),
        baseEntry("world_rule", { id: "rule-oilless-light", topic: "the northern light burns without oil" }),
        baseEntry("timeline", {
          id: "order-bell-before-burn",
          sequence: ["the harbor bell rang", "the ledger burned"],
        }),
        baseEntry("lexicon", { id: "lex-vess", term: "Vess", locked_spelling: true }),
        baseEntry("style", { id: "style-narration", field: "narration", value: "close third person, past tense" }),
      ],
    };

    const result = validateAssertionSet(raw, CTX);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.set.book).toBe("mini-book");
      expect(result.set.assertions).toHaveLength(ASSERTION_KINDS.length);
      const thread = result.set.assertions.find((a) => a.id === "thread-ledger");
      expect(thread).toMatchObject({ kind: "thread", asOf: 4, status: "resolved" });
    }
  });

  it("preserves every declared kind in the parsed union", () => {
    const kinds: Assertion["kind"][] = [
      "character",
      "appearance",
      "relationship",
      "item",
      "location",
      "thread",
      "world_rule",
      "timeline",
      "lexicon",
      "style",
    ];
    expect([...ASSERTION_KINDS]).toEqual(kinds);
  });

  it("normalizes absent evidence on must_not assertions to an empty array", () => {
    const entry = baseEntry("world_rule", {
      id: "rule-no-iron-ships",
      expect: "must_not",
      topic: "any iron ships",
    });
    delete entry.evidence;
    const result = validateAssertionSet(
      { book: "mini-book", assertions: [entry] },
      CTX,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.set.assertions[0]?.expect).toBe("must_not");
      expect(result.set.assertions[0]?.evidence).toEqual([]);
    }
  });

  it("rejects a non-object root", () => {
    const result = validateAssertionSet([1, 2], CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain("root must be a JSON/YAML object");
  });

  it("rejects unknown top-level keys and names them", () => {
    const raw = { book: "mini-book", assertions: [baseEntry("character", { name: "X" })], extra: true };
    const result = validateAssertionSet(raw, CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('unexpected key "extra"');
  });

  it("rejects a book field that does not match the book under test", () => {
    const raw = { book: "other-book", assertions: [baseEntry("character", { name: "X" })] };
    const result = validateAssertionSet(raw, CTX);
    expect(codesOf(result)).toEqual(["E_BOOK_MISMATCH"]);
    expect(issuesOf(result)[0]?.message).toContain("other-book");
    expect(issuesOf(result)[0]?.message).toContain("mini-book");
  });

  it("rejects an empty or missing assertions array", () => {
    expect(codesOf(validateAssertionSet({ book: "mini-book", assertions: [] }, CTX))).toEqual([
      "E_SCHEMA",
    ]);
    expect(codesOf(validateAssertionSet({ book: "mini-book" }, CTX))).toEqual(["E_SCHEMA"]);
  });

  it("rejects a non-object entry with its index", () => {
    const raw = { book: "mini-book", assertions: ["nope"] };
    const result = validateAssertionSet(raw, CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain("assertions[0]");
  });

  it("rejects an unknown kind with the accepted list", () => {
    const raw = { book: "mini-book", assertions: [baseEntry("creature", { name: "X" })] };
    const result = validateAssertionSet(raw, CTX);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    const message = issuesOf(result)[0]?.message ?? "";
    expect(message).toContain("assertions[0]");
    expect(message).toContain('"kind" must be one of');
    expect(message).toContain("character");
  });

  it("accepts a location assertion by exact name for both polarities", () => {
    const must = validateAssertionSet(
      {
        book: "mini-book",
        assertions: [baseEntry("location", { id: "loc-light", name: "the northern light" })],
      },
      CTX,
    );
    expect(must.ok).toBe(true);
    if (must.ok) {
      expect(must.set.assertions[0]).toMatchObject({
        kind: "location",
        name: "the northern light",
        expect: "must",
      });
    }

    const mustNot = validateAssertionSet(
      {
        book: "mini-book",
        assertions: [
          baseEntry("location", {
            id: "loc-southern",
            expect: "must_not",
            name: "the southern light",
          }),
        ],
      },
      CTX,
    );
    expect(mustNot.ok).toBe(true);
    if (mustNot.ok) {
      expect(mustNot.set.assertions[0]).toMatchObject({
        kind: "location",
        name: "the southern light",
        expect: "must_not",
      });
    }
  });

  it("rejects an unknown expect polarity", () => {
    const raw = { book: "mini-book", assertions: [baseEntry("character", { expect: "should", name: "X" })] };
    const result = validateAssertionSet(raw, CTX);
    expect(issuesOf(result)[0]?.message).toContain('"expect" must be one of must, must_not');
  });

  it("requires evidence for every must assertion", () => {
    const entry = baseEntry("character", { name: "X" });
    delete entry.evidence;
    const result = validateAssertionSet({ book: "mini-book", assertions: [entry] }, CTX);
    expect(codesOf(result)).toEqual(["E_EVIDENCE_REQUIRED"]);
    expect(issuesOf(result)[0]?.message).toContain("probe-character");
  });

  it("rejects an empty evidence array", () => {
    const result = validateAssertionSet(
      { book: "mini-book", assertions: [baseEntry("character", { evidence: [], name: "X" })] },
      CTX,
    );
    expect(issuesOf(result)[0]?.message).toContain('"evidence" must be a non-empty array of positive integer ordinals');
  });

  it("rejects non-positive-integer evidence ordinals", () => {
    const result = validateAssertionSet(
      { book: "mini-book", assertions: [baseEntry("character", { evidence: [1, 2.5, 0], name: "X" })] },
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain("positive integer ordinals");
  });

  it("rejects as_of or evidence beyond the book's final ordinal", () => {
    const result = validateAssertionSet(
      {
        book: "mini-book",
        assertions: [
          baseEntry("character", { name: "X", as_of: 9, evidence: [1, 99] }),
        ],
      },
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_ORDINAL_OUT_OF_RANGE", "E_ORDINAL_OUT_OF_RANGE"]);
    const asOfMessage = issuesOf(result)[0]?.message ?? "";
    expect(asOfMessage).toContain('"as_of" 9');
    expect(asOfMessage).toContain("final ordinal (4)");
    expect(issuesOf(result)[1]?.message).toContain("evidence ordinals 99");
  });

  it("skips range checks when no maxOrdinal context is given", () => {
    const result = validateAssertionSet(
      { book: "mini-book", assertions: [baseEntry("character", { name: "X", as_of: 999 })] },
      { bookId: "mini-book" },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects ids that are not slugs", () => {
    const result = validateAssertionSet(
      { book: "mini-book", assertions: [baseEntry("character", { id: "Char Mara!", name: "X" })] },
      CTX,
    );
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    expect(issuesOf(result)[0]?.message).toContain('"id" must be a lowercase slug');
  });

  it("rejects duplicate ids naming the offending indexes", () => {
    const raw = {
      book: "mini-book",
      assertions: [
        baseEntry("character", { id: "dup", name: "A" }),
        baseEntry("character", { id: "dup", name: "B" }),
      ],
    };
    const result = validateAssertionSet(raw, CTX);
    expect(codesOf(result)).toEqual(["E_ID_DUPLICATE"]);
    const message = issuesOf(result)[0]?.message ?? "";
    expect(message).toContain('"dup"');
    expect(message).toContain("0");
    expect(message).toContain("1");
  });

  it("reports each kind's missing payload field precisely", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["character", {}, '"name"'],
      ["appearance", { character: "C", attribute: "a" }, '"contains"'],
      ["relationship", { from: "A" }, '"to"'],
      ["item", { item: "compass" }, '"holder"'],
      ["location", {}, '"name"'],
      ["thread", { thread: "t" }, '"status"'],
      ["world_rule", {}, '"topic"'],
      ["timeline", {}, '"sequence"'],
      ["lexicon", { term: "Vess" }, '"locked_spelling"'],
      ["style", { field: "f" }, '"value"'],
    ];
    for (const [kind, payload, expectedField] of cases) {
      const result = validateAssertionSet(
        { book: "mini-book", assertions: [baseEntry(kind, payload)] },
        CTX,
      );
      expect(result.ok, kind).toBe(false);
      expect(issuesOf(result)[0]?.message).toContain(expectedField);
    }
  });

  it("rejects an invalid thread status with the allowed values", () => {
    const result = validateAssertionSet(
      {
        book: "mini-book",
        assertions: [baseEntry("thread", { thread: "t", status: "forgotten" })],
      },
      CTX,
    );
    expect(issuesOf(result)[0]?.message).toContain('"status" must be one of open, resolved, dormant');
  });

  it("rejects locked_spelling that is not a boolean and a timeline sequence shorter than two events", () => {
    const badLexicon = validateAssertionSet(
      {
        book: "mini-book",
        assertions: [baseEntry("lexicon", { term: "Vess", locked_spelling: "yes" })],
      },
      CTX,
    );
    expect(badLexicon.ok).toBe(false);
    expect(issuesOf(badLexicon)[0]?.message).toContain('"locked_spelling" must be a boolean');

    const badTimeline = validateAssertionSet(
      {
        book: "mini-book",
        assertions: [baseEntry("timeline", { sequence: ["only one event"] })],
      },
      CTX,
    );
    expect(badTimeline.ok).toBe(false);
    expect(issuesOf(badTimeline)[0]?.message).toContain(
      '"sequence" must be an array of at least two non-empty event names',
    );
  });

  it("aggregates multiple problems across entries instead of failing fast", () => {
    const raw = {
      book: "mini-book",
      assertions: [
        baseEntry("character", {}),
        baseEntry("character", { name: "B", evidence: [77] }),
        baseEntry("character", { id: "dup-x", name: "C" }),
        baseEntry("character", { id: "dup-x", name: "D" }),
      ],
    };
    const codes = codesOf(validateAssertionSet(raw, CTX));
    expect(codes).toContain("E_SCHEMA");
    expect(codes).toContain("E_ORDINAL_OUT_OF_RANGE");
    expect(codes).toContain("E_ID_DUPLICATE");
  });
});
