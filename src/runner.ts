// The parts of the GitHub Actions runner protocol that the action uses: inputs
// in INPUT_* variables, workflow commands on stdout, and step outputs appended
// to the file named by GITHUB_OUTPUT.
import fs from "node:fs";
import { EOL } from "node:os";

export type Env = Readonly<Record<string, string | undefined>>;

export class RunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerError";
  }
}

/** An input as the runner passes it, in INPUT_<NAME> with the name upper-cased; trimmed. */
export function getInput(env: Env, name: string): string {
  return (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

/** A workflow command line, its data escaped the way the runner decodes it. */
export function command(name: "add-mask" | "error", data: string): string {
  return `::${name}::${data.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;
}

/** The file the runner reads step outputs from. */
export function outputFile(env: Env): string {
  const file = env.GITHUB_OUTPUT;
  if (!file) throw new RunnerError("GITHUB_OUTPUT is not set: run the action as a step of a GitHub Actions job.");
  return file;
}

/** Appends one step output; `value` must be a single line. */
export function setOutput(file: string, name: string, value: string): void {
  fs.appendFileSync(file, `${name}=${value}${EOL}`);
}
