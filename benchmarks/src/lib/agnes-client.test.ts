import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_INTERVAL_MS,
  createAgnesClient,
  estimateTokens,
} from "./agnes-client.js";

interface Harness {
  readonly callsAt: number[];
  readonly sleeps: number[];
}

function harness(
  responses: readonly (unknown | Error)[],
  overrides: { readonly minIntervalMs?: number } = {},
): { client: ReturnType<typeof createAgnesClient>; io: Harness } {
  let time = 1_000;
  const callsAt: number[] = [];
  const sleeps: number[] = [];
  let next = 0;
  const client = createAgnesClient({
    apiKey: "test-key",
    ...(overrides.minIntervalMs !== undefined ? { minIntervalMs: overrides.minIntervalMs } : {}),
    send: async () => {
      callsAt.push(time);
      const response = responses[next++];
      if (response instanceof Error) throw response;
      return response;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    now: () => time,
  });
  return { client, io: { callsAt, sleeps } };
}

const RESPONSE_OK = { choices: [] };

describe("createAgnesClient", () => {
  it("refuses to construct without an API key", () => {
    expect(() =>
      createAgnesClient({
        apiKey: "  ",
        send: async () => RESPONSE_OK,
      }),
    ).toThrow(/api key/i);
  });

  it("spaces request starts by the configured interval via the injected clock", async () => {
    const { client, io } = harness([RESPONSE_OK, RESPONSE_OK], { minIntervalMs: 1_500 });
    await client.complete({ system: "s", user: "one" });
    await client.complete({ system: "s", user: "two" });
    expect(io.callsAt).toEqual([1_000, 2_500]);
    expect(io.sleeps).toEqual([1_500]);
  });

  it("serializes concurrent submissions into spaced request starts", async () => {
    const { client, io } = harness([RESPONSE_OK, RESPONSE_OK], { minIntervalMs: 800 });
    const first = client.complete({ system: "s", user: "a" });
    const second = client.complete({ system: "s", user: "b" });
    await Promise.all([first, second]);
    expect(io.callsAt[0]).toBe(1_000);
    expect(io.callsAt[1]).toBeGreaterThanOrEqual(1_800);
  });

  it("retries retriable statuses with exponential backoff, then succeeds", async () => {
    const rateLimited = Object.assign(new Error("rate limited"), { status: 429 });
    const busy = Object.assign(new Error("busy"), { status: 503 });
    // Zero gate interval so only the retry backoff produces sleeps.
    const { client, io } = harness([rateLimited, busy, RESPONSE_OK], { minIntervalMs: 0 });
    const response = await client.complete({ system: "s", user: "u" });
    expect(response).toEqual(RESPONSE_OK);
    expect(io.sleeps).toEqual([1_000, 2_000]);
    expect(io.callsAt).toHaveLength(3);
  });

  it("fails fast on non-retriable statuses without sleeping", async () => {
    const unauthorized = Object.assign(new Error("nope"), { status: 401 });
    const { client, io } = harness([unauthorized, RESPONSE_OK]);
    await expect(client.complete({ system: "s", user: "u" })).rejects.toThrow(/nope/u);
    expect(io.callsAt).toHaveLength(1);
    expect(io.sleeps).toEqual([]);
  });

  it("gives up after exhausting retries, rethrowing the final cause", async () => {
    const overload = Object.assign(new Error("still busy"), { status: 520 });
    const { client } = harness([overload, overload, overload, overload], {
      minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    });
    await expect(client.complete({ system: "s", user: "u" })).rejects.toThrow(/still busy/u);
  });

  it("estimates tokens at roughly four characters each", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("abc")).toBe(1);
  });
});
