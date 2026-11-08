// The action's contract outside its code: action.yml, the locked SDK, and the
// example workflow in the README.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "yaml";

import { runAction } from "./support/action.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function read(path: string): string {
  return fs.readFileSync(join(ROOT, path), "utf8");
}

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

const METADATA = parse(read("action.yml")) as {
  inputs: Record<string, { required?: boolean; default?: unknown }>;
  outputs: Record<string, unknown>;
  runs: Record<string, unknown>;
};

/** The workflow in the README's yaml code block. */
function readmeWorkflow(): { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, { steps: Step[] }> } {
  const blocks = [...read("README.md").matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((match) => parse(match[1] ?? ""));
  const workflows = blocks.filter((block) => block && typeof block === "object" && "jobs" in block);
  assert.equal(workflows.length, 1, "one example workflow in the README");
  return workflows[0];
}

function actionStep(steps: Step[]): Step & { with: Record<string, unknown> } {
  const step = steps.find((candidate) => candidate.uses === "./.github/actions/site-shot");
  assert.ok(step?.with, "the example uses the action");
  return step as Step & { with: Record<string, unknown> };
}

test("action.yml declares a node24 JavaScript action that runs the bundle and nothing else", () => {
  assert.deepEqual(METADATA.runs, { using: "node24", main: "dist/index.mjs" });
});

test("action.yml declares the action's inputs, required ones without defaults, and its one output", () => {
  assert.deepEqual(Object.keys(METADATA.inputs), [
    "url",
    "api-key",
    "width",
    "height",
    "country",
    "full-page",
    "no-cookie-popup",
    "no-ads",
    "delay",
  ]);
  for (const name of ["url", "api-key"]) {
    assert.equal(METADATA.inputs[name]?.required, true, name);
    // A default API key would be a secret written into the action itself.
    assert.equal(METADATA.inputs[name]?.default, undefined, name);
  }
  assert.deepEqual(Object.keys(METADATA.outputs), ["path"]);
});

test("the SDK is site-shot-sdk 0.2.1, locked to the reviewed registry artifact, and the package cannot be published", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.dependencies, { "site-shot-sdk": "0.2.1" });
  const locked = JSON.parse(read("package-lock.json")).packages["node_modules/site-shot-sdk"];
  assert.equal(locked.version, "0.2.1");
  assert.equal(locked.resolved, "https://registry.npmjs.org/site-shot-sdk/-/site-shot-sdk-0.2.1.tgz");
  assert.equal(
    locked.integrity,
    "sha512-qpQqLVscDNAVNmee5tMR8ku0K+hy+cjvR8XxGfC2ojBsCNdvPpYPX7epZ3fLjD1rN7+I3q4SXXYz3tCriP5BOg==",
  );
  assert.equal(JSON.parse(read("node_modules/site-shot-sdk/package.json")).version, "0.2.1");
});

test("the README example runs on demand only, reads nothing it need not, and takes the key from a secret", () => {
  const workflow = readmeWorkflow();
  // No pull_request_target or other trigger that could run untrusted code with the secret.
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
  const step = actionStep(steps);
  assert.match(String(step.with["api-key"]), /^\$\{\{ secrets\.[A-Z0-9_]+ \}\}$/);
  for (const name of Object.keys(step.with)) assert.ok(name in METADATA.inputs, `undeclared input ${name}`);
  const checkout = steps.find((candidate) => candidate.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout?.with?.["persist-credentials"], false);
  for (const { run } of steps) {
    if (run !== undefined) assert.ok(!run.includes("${{"), `expression in a run script: ${run}`);
  }
});

test("the README example's inputs are accepted and sent as written", async (t) => {
  const settings = actionStep(Object.values(readmeWorkflow().jobs).flatMap((job) => job.steps)).with;
  const inputs = Object.fromEntries(
    Object.entries(settings)
      .filter(([name]) => name !== "api-key")
      .map(([name, value]) => [name, String(value)]),
  );
  const run = await runAction(t, { inputs });
  assert.equal(run.code, 0, run.lines.join("\n"));
  const params = (run.calls[0] as (typeof run.calls)[number]).url.searchParams;
  assert.equal(params.get("url"), inputs.url);
  assert.equal(params.get("width"), inputs.width);
  assert.equal(params.get("height"), inputs.height);
  assert.equal(params.get("country"), inputs.country?.toUpperCase());
  assert.equal(params.get("strict_country"), inputs.country ? "1" : null);
});
