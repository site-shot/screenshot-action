// Runs the action in-process the way the runner would, against the installed
// site-shot-sdk: only its transport, the global fetch, is replaced by a stub
// that records each request and answers from the test.
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { run } from "../../src/action.ts";
import { captured, json } from "./api.ts";
import { fixture } from "./png.ts";

export const KEY = "sk-test-KEYMARKER-0123456789";
export const TARGET = "https://www.example.com/pricing/?ref=target-query-marker&token=TARGETTOKEN";
export const SCREENSHOT = fixture("viewport-1024x768.png");

/** An API answer or error text that quotes everything that must stay out of the log. */
export const HOSTILE = `BODY-MARKER ${KEY} https://api.site-shot.com/?url=${encodeURIComponent(TARGET)}&userkey=${KEY}`;

/** Text that no printed line except the first, the mask, and no output may contain. */
export const LEAKS = [
  "KEYMARKER",
  "target-query-marker",
  "TARGETTOKEN",
  "www.example.com",
  "api.site-shot.com",
  "userkey",
  "BODY-MARKER",
  "iVBORw0KGgo", // the base64 of the PNG signature
  "data:image",
];

export function leaksIn(text: string): string[] {
  return LEAKS.filter((leak) => text.includes(leak));
}

export interface Paths {
  workspace: string;
  outside: string;
  outputFile: string;
}

export interface Call {
  url: URL;
  init: RequestInit | undefined;
}

export type Reply = Response | Error | ((call: Call, paths: Paths) => Response | Promise<Response>);

export interface ActionRun extends Paths {
  code: number;
  lines: string[];
  calls: Call[];
  /** What the action appended to the GITHUB_OUTPUT file. */
  outputs: string;
}

export interface RunOptions {
  /** Inputs to change; the others are the action.yml defaults plus TARGET and KEY. */
  inputs?: Record<string, string>;
  /** Environment to change; undefined removes a variable. */
  env?: Record<string, string | undefined>;
  reply?: Reply;
  /** Runs before the action, to arrange the workspace. */
  arrange?: (paths: Paths) => void;
}

export function inputEnv(inputs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(inputs).map(([name, value]) => [`INPUT_${name.toUpperCase()}`, value]));
}

export async function runAction(t: TestContext, options: RunOptions = {}): Promise<ActionRun> {
  const base = fs.mkdtempSync(join(tmpdir(), "site-shot-action-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const paths: Paths = {
    workspace: join(base, "workspace"),
    outside: join(base, "outside"),
    outputFile: join(base, "github-output"),
  };
  fs.mkdirSync(paths.workspace);
  fs.mkdirSync(paths.outside);
  fs.writeFileSync(paths.outputFile, "");
  options.arrange?.(paths);

  const env: Record<string, string | undefined> = {
    ...inputEnv({ url: TARGET, "api-key": KEY, width: "1024", height: "768", country: "", ...options.inputs }),
    GITHUB_WORKSPACE: paths.workspace,
    GITHUB_OUTPUT: paths.outputFile,
  };
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }

  const calls: Call[] = [];
  const reply = options.reply ?? json(captured(SCREENSHOT, TARGET));
  const fetchStub = t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: new URL(String(input)), init };
    calls.push(call);
    if (typeof reply === "function") return reply(call, paths);
    if (reply instanceof Error) throw reply;
    return reply;
  });

  const lines: string[] = [];
  try {
    const code = await run(env, (line) => lines.push(line));
    return { ...paths, code, lines, calls, outputs: fs.readFileSync(paths.outputFile, "utf8") };
  } finally {
    fetchStub.mock.restore();
  }
}

/** Every file and directory under `directory`, relative to it. */
export function tree(directory: string): string[] {
  return (fs.readdirSync(directory, { recursive: true }) as string[]).sort();
}
