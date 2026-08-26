#!/usr/bin/env node
import { runCli } from "./runner.js";

runCli(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
})
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((cause: unknown) => {
    console.error(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
    process.exitCode = 1;
  });
