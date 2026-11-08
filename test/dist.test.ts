// The bundle that action.yml names, run the way the runner runs it: `node`
// on the file, the inputs in INPUT_* variables with the defaults of action.yml
// filled in, GITHUB_WORKSPACE as the working directory. It runs from a copy of
// action.yml and the bundle alone, without node_modules or package.json, and
// the bundled SDK's fetch is replaced by test/support/fetch-stub.ts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { parse } from "yaml";

import { bundle } from "../scripts/build.ts";
import { captured, failedCapture } from "./support/api.ts";
import { HOSTILE, KEY, SCREENSHOT, TARGET, inputEnv, leaksIn } from "./support/action.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const METADATA = parse(fs.readFileSync(join(ROOT, "action.yml"), "utf8")) as {
  inputs: Record<string, { default?: unknown }>;
  runs: { main: string };
};
const MAIN = METADATA.runs.main;
const PRELOADS = ["./support/no-network.ts", "./support/fetch-stub.ts"].map((file) => new URL(file, import.meta.url).href);

interface BundleRun {
  status: number | null;
  lines: string[];
  stderr: string;
  calls: { url: string; headers: unknown }[];
  workspace: string;
  outputs: string;
}

interface BundleOptions {
  inputs?: Record<string, string>;
  status?: number;
  body?: unknown;
  crash?: "exception" | "rejection";
}

function runBundle(t: TestContext, options: BundleOptions = {}): BundleRun {
  const base = fs.mkdtempSync(join(tmpdir(), "site-shot-bundle-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const copy = join(base, "action");
  fs.mkdirSync(dirname(join(copy, MAIN)), { recursive: true });
  fs.copyFileSync(join(ROOT, "action.yml"), join(copy, "action.yml"));
  fs.copyFileSync(join(ROOT, MAIN), join(copy, MAIN));
  const workspace = join(base, "workspace");
  fs.mkdirSync(workspace);
  const files = { outputs: join(base, "github-output"), calls: join(base, "calls"), body: join(base, "body") };
  fs.writeFileSync(files.outputs, "");
  fs.writeFileSync(files.calls, "");
  fs.writeFileSync(files.body, JSON.stringify(options.body ?? captured(SCREENSHOT, TARGET)));

  const defaults = Object.fromEntries(
    Object.entries(METADATA.inputs).flatMap(([name, input]) => (input.default === undefined ? [] : [[name, String(input.default)]])),
  );
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    ...inputEnv({ ...defaults, url: TARGET, "api-key": KEY, ...options.inputs }),
    GITHUB_WORKSPACE: workspace,
    GITHUB_OUTPUT: files.outputs,
    STUB_CALLS: files.calls,
    STUB_BODY: files.body,
    STUB_STATUS: String(options.status ?? 200),
    ...(options.crash ? { STUB_CRASH: options.crash, STUB_MESSAGE: HOSTILE } : {}),
  };
  const result = spawnSync(process.execPath, [...PRELOADS.flatMap((url) => ["--import", url]), join(copy, MAIN)], {
    cwd: workspace,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    status: result.status,
    lines: result.stdout.split("\n").filter((line) => line !== ""),
    stderr: result.stderr,
    calls: fs
      .readFileSync(files.calls, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as BundleRun["calls"][number]),
    workspace,
    outputs: fs.readFileSync(files.outputs, "utf8"),
  };
}

function assertNoLeaks(run: BundleRun): void {
  assert.equal(run.lines[0], `::add-mask::${KEY}`, run.lines.join("\n"));
  const shown = [...run.lines.slice(1), run.stderr, run.outputs].join("\n");
  assert.deepEqual(leaksIn(shown), [], shown);
}

test("the bundle is the build of the current sources and the installed SDK", async () => {
  assert.ok((await bundle()) === fs.readFileSync(join(ROOT, MAIN), "utf8"), "dist is stale: run npm run build");
});

test("the bundle captures one page as the runner runs it, with the defaults of action.yml", (t) => {
  const run = runBundle(t);
  assert.equal(run.status, 0, [...run.lines, run.stderr].join("\n"));
  assert.equal(run.stderr, "");
  assert.equal(run.calls.length, 1);
  const [call] = run.calls as [BundleRun["calls"][number]];
  const url = new URL(call.url);
  assert.equal(`${url.origin}${url.pathname}`, "https://api.site-shot.com/");
  assert.deepEqual([...url.searchParams].sort(), [
    ["format", "png"],
    ["height", "768"],
    ["response_type", "json"],
    ["url", TARGET],
    ["userkey", KEY],
    ["width", "1024"],
  ]);
  assert.deepEqual(call.headers, { accept: "application/json", "user-agent": "site-shot-sdk/0.2.1 node" });
  assert.deepEqual(fs.readFileSync(join(run.workspace, "site-shot-output", "screenshot.png")), SCREENSHOT);
  assert.equal(run.outputs, "path=site-shot-output/screenshot.png\n");
  assert.ok(run.lines.at(-1)?.startsWith("Saved a 1024x768 PNG"), run.lines.join("\n"));
  assertNoLeaks(run);
});

test("the bundle sends a country with strict_country=1", (t) => {
  const run = runBundle(t, { inputs: { country: "fr" } });
  assert.equal(run.status, 0, run.lines.join("\n"));
  const params = new URL((run.calls[0] as BundleRun["calls"][number]).url).searchParams;
  assert.deepEqual([params.getAll("country"), params.getAll("strict_country")], [["FR"], ["1"]]);
});

test("the bundle fails with exit code 1 and only its own words on an API error", (t) => {
  const cases: BundleOptions[] = [
    { status: 401, body: { message: HOSTILE } },
    { body: failedCapture(HOSTILE, 500, SCREENSHOT, TARGET) },
  ];
  for (const options of cases) {
    const run = runBundle(t, options);
    assert.equal(run.status, 1, run.lines.join("\n"));
    assert.equal(run.calls.length, 1);
    assert.equal(run.lines.filter((line) => line.startsWith("::error::")).length, 1, run.lines.join("\n"));
    assert.equal(fs.existsSync(join(run.workspace, "site-shot-output")), false);
    assert.equal(run.outputs, "");
    assertNoLeaks(run);
  }
});

test("the bundle refuses an invalid input before any request", (t) => {
  const run = runBundle(t, { inputs: { width: "8001" } });
  assert.equal(run.status, 1);
  assert.equal(run.calls.length, 0);
  assert.ok(run.lines.some((line) => line.startsWith("::error::Input width")), run.lines.join("\n"));
  assertNoLeaks(run);
});

test("a stray exception or unhandled rejection ends the step without its text", (t) => {
  for (const crash of ["exception", "rejection"] as const) {
    const run = runBundle(t, { crash });
    assert.equal(run.status, 1, `${crash}: ${run.lines.join("\n")}`);
    assert.equal(run.calls.length, 1);
    assert.ok(run.lines.includes("::error::The action failed with an unexpected internal error."), run.lines.join("\n"));
    // Node.js would print the error and its stack to stderr.
    assert.equal(run.stderr, "", crash);
    assertNoLeaks(run);
  }
});
