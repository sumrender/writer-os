import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPerturbationSet } from "./perturbation-file.js";
import type { ValidatedChapter } from "./manifest.js";

let root: string;
let bookDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-perturbations-"));
  bookDir = join(root, "mini-book");
  mkdirSync(bookDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const CHAPTERS: readonly ValidatedChapter[] = [
  { ordinal: 1, file: "source/ch01.txt", label: "CHAPTER I", text: "Chapter one prose.\n" },
  { ordinal: 2, file: "source/ch02.txt", label: "CHAPTER II", text: "Chapter two prose.\n" },
  { ordinal: 3, file: "source/ch03.txt", label: "CHAPTER III", text: "Chapter three prose.\n" },
];

const ASSERTION_IDS = new Set(["item-compass-not-bellins"]);

function writePerturbationYaml(name: string, content: string): void {
  mkdirSync(join(bookDir, "perturbations"), { recursive: true });
  writeFileSync(join(bookDir, "perturbations", name), content);
}

const PERTURBATION_YML = `kind: perturbation
id: ch03-holder-swap
base_ordinal: 3
file: perturbations/ch03-holder-swap.txt
edits:
  - description: swapped compass holder
violates: [item-compass-not-bellins]
expect: flag
`;

const CONTROL_YML = `kind: control
id: ch01-control
base_ordinal: 1
expect: no_flags
`;

describe("loadPerturbationSet", () => {
  it("returns an empty ok result when the perturbations directory is absent", () => {
    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cases).toEqual([]);
  });

  it("loads a perturbation case, resolving its edited chapter text from disk", () => {
    writePerturbationYaml("ch03-holder-swap.yml", PERTURBATION_YML);
    writeFileSync(
      join(bookDir, "perturbations", "ch03-holder-swap.txt"),
      "Chapter three prose.\nThe brass compass rests with Bellin the harbormaster.\n",
    );

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cases).toHaveLength(1);
    const [loaded] = result.cases;
    expect(loaded?.entry.kind).toBe("perturbation");
    expect(loaded?.entry.baseOrdinal).toBe(3);
    expect(loaded?.chapterText).toContain("Bellin the harbormaster");
  });

  it("loads a control case, resolving chapter text from the book's own chapters", () => {
    writePerturbationYaml("ch01-control.yml", CONTROL_YML);

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.entry.kind).toBe("control");
    expect(result.cases[0]?.chapterText).toBe("Chapter one prose.\n");
  });

  it("loads both perturbation and control cases together, sorted by file name", () => {
    writePerturbationYaml("ch03-holder-swap.yml", PERTURBATION_YML);
    writeFileSync(
      join(bookDir, "perturbations", "ch03-holder-swap.txt"),
      "edited text\n",
    );
    writePerturbationYaml("ch01-control.yml", CONTROL_YML);

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cases.map((c) => c.entry.id)).toEqual(["ch01-control", "ch03-holder-swap"]);
  });

  it("reports invalid YAML with the parser's reason and the offending file name", () => {
    writePerturbationYaml("broken.yml", "kind: perturbation\nid: [unclosed");

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("E_PERTURBATIONS_PARSE");
    expect(result.errors[0]?.message).toContain("broken.yml");
  });

  it("propagates schema validation errors, prefixed with the offending file name", () => {
    writePerturbationYaml("bad.yml", "kind: mutation\nid: x\n");

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("E_SCHEMA");
    expect(result.errors[0]?.message).toContain("bad.yml");
  });

  it("reports a perturbation's missing edited chapter file precisely", () => {
    writePerturbationYaml("ch03-holder-swap.yml", PERTURBATION_YML);
    // .txt deliberately not written

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("E_CHAPTER_FILE_MISSING");
    expect(result.errors[0]?.message).toContain("ch03-holder-swap.txt");
  });

  it("rejects a perturbation file path that escapes the book directory", () => {
    writePerturbationYaml(
      "escaping.yml",
      `kind: perturbation
id: escaping
base_ordinal: 3
file: ../outside.txt
edits:
  - description: swap
violates: [item-compass-not-bellins]
expect: flag
`,
    );

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("E_FILE_TRAVERSAL");
    expect(result.errors[0]?.message).toContain("outside.txt");
  });

  it("rejects a control base_ordinal with no matching chapter", () => {
    writePerturbationYaml(
      "ch09-control.yml",
      "kind: control\nid: ch09-control\nbase_ordinal: 9\nexpect: no_flags\n",
    );

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("E_BASE_ORDINAL_OUT_OF_RANGE");
  });

  it("rejects duplicate ids across separate files", () => {
    writePerturbationYaml("ch01-control.yml", CONTROL_YML);
    writePerturbationYaml("ch01-control-again.yml", CONTROL_YML);

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("E_ID_DUPLICATE");
    expect(result.errors[0]?.message).toContain("ch01-control");
  });

  it("ignores non-.yml files in the perturbations directory", () => {
    writePerturbationYaml("ch01-control.yml", CONTROL_YML);
    writeFileSync(join(bookDir, "perturbations", "README.md"), "notes\n");

    const result = loadPerturbationSet(bookDir, CHAPTERS, ASSERTION_IDS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cases).toHaveLength(1);
  });
});
