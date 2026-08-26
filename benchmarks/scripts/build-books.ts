// Rebuilds the fixture books under books/ from Project Gutenberg sources.
//
// Usage: pnpm books:build
//
// Downloads both public-domain novels (or reads them from
// PG_<gutenbergId>_FILE env overrides pointing at local .txt copies),
// strips Gutenberg boilerplate, splits chapters into source/chNN.txt
// files, and writes manifest.json mapping files to contiguous-from-1
// chapter ordinals (ADR-0003). Output is committed to the repo; this
// script exists for provenance and regeneration only.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chapterFileName } from "../src/lib/chapter-file.ts";

interface HeadingContext {
  lineIndex: number;
  lines: string[];
}

interface Section {
  label: string;
  lines: string[];
}

interface HeadingRule {
  regex: RegExp;
  open(match: RegExpMatchArray, context: HeadingContext): { label: string } | null;
}

interface ChapterEntry {
  ordinal: number;
  file: string;
  label: string;
}

interface BookConfig {
  id: string;
  title: string;
  gutenbergId: number;
  rules(): HeadingRule[];
  verify(chapters: ChapterEntry[]): void;
}

const BOOKS_ROOT = join(import.meta.dirname, "..", "books");

const ROMAN_VALUES: Readonly<Record<string, number | undefined>> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
};

function romanToInt(roman: string): number {
  let total = 0;
  const chars = [...roman];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === undefined) break;
    const value = ROMAN_VALUES[char];
    if (value === undefined) {
      throw new Error(`invalid roman numeral character: ${char}`);
    }
    const nextChar = chars[i + 1];
    const nextValue =
      nextChar === undefined ? undefined : ROMAN_VALUES[nextChar];
    total += nextValue !== undefined && nextValue > value ? -value : value;
  }
  return total;
}

