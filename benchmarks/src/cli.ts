#!/usr/bin/env node
import { runCli } from "./runner.js";

const exitCode = runCli(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});

process.exitCode = exitCode;
