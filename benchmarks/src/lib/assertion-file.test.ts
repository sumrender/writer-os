import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAssertionSet } from "./assertion-file.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-assertions-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const VALID_YML = `book: mini-book
assertions:
  - id: char-mara
    kind: character
    expect: must
    name: Mara Vey
    evidence: [1]
`;

function writeAssertions(content: string | null): string {
  const bookDir = join(root, "mini-book");
  mkdirSync(bookDir, { recursive: true });
  if (content !== null) {
    writeFileSync(join(bookDir, "assertions.yml"), content);
  }
  return bookDir;
}

describe("loadAssertionSet", () => {
  it("loads and validates a well-formed assertions.yml", () => {
    const result = loadAssertionSet(writeAssertions(VALID_YML), { maxOrdinal: 4 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.set.book).toBe("mini-book");
      expect(result.set.assertions[0]).toMatchObject({
        id: "char-mara",
        kind: "character",
        name: "Mara Vey",
        evidence: [1],
      });
    }
  });

  it("reports a missing file precisely", () => {
    const result = loadAssertionSet(writeAssertions(null), { maxOrdinal: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("E_ASSERTION_FILE_MISSING");
      expect(result.errors[0]?.message).toContain("mini-book/assertions.yml");
    }
  });

  it("reports YAML parse failures with the parser's reason", () => {
    const result = loadAssertionSet(
      writeAssertions("book: mini-book\nassertions: [unclosed"),
      { maxOrdinal: 4 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("E_ASSERTIONS_PARSE");
  });

  it("propagates schema validation errors from the set contents", () => {
    const result = loadAssertionSet(
      writeAssertions(
        `book: wrong-book\nassertions:\n  - id: char-mara\n    kind: character\n    expect: must\n    name: Mara Vey\n    evidence: [1]\n`,
      ),
      { maxOrdinal: 4 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("E_BOOK_MISMATCH");
  });

  it("passes the book id derived from the directory name to validation", () => {
    const result = loadAssertionSet(writeAssertions(VALID_YML), {});
    expect(result.ok).toBe(true);
  });

  it("enforces ordinal range checks against maxOrdinal when provided", () => {
    const result = loadAssertionSet(
      writeAssertions(
        `book: mini-book\nassertions:\n  - id: char-mara\n    kind: character\n    expect: must\n    name: Mara Vey\n    evidence: [99]\n`,
      ),
      { maxOrdinal: 4 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("E_ORDINAL_OUT_OF_RANGE");
  });
});
