import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileResponseCache, MemoryResponseCache } from "./response-cache.js";

describe("MemoryResponseCache", () => {
  it("round-trips stored responses and reports misses as undefined", () => {
    const cache = new MemoryResponseCache();
    expect(cache.get("k")).toBeUndefined();
    const response = { choices: [{ message: { content: "x" } }] };
    cache.set("k", response);
    expect(cache.get("k")).toEqual(response);
  });
});

describe("FileResponseCache", () => {
  it("persists responses across instances and starts empty on a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "response-cache-"));
    try {
      const path = join(dir, "nested", "extract-cache.json");
      const first = new FileResponseCache(path);
      expect(first.get("missing")).toBeUndefined();
      first.set("k", { ok: true });

      const second = new FileResponseCache(path);
      expect(second.get("k")).toEqual({ ok: true });
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ k: { ok: true } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts empty on a malformed file and ignores non-object entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "response-cache-"));
    try {
      const path = join(dir, "cache.json");
      writeFileSync(path, "not json at all");
      expect(new FileResponseCache(path).get("k")).toBeUndefined();

      writeFileSync(path, JSON.stringify({ good: { a: 1 }, bad: "string", worse: [1, 2] }));
      const cache = new FileResponseCache(path);
      expect(cache.get("good")).toEqual({ a: 1 });
      expect(cache.get("bad")).toBeUndefined();
      expect(cache.get("worse")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
