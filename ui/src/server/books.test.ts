import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listBooks } from "./books.js";

/**
 * Fixture discovery (issue #11): books are found by scanning manifests, and a
 * book is runnable on the Extraction axis only when it carries an assertion
 * set to grade against. These tests drive listBooks over a temp books root and
 * assert the external behavior the form's dropdown depends on.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ui-books-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeBook(id: string, opts: { chapters?: number; assertions?: boolean } = {}): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const chapters = Array.from({ length: opts.chapters ?? 2 }, (_, i) => ({ ordinal: i + 1 }));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ title: id, source: "t", chapters }));
  if (opts.assertions !== false) {
    writeFileSync(join(dir, "assertions.yml"), "assertions: []\n");
  }
}

describe("listBooks", () => {
  it("enables every fixture book that ships an assertion set", () => {
    makeBook("mini-book", { chapters: 4 });
    makeBook("tom-sawyer", { chapters: 36 });
    makeBook("gullivers-travels", { chapters: 39 });

    const books = listBooks(root);
    expect(books.map((b) => b.id)).toEqual(["gullivers-travels", "mini-book", "tom-sawyer"]);
    expect(books.every((b) => b.enabled)).toBe(true);
    expect(books.find((b) => b.id === "tom-sawyer")?.chapters).toBe(36);
  });

  it("marks a book without an assertion set as not runnable", () => {
    makeBook("mini-book");
    makeBook("raw-fixture", { assertions: false });

    const books = listBooks(root);
    expect(books.find((b) => b.id === "mini-book")?.enabled).toBe(true);
    expect(books.find((b) => b.id === "raw-fixture")?.enabled).toBe(false);
  });

  it("skips directories with no or an unparseable manifest", () => {
    makeBook("mini-book");
    mkdirSync(join(root, "not-a-book"), { recursive: true });
    mkdirSync(join(root, "broken"), { recursive: true });
    writeFileSync(join(root, "broken", "manifest.json"), "{ not json");

    expect(listBooks(root).map((b) => b.id)).toEqual(["mini-book"]);
  });

  it("returns an empty list when the books root is absent", () => {
    expect(listBooks(join(root, "does-not-exist"))).toEqual([]);
  });
});
