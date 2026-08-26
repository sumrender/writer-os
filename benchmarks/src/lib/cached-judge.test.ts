import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach } from "vitest";
import {
  hashVerdictInput,
  FileVerdictCache,
  MemoryVerdictCache,
} from "./verdict-cache.js";
import { canonicalJson } from "./canonical-json.js";
import { CachingJudge } from "./cached-judge.js";
import { createStubJudge } from "./stub-judge.js";

describe("canonicalJson", () => {
  it("is order-independent for object keys", () => {
    expect(canonicalJson({ b: 1, a: [2, { z: 3, y: 4 }] })).toBe(
      canonicalJson({ a: [2, { y: 4, z: 3 }], b: 1 }),
    );
  });

  it("keeps array order and distinguishes values JSON would conflate", () => {
    expect(canonicalJson(["b", "a"])).not.toBe(canonicalJson(["a", "b"]));
    expect(canonicalJson("1")).not.toBe(canonicalJson(1));
  });
});

describe("hashVerdictInput", () => {
  it("is stable across key order and sensitive to content", () => {
    const a = hashVerdictInput("equivalence", { left: "x", right: "y" });
    const b = hashVerdictInput("equivalence", { right: "y", left: "x" });
    const c = hashVerdictInput("equivalence", { left: "y", right: "x" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates operations even with similar payloads", () => {
    expect(hashVerdictInput("equivalence", { left: "f", right: "s" })).not.toBe(
      hashVerdictInput("source_support", { left: "f", right: "s" }),
    );
  });
});

describe("MemoryVerdictCache", () => {
  it("round-trips verdicts and reports misses as undefined", () => {
    const cache = new MemoryVerdictCache();
    expect(cache.get("k")).toBeUndefined();
    cache.set("k", true);
    expect(cache.get("k")).toBe(true);
    cache.set("k", false);
    expect(cache.get("k")).toBe(false);
  });
});

describe("FileVerdictCache", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bench-cache-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("persists verdicts to disk for later instances", () => {
    const path = join(root, "cache.json");
    new FileVerdictCache(path).set("abc", true);

    expect(new FileVerdictCache(path).get("abc")).toBe(true);
  });

  it("writes a readable JSON map and starts over on a malformed file", () => {
    const path = join(root, "cache.json");
    new FileVerdictCache(path).set("k1", false);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ k1: false });

    writeFileSync(path, "not json at all");
    expect(new FileVerdictCache(path).get("k1")).toBeUndefined();
  });

  it("ignores non-boolean entries when loading an existing file", () => {
    const path = join(root, "cache.json");
    writeFileSync(path, JSON.stringify({ good: true, bad: "yes" }));
    const cache = new FileVerdictCache(path);
    expect(cache.get("good")).toBe(true);
    expect(cache.get("bad")).toBeUndefined();
  });
});

describe("CachingJudge", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bench-cachejudge-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("delegates identical calls once and distinct calls each time", async () => {
    const stub = createStubJudge({
      equivalences: [
        { left: "a", right: "b", equivalent: true },
        { left: "b", right: "a", equivalent: false },
      ],
    });
    const judge = new CachingJudge(stub, new MemoryVerdictCache());

    expect(await judge.areEquivalent({ left: "a", right: "b" })).toBe(true);
    expect(await judge.areEquivalent({ left: "a", right: "b" })).toBe(true);
    expect(await judge.areEquivalent({ left: "b", right: "a" })).toBe(false);
    await judge.isSupportedBySource({ fact: "f", sourceText: "same text" });
    await judge.isSupportedBySource({ fact: "f", sourceText: "same text" });

    expect(stub.calls).toEqual({ equivalence: 2, support: 1 });
  });

  it("carries a persisted cache across judge instances", async () => {
    const path = join(root, "judge-cache.json");
    const first = new CachingJudge(createStubJudge(), new FileVerdictCache(path));
    expect(await first.isSupportedBySource({ fact: "iron ships", sourceText: "t" })).toBe(false);

    const freshStub = createStubJudge();
    const second = new CachingJudge(freshStub, new FileVerdictCache(path));
    expect(await second.isSupportedBySource({ fact: "iron ships", sourceText: "t" })).toBe(false);
    expect(freshStub.calls).toEqual({ equivalence: 0, support: 0 });
  });
});