function intToRoman(n: number): string {
  const table: ReadonlyArray<[number, string]> = [
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [value, numeral] of table) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

async function download(gutenbergId: number): Promise<string> {
  const urls = [
    `https://www.gutenberg.org/cache/epub/${gutenbergId}/pg${gutenbergId}.txt`,
    `https://www.gutenberg.org/files/${gutenbergId}/${gutenbergId}-0.txt`,
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      console.log(`downloaded #${gutenbergId} from ${url}`);
      return await response.text();
    } catch (error) {
      console.warn(`fetch failed (${url}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`could not download Project Gutenberg #${gutenbergId}`);
}

function sourceText(gutenbergId: number): Promise<string> | string {
  const localFile = process.env[`PG_${gutenbergId}_FILE`];
  if (localFile !== undefined) return readFileSync(localFile, "utf8");
  return download(gutenbergId);
}

function bodyBetweenMarkers(text: string, gutenbergId: number): string {
  const startMarker = /\*\*\* START OF THE PROJECT GUTENBERG EBOOK .*? \*\*\*/;
  const endMarker = /\*\*\* END OF THE PROJECT GUTENBERG EBOOK .*? \*\*\*/;
  const start = text.match(startMarker);
  const end = text.match(endMarker);
  if (!start || !end || start.index === undefined || end.index === undefined) {
    throw new Error(`#${gutenbergId}: START/END markers not found`);
  }
  return text.slice(start.index + start[0].length, end.index);
}

/**
 * Splits body text into sections at heading lines. Each rule's open() runs
 * on a heading match; returning a label opens a new section, returning null
 * records state without opening one (e.g. a part header). Content between
 * headings accumulates into the currently open section.
 */
function splitSections(bodyText: string, rules: HeadingRule[]): Section[] {
  const lines = bodyText.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.replace(/\r$/, "") ?? "";
    const rule = rules.find((r) => r.regex.test(line));
    if (!rule) {
      current?.lines.push(line);
      continue;
    }
    const match = line.match(rule.regex);
    if (!match) throw new Error(`rule ${String(rule.regex)} matched without groups`);
    const opened = rule.open(match, { lineIndex: i, lines });
    if (opened) {
      current = { ...opened, lines: [] };
      sections.push(current);
    }
  }
  for (const section of sections) {
    while (
      section.lines.length > 0 &&
      section.lines.at(-1)?.trim() === ""
    ) {
      section.lines.pop();
    }
  }
  return sections;
}

async function buildBook(config: BookConfig): Promise<void> {
  const rawText = await sourceText(config.gutenbergId);
  const sections = splitSections(
    bodyBetweenMarkers(rawText, config.gutenbergId),
    config.rules(),
  );
  mkdirSync(join(BOOKS_ROOT, config.id, "source"), { recursive: true });

  const chapters: ChapterEntry[] = sections.map((section, index) => {
    const ordinal = index + 1;
    const fileName = chapterFileName(ordinal);
    writeFileSync(
      join(BOOKS_ROOT, config.id, fileName),
      `${section.label}\n${section.lines.join("\n")}\n`,
    );
    return { ordinal, file: fileName, label: section.label };
  });

  config.verify(chapters);

  const manifest = {
    book: config.id,
    title: config.title,
    source: `Project Gutenberg #${config.gutenbergId}`,
    chapters,
  };
  writeFileSync(
    join(BOOKS_ROOT, config.id, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`${config.id}: wrote ${chapters.length} chapters`);
}

function assertContiguousOrdinals(chapters: ChapterEntry[]): void {
  chapters.forEach((chapter, index) => {
    if (chapter.ordinal !== index + 1) {
      throw new Error(`ordinal drift at position ${index}`);
    }
  });
}

function tomSawyerRules(): HeadingRule[] {
  let nextChapter = 1;
  return [
    {
      regex: /^CHAPTER ([IVXLC]+)\s*$/,
      open(match) {
        const numeral = match[1];
        if (numeral === undefined) throw new Error("chapter heading missing numeral");
        const expected = nextChapter++;
        if (romanToInt(numeral) !== expected) {
          throw new Error(
            `expected CHAPTER ${intToRoman(expected)}, found ${numeral}`,
          );
        }
        return { label: `CHAPTER ${numeral}` };
      },
    },
    {
      regex: /^CONCLUSION\s*$/,
      open: () => ({ label: "CONCLUSION" }),
    },
  ];
}

function gulliverRules(): HeadingRule[] {
  interface PartState {
    number: number;
    title: string;
    nextChapter: number;
  }
  const partHeader = /^PART ([IVXLC]+)\. (.*)$/;
  let part: PartState | null = null;
  return [
    {
      regex: partHeader,
      open(match, { lineIndex, lines }) {
        const partNumeral = match[1];
        if (partNumeral === undefined) throw new Error("part header missing numeral");
        let title = match[2]?.trim() ?? "";
        let cursor = lineIndex;
        while (!title.endsWith(".") && cursor < lines.length - 1) {
          cursor++;
          title += ` ${lines[cursor]?.trim() ?? ""}`;
        }
        part = {
          number: romanToInt(partNumeral),
          title: title.replace(/\.$/, ""),
          nextChapter: 1,
        };
        return null;
      },
    },
    {
      regex: /^CHAPTER ([IVXLC]+)\.\s*$/,
      open(match) {
        if (!part) throw new Error("chapter heading outside any PART");
        const numeral = match[1];
        if (numeral === undefined) throw new Error("chapter heading missing numeral");
        if (romanToInt(numeral) !== part.nextChapter) {
          throw new Error(
            `expected Part ${intToRoman(part.number)} chapter ${intToRoman(part.nextChapter)}, found ${numeral}`,
          );
        }
        part.nextChapter++;
        return {
          label: `Part ${part.number}: ${part.title} — CHAPTER ${numeral}`,
        };
      },
    },
  ];
}

await rmSync(join(BOOKS_ROOT, "tom-sawyer"), { recursive: true, force: true });
await rmSync(join(BOOKS_ROOT, "gullivers-travels"), { recursive: true, force: true });
mkdirSync(join(BOOKS_ROOT, "tom-sawyer"), { recursive: true });
mkdirSync(join(BOOKS_ROOT, "gullivers-travels"), { recursive: true });

await buildBook({
  id: "tom-sawyer",
  title: "The Adventures of Tom Sawyer",
  gutenbergId: 74,
  rules: tomSawyerRules,
  verify(chapters) {
    assertContiguousOrdinals(chapters);
    if (chapters.length !== 36) {
      throw new Error(
        `expected 35 chapters + CONCLUSION, got ${chapters.length}`,
      );
    }
    if (chapters.at(-1)?.label !== "CONCLUSION") {
      throw new Error("last section is not CONCLUSION");
    }
  },
});

await buildBook({
  id: "gullivers-travels",
  title: "Gulliver's Travels",
  gutenbergId: 829,
  rules: gulliverRules,
  verify(chapters) {
    assertContiguousOrdinals(chapters);
    if (chapters.length !== 39) {
      throw new Error(`expected 39 chapters, got ${chapters.length}`);
    }
  },
});

console.log("done.");
