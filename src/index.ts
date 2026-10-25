// The entry point that action.yml runs, bundled into dist/index.mjs.
import fs from "node:fs";
import { EOL } from "node:os";

import { run } from "./action.ts";
import { command } from "./runner.ts";

// Synchronous, so that a line is out before process.exit() below.
function print(line: string): void {
  fs.writeSync(process.stdout.fd, `${line}${EOL}`);
}

// Node.js would print an error that escapes, with its message and stack. An
// SDK error's message can contain the request URL with the API key, so the
// step ends with a fixed message instead. Unhandled rejections arrive here
// too: Node.js raises them as uncaught exceptions.
process.on("uncaughtException", () => {
  print(command("error", "The action failed with an unexpected internal error."));
  process.exit(1);
});

process.exitCode = await run(process.env, print);
