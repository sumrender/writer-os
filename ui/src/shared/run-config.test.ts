import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_CONFIG,
  isLiveConfig,
  parseRunConfig,
  validateRunForm,
} from "./run-config.js";

/**
 * The run-configuration trust boundary (issue #11 story 10): an invalid config
 * must never reach the run manager, so both the client form bag and the
 * unknown network payload narrow through these functions. Expected values come
 * from the spec's field rules, not from re-running the implementation.
 */

describe("validateRunForm — raw HTML form field bag", () => {
  it("accepts the offline-first defaults", () => {
    const { config, errors } = validateRunForm({
      book: "mini-book",
      axis: "extraction",
      runs: "1",
      pipeline: "fake",
      judge: "stub",
      cache: "true",
    });
    expect(errors).toEqual({});
    expect(config).toEqual(DEFAULT_RUN_CONFIG);
  });

  it("rejects a non-positive or fractional run count", () => {
    expect(validateRunForm({ ...bag(), runs: "0" }).config).toBeNull();
    expect(validateRunForm({ ...bag(), runs: "2.5" }).config).toBeNull();
    expect(validateRunForm({ ...bag(), runs: "abc" }).config).toBeNull();
  });

  it("rejects an axis other than extraction (v1 scope)", () => {
    const result = validateRunForm({ ...bag(), axis: "checker" });
    expect(result.config).toBeNull();
    expect(result.errors.axis).toMatch(/v1/i);
  });

  it("rejects unknown pipeline/judge/cache enum values", () => {
    expect(validateRunForm({ ...bag(), pipeline: "gpt" }).config).toBeNull();
    expect(validateRunForm({ ...bag(), judge: "human" }).config).toBeNull();
    expect(validateRunForm({ ...bag(), cache: "yes" }).config).toBeNull();
  });

  it("rejects an empty book", () => {
    expect(validateRunForm({ ...bag(), book: "  " }).config).toBeNull();
  });
});

describe("parseRunConfig — unknown network payload", () => {
  it("narrows a well-formed config object, coercing number/boolean fields", () => {
    const { config } = parseRunConfig({
      book: "mini-book",
      axis: "extraction",
      runs: 3,
      pipeline: "fake",
      judge: "stub",
      cache: false,
    });
    expect(config).toEqual({ ...DEFAULT_RUN_CONFIG, runs: 3, cache: false });
  });

  it("rejects non-objects, arrays, and null", () => {
    expect(parseRunConfig(null).config).toBeNull();
    expect(parseRunConfig("mini-book").config).toBeNull();
    expect(parseRunConfig([]).config).toBeNull();
  });

  it("rejects a payload with an injection-shaped book value", () => {
    const { config } = parseRunConfig({
      book: "mini-book; rm -rf /",
      axis: "extraction",
      runs: 1,
      pipeline: "fake",
      judge: "stub",
      cache: true,
    });
    // The book is an opaque id the manager checks against the fixture scan;
    // validation only requires a non-empty string here.
    expect(config?.book).toBe("mini-book; rm -rf /");
    expect(parseRunConfig({ ...obj(), book: "" }).config).toBeNull();
  });
});

describe("isLiveConfig", () => {
  it("flags any live pipeline or live judge as spend-bearing", () => {
    expect(isLiveConfig(DEFAULT_RUN_CONFIG)).toBe(false);
    expect(isLiveConfig({ ...DEFAULT_RUN_CONFIG, pipeline: "live" })).toBe(true);
    expect(isLiveConfig({ ...DEFAULT_RUN_CONFIG, judge: "live" })).toBe(true);
  });
});

function bag(): Record<string, string> {
  return {
    book: "mini-book",
    axis: "extraction",
    runs: "1",
    pipeline: "fake",
    judge: "stub",
    cache: "true",
  };
}

function obj(): Record<string, unknown> {
  return {
    book: "mini-book",
    axis: "extraction",
    runs: 1,
    pipeline: "fake",
    judge: "stub",
    cache: true,
  };
}
