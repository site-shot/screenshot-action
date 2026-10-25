// The one place the action writes: site-shot-output/screenshot.png in the
// job's workspace. Nothing is created before the capture has returned a valid
// PNG, and no existing file is replaced. A link in the way is refused, but the
// checks and the open are separate calls, as Node.js has no openat(): a
// directory swapped for a link between them is followed by the open. The check
// after the open notices that and writes no image data, which leaves an empty
// file where the link led. The runner and the workspace are trusted; a process
// that changes them during the step is not defended against.
import fs from "node:fs";
import { isAbsolute, join } from "node:path";

export const OUTPUT_DIRECTORY = "site-shot-output";
export const OUTPUT_FILE = "screenshot.png";
/** The `path` output: relative to the workspace, with forward slashes. */
export const OUTPUT_PATH = `${OUTPUT_DIRECTORY}/${OUTPUT_FILE}`;

export type OutputProblem = "workspace" | "directory" | "exists" | "changed" | "diverted" | "write";

const PROBLEMS: Record<OutputProblem, string> = {
  workspace:
    "GITHUB_WORKSPACE must be the absolute path of an existing directory: run the action as a step of a GitHub Actions job.",
  directory: `${OUTPUT_DIRECTORY} in the workspace must be a real directory that the action can read, not a link or a file.`,
  exists: `${OUTPUT_PATH} already exists, and the action never replaces a file: move or delete it before this step.`,
  changed: "The workspace changed while the screenshot was being saved, so the screenshot was not created.",
  diverted: `The workspace changed while the screenshot was being saved: the new ${OUTPUT_FILE} did not end up in the ${OUTPUT_DIRECTORY} directory that was checked, so it was left empty, without image data.`,
  write: `The screenshot could not be written to ${OUTPUT_PATH}.`,
};

export class OutputError extends Error {
  readonly reason: OutputProblem;

  constructor(reason: OutputProblem) {
    super(PROBLEMS[reason]);
    this.name = "OutputError";
    this.reason = reason;
  }
}

export interface Destination {
  /** site-shot-output under the real path of the workspace. */
  directory: string;
  file: string;
}

/** Checks, before the capture, that the screenshot can be saved. Creates nothing. */
export function prepareDestination(workspace: string | undefined): Destination {
  const root = workspace && isAbsolute(workspace) ? realDirectory(workspace) : undefined;
  if (root === undefined) throw new OutputError("workspace");
  const destination = { directory: join(root, OUTPUT_DIRECTORY), file: join(root, OUTPUT_DIRECTORY, OUTPUT_FILE) };

  let directory: fs.Stats | undefined;
  let file: fs.Stats | undefined;
  try {
    directory = fs.lstatSync(destination.directory, { throwIfNoEntry: false });
    file = directory?.isDirectory() ? fs.lstatSync(destination.file, { throwIfNoEntry: false }) : undefined;
  } catch {
    throw new OutputError("directory");
  }
  if (directory !== undefined && !directory.isDirectory()) throw new OutputError("directory");
  if (file !== undefined) throw new OutputError("exists");
  return destination;
}

/**
 * Saves the PNG: creates site-shot-output if it is missing, then the file with
 * an exclusive create, and checks again that both are where they should be.
 */
export function writeScreenshot(destination: Destination, png: Uint8Array): void {
  const directory = ensureDirectory(destination.directory);
  let fd: number;
  try {
    // "wx" is O_CREAT | O_EXCL: it fails on anything already there, a link included.
    fd = fs.openSync(destination.file, "wx", 0o644);
  } catch (error) {
    throw new OutputError(errorCode(error) === "EEXIST" ? "exists" : "write");
  }
  let file: fs.Stats | undefined;
  let problem: OutputProblem | undefined;
  try {
    file = fs.fstatSync(fd);
    // A directory swapped for a link just before the open has put the new
    // file elsewhere: it must be the file at the path, in the directory that
    // was checked.
    if (!isAt(destination.file, file) || !isAt(destination.directory, directory)) {
      problem = "diverted";
    } else {
      for (let offset = 0; offset < png.length; ) offset += fs.writeSync(fd, png, offset);
    }
  } catch {
    problem = "write";
  } finally {
    fs.closeSync(fd);
  }
  // Only a file known to be the one created here is deleted.
  if (problem === "write" && file !== undefined && isAt(destination.file, file)) fs.unlinkSync(destination.file);
  if (problem !== undefined) throw new OutputError(problem);
}

function realDirectory(path: string): string | undefined {
  try {
    const real = fs.realpathSync(path);
    return fs.statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

function ensureDirectory(path: string): fs.Stats {
  try {
    fs.mkdirSync(path);
  } catch {
    // It exists already, or cannot be made: the checks below decide which is fine.
  }
  let directory: fs.Stats;
  let real: string;
  try {
    directory = fs.lstatSync(path);
    real = fs.realpathSync(path);
  } catch {
    throw new OutputError("directory");
  }
  if (!directory.isDirectory()) throw new OutputError("directory");
  // The path was built from the real path of the workspace: if it resolves
  // elsewhere now, a directory above it has been replaced by a link.
  if (real !== path) throw new OutputError("changed");
  return directory;
}

/** Whether the entry at `path`, a link at its end not followed, is the one described by `expected`. */
function isAt(path: string, expected: fs.Stats): boolean {
  try {
    const found = fs.lstatSync(path, { throwIfNoEntry: false });
    return found !== undefined && found.dev === expected.dev && found.ino === expected.ino;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): unknown {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}
