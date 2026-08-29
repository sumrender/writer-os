/**
 * One-shot live extraction probe (not part of the benchmark suite): runs the
 * real Agnes extractor under run conditions so boundary failures surface in a
 * few calls instead of a full multi-run sweep.
 *   node scripts/probe-extract.ts [chapter-file]      one chapter vs empty canon
 *   node scripts/probe-extract.ts --book mini-book    whole book sequentially,
 *                                                     canon accumulating (the
 *                                                     exact shape of a real run)
 */
import { readFileSync } from "node:fs";
import { createAgnesClient } from "../dist/lib/agnes-client.js";
import { createAgnesExtract } from "../dist/lib/agnes-extract.js";
import { emptyStoryFacts, type StoryFacts } from "../dist/lib/story-facts.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const apiKey = process.env.AGNES_API_KEY ?? env["AGNES_API_KEY"];
if (apiKey === undefined || apiKey.trim().length === 0) {
  throw new Error("AGNES_API_KEY not set (.env or environment)");
}
const baseUrl = process.env.AGNES_BASE_URL ?? env["AGNES_BASE_URL"];
const client = createAgnesClient({
  apiKey,
  ...(baseUrl !== undefined && baseUrl.trim().length > 0 ? { baseUrl } : {}),
});

const extract = createAgnesExtract(client);
let failed = false;

if (process.argv[2] === "--book") {
  const bookName = process.argv[3];
  if (bookName === undefined) throw new Error("usage: node scripts/probe-extract.ts --book <name>");
  const manifest = JSON.parse(
    readFileSync(new URL(`../books/${bookName}/manifest.json`, import.meta.url), "utf8"),
  ) as {
    chapters: readonly { ordinal: number; file: string }[];
  };
  let state: StoryFacts = emptyStoryFacts();
  for (const chapter of manifest.chapters) {
    const text = readFileSync(new URL(`../books/${bookName}/${chapter.file}`, import.meta.url), "utf8");
    try {
      state = await extract(text, chapter.ordinal, state);
      console.log(`chapter ${chapter.ordinal}: OK`);
    } catch (error) {
      failed = true;
      console.error(`chapter ${chapter.ordinal}: FAILED`);
      console.error(error instanceof Error ? error.message : error);
      break;
    }
  }
} else {
  const chapterFile = process.argv[2] ?? "../books/mini-book/source/ch01.txt";
  const chapterText = readFileSync(new URL(chapterFile, import.meta.url), "utf8");
  const ordinal = Number(/ch(\d+)\.txt$/.exec(chapterFile)?.[1] ?? 1);
  try {
    const state = await extract(chapterText, ordinal, emptyStoryFacts());
    console.log(`chapter ${ordinal}: OK`);
    console.log(JSON.stringify(state, null, 2));
  } catch (error) {
    failed = true;
    console.error(`chapter ${ordinal}: FAILED`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed) process.exitCode = 1;
