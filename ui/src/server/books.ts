import { isPlainObject, nonEmptyString } from "@writer-os/benchmark/events";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Fixture discovery: books are found by scanning the repo's fixture manifests,
 * so a new Fixture book appears in the UI without any UI change. Manifests are
 * repo data but still parsed defensively (CODING_STANDARDS §1.5).
 */

export interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly chapters: number;
  /** v1 runs the mini-book only; other Fixture books are listed but disabled. */
  readonly enabled: boolean;
}

/** The only Fixture book the v1 UI enables. */
export const V1_ENABLED_BOOK = "mini-book";

interface ManifestShape {
  readonly title: string;
  readonly chapters: number;
}

function parseManifestShape(raw: unknown): ManifestShape | null {
  if (!isPlainObject(raw)) return null;
  const title = raw["title"];
  const chapters = raw["chapters"];
  if (!nonEmptyString(title) || !Array.isArray(chapters)) return null;
  return { title, chapters: chapters.length };
}

export function listBooks(booksRoot: string): BookSummary[] {
  if (!existsSync(booksRoot)) return [];
  const books: BookSummary[] = [];
  for (const entry of readdirSync(booksRoot).sort()) {
    const bookDir = join(booksRoot, entry);
    if (!statSync(bookDir).isDirectory()) continue;
    const manifestPath = join(bookDir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    let shape: ManifestShape | null = null;
    try {
      shape = parseManifestShape(JSON.parse(readFileSync(manifestPath, "utf8")));
    } catch {
      shape = null;
    }
    if (shape === null) continue;
    books.push({
      id: entry,
      title: shape.title,
      chapters: shape.chapters,
      enabled: entry === V1_ENABLED_BOOK,
    });
  }
  return books;
}
