/**
 * One-shot Agnes connectivity probe (not part of the benchmark suite):
 * verifies credentials, a plain completion, and a forced-tool verdict against
 * the configured model. Run from benchmarks/: node scripts/probe-agnes.ts
 */
import { readFileSync } from "node:fs";
import { createAgnesClient } from "../dist/lib/agnes-client.js";
import { firstForcedToolArguments, firstMessageContent } from "../dist/lib/agnes-response.js";

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

const plain = await client.complete({
  system: "You are a connectivity probe.",
  user: "Reply with exactly one word - READY - no symbols, new line or anything just READY",
  maxTokens: 64,
});
console.log("plain completion:", JSON.stringify(firstMessageContent(plain)));

const forced = await client.complete({
  system: "Decide equivalence only.",
  user: "Value A: half-brother\nValue B: brother\nAre these two values equivalent?",
  tools: [
    {
      type: "function",
      function: {
        name: "record_verdict",
        description: "Record whether the two values are equivalent.",
        parameters: {
          type: "object",
          properties: { verdict: { type: "string", enum: ["equivalent", "not_equivalent"] } },
          required: ["verdict"],
          additionalProperties: false,
        },
      },
    },
  ],
  forceToolName: "record_verdict",
  maxTokens: 1_024,
});
console.log("forced verdict:", firstForcedToolArguments(forced));
