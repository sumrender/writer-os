import { EXIT_OK, EXIT_USAGE, type CliIo, type RunCliOverrides } from "./types.js";
import { parseOptions } from "./flags.js";
import { commandValidate } from "./validation.js";
import { commandList, commandRun } from "./commands.js";
import { USAGE } from "./usage.js";

/**
 * The CLI surface: `runCli` turns an argv array into a command and an exit
 * code. Entry points supply their own io (process streams in production,
 * captured arrays in tests) and overrides (books root, sandboxed caches).
 */
export function runCli(
  argv: string[],
  io: CliIo,
  overrides: RunCliOverrides = {},
): Promise<number> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    io.stdout(USAGE);
    return Promise.resolve(EXIT_OK);
  }

  const [command, ...rest] = argv;
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions(rest);
  } catch (cause) {
    io.stderr(String(cause instanceof Error ? cause.message : cause));
    io.stderr(USAGE);
    return Promise.resolve(EXIT_USAGE);
  }

  switch (command) {
    case "validate":
      return Promise.resolve(commandValidate(options, io, overrides));
    case "run":
      return commandRun(options, io, overrides);
    case "list":
      return Promise.resolve(commandList(options, io, overrides));
    default:
      io.stderr(`unknown command: ${command}`);
      io.stderr(USAGE);
      return Promise.resolve(EXIT_USAGE);
  }
}
