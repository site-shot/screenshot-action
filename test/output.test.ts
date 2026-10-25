import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { prepareDestination, writeScreenshot } from "../src/output.ts";
import { fixture } from "./support/png.ts";

const PNG = fixture("gray16.png");

function reason(name: string) {
  return { name: "OutputError", reason: name };
}

/** A fresh workspace and a sibling directory outside it, both removed after the test. */
function setup(t: TestContext): { workspace: string; outside: string } {
  const base = fs.mkdtempSync(join(tmpdir(), "site-shot-action-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const workspace = join(base, "workspace");
  const outside = join(base, "outside");
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  return { workspace, outside };
}

function listing(directory: string): string[] {
  return fs.readdirSync(directory).sort();
}

/**
 * Removes a file, link or directory without following links. fs.rmSync is not
 * used for this: on Node.js 24 it leaves a dangling link in place even with
 * `force`, and refuses a link to a directory as "Path is a directory".
 */
function remove(path: string): void {
  const found = fs.lstatSync(path, { throwIfNoEntry: false });
  if (found?.isDirectory()) fs.rmSync(path, { recursive: true });
  else if (found !== undefined) fs.unlinkSync(path);
}

test("the workspace must be the absolute path of an existing directory", (t) => {
  const { workspace } = setup(t);
  fs.writeFileSync(join(workspace, "file"), "x");
  // "." exists, as the working directory of the tests, but is not absolute.
  for (const value of [undefined, "", ".", "workspace", join(workspace, "missing"), join(workspace, "file")]) {
    assert.throws(() => prepareDestination(value), reason("workspace"), String(value));
  }
});

test("a new screenshot goes to site-shot-output/screenshot.png under the real workspace path", (t) => {
  const { workspace } = setup(t);
  const real = fs.realpathSync(workspace);
  const destination = prepareDestination(workspace);
  assert.deepEqual(destination, {
    directory: join(real, "site-shot-output"),
    file: join(real, "site-shot-output", "screenshot.png"),
  });
  // Checking creates nothing: a failed capture leaves the workspace as it was.
  assert.deepEqual(listing(workspace), []);

  writeScreenshot(destination, PNG);
  assert.deepEqual(listing(workspace), ["site-shot-output"]);
  assert.deepEqual(listing(join(workspace, "site-shot-output")), ["screenshot.png"]);
  assert.deepEqual(fs.readFileSync(join(workspace, "site-shot-output", "screenshot.png")), PNG);
  assert.ok(fs.lstatSync(join(workspace, "site-shot-output")).isDirectory());
});

test("a workspace reached through a symbolic link is used at its real path", (t) => {
  const { workspace, outside } = setup(t);
  const link = join(outside, "link-to-workspace");
  fs.symlinkSync(workspace, link);
  const destination = prepareDestination(link);
  assert.equal(destination.file, join(fs.realpathSync(workspace), "site-shot-output", "screenshot.png"));
  writeScreenshot(destination, PNG);
  assert.deepEqual(fs.readFileSync(join(workspace, "site-shot-output", "screenshot.png")), PNG);
});

test("an existing real site-shot-output directory is used and its other files are left alone", (t) => {
  const { workspace } = setup(t);
  fs.mkdirSync(join(workspace, "site-shot-output"));
  fs.writeFileSync(join(workspace, "site-shot-output", "earlier.png"), "earlier");
  writeScreenshot(prepareDestination(workspace), PNG);
  assert.deepEqual(listing(join(workspace, "site-shot-output")), ["earlier.png", "screenshot.png"]);
  assert.equal(fs.readFileSync(join(workspace, "site-shot-output", "earlier.png"), "utf8"), "earlier");
});

test("site-shot-output that is a link or not a directory is refused before the capture", (t) => {
  const { workspace, outside } = setup(t);
  const output = join(workspace, "site-shot-output");
  fs.mkdirSync(join(workspace, "inside"));
  const cases: Record<string, () => void> = {
    "a link to a directory outside the workspace": () => fs.symlinkSync(outside, output),
    "a link to a directory inside the workspace": () => fs.symlinkSync(join(workspace, "inside"), output),
    "a dangling link": () => fs.symlinkSync(join(outside, "missing"), output),
    "a regular file": () => fs.writeFileSync(output, "not a directory"),
  };
  for (const [name, make] of Object.entries(cases)) {
    make();
    assert.throws(() => prepareDestination(workspace), reason("directory"), name);
    remove(output);
  }
  assert.deepEqual(listing(outside), []);
  assert.deepEqual(listing(join(workspace, "inside")), []);
});

test("an existing site-shot-output/screenshot.png of any kind is refused and left as it was", (t) => {
  const { workspace, outside } = setup(t);
  const output = join(workspace, "site-shot-output");
  const file = join(output, "screenshot.png");
  fs.mkdirSync(output);
  fs.writeFileSync(join(outside, "victim.txt"), "victim");
  const cases: Record<string, () => void> = {
    "a regular file": () => fs.writeFileSync(file, "caller's file"),
    "a link to a file outside the workspace": () => fs.symlinkSync(join(outside, "victim.txt"), file),
    "a dangling link": () => fs.symlinkSync(join(outside, "would-be-created.png"), file),
    "a directory": () => fs.mkdirSync(file),
  };
  for (const [name, make] of Object.entries(cases)) {
    make();
    assert.throws(() => prepareDestination(workspace), reason("exists"), name);
    remove(file);
  }
  assert.deepEqual(listing(outside), ["victim.txt"]);
  assert.equal(fs.readFileSync(join(outside, "victim.txt"), "utf8"), "victim");
});

test("a site-shot-output directory that cannot be searched is refused", (t) => {
  if (process.getuid?.() === 0) return t.skip("permissions do not apply to root");
  const { workspace } = setup(t);
  const output = join(workspace, "site-shot-output");
  fs.mkdirSync(output);
  fs.chmodSync(output, 0o000);
  try {
    assert.throws(() => prepareDestination(workspace), reason("directory"));
  } finally {
    fs.chmodSync(output, 0o755);
  }
});

test("a screenshot.png created by someone else during the capture is not replaced", (t) => {
  const { workspace, outside } = setup(t);
  const destination = prepareDestination(workspace);
  fs.mkdirSync(join(workspace, "site-shot-output"));
  fs.writeFileSync(destination.file, "written during the capture");
  assert.throws(() => writeScreenshot(destination, PNG), reason("exists"));
  assert.equal(fs.readFileSync(destination.file, "utf8"), "written during the capture");

  remove(destination.file);
  fs.symlinkSync(join(outside, "target.png"), destination.file);
  assert.throws(() => writeScreenshot(destination, PNG), reason("exists"), "a dangling link");
  assert.deepEqual(listing(outside), []);
});

test("site-shot-output replaced during the capture by a link or a file is refused", (t) => {
  const { workspace, outside } = setup(t);
  const output = join(workspace, "site-shot-output");
  for (const existedBefore of [false, true]) {
    if (existedBefore) fs.mkdirSync(output);
    const destination = prepareDestination(workspace);
    remove(output);
    fs.symlinkSync(outside, output);
    assert.throws(() => writeScreenshot(destination, PNG), reason("directory"), `link, existed: ${existedBefore}`);
    remove(output);
    fs.writeFileSync(output, "a file now");
    assert.throws(() => writeScreenshot(destination, PNG), reason("directory"), `file, existed: ${existedBefore}`);
    remove(output);
  }
  assert.deepEqual(listing(outside), []);
});

test("a workspace path that leads elsewhere by the time of writing is refused", (t) => {
  const { workspace, outside } = setup(t);
  const destination = prepareDestination(workspace);
  fs.mkdirSync(join(outside, "site-shot-output"));
  fs.renameSync(workspace, `${workspace}.moved`);
  fs.symlinkSync(outside, workspace);
  assert.throws(() => writeScreenshot(destination, PNG), reason("changed"));
  assert.deepEqual(listing(join(outside, "site-shot-output")), []);
});

test("a directory swapped for a link between the last check and the open receives no image data", (t) => {
  for (const swapBack of [false, true]) {
    const { workspace, outside } = setup(t);
    const output = join(workspace, "site-shot-output");
    const destination = prepareDestination(workspace);
    const realOpen = fs.openSync;
    const open = t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
      fs.renameSync(output, `${output}.moved`);
      fs.symlinkSync(outside, output);
      const fd = realOpen(...args);
      if (swapBack) {
        remove(output);
        fs.renameSync(`${output}.moved`, output);
      }
      return fd;
    });
    // The open itself went through the link: the action cannot prevent that,
    // only notice it and say that it left an empty file behind.
    assert.throws(
      () => writeScreenshot(destination, PNG),
      { ...reason("diverted"), message: /left empty/ },
      `swapped back: ${swapBack}`,
    );
    open.mock.restore();
    assert.equal(open.mock.callCount(), 1);
    assert.equal(fs.statSync(join(outside, "screenshot.png")).size, 0);
    assert.deepEqual(listing(swapBack ? output : `${output}.moved`), []);
  }
});

test("a file whose identity cannot be read after the open is closed and left in place", (t) => {
  const { workspace } = setup(t);
  const destination = prepareDestination(workspace);
  t.mock.method(fs, "fstatSync", () => {
    throw Object.assign(new Error("i/o error"), { code: "EIO" });
  });
  const close = t.mock.method(fs, "closeSync");
  assert.throws(() => writeScreenshot(destination, PNG), reason("write"));
  assert.equal(close.mock.callCount(), 1);
  // Without its identity the action cannot tell that the file is its own, so it does not delete it.
  assert.equal(fs.lstatSync(destination.file).size, 0);
});

test("a failed write leaves no partial screenshot behind", (t) => {
  const { workspace } = setup(t);
  const destination = prepareDestination(workspace);
  const realWrite = fs.writeSync;
  let calls = 0;
  t.mock.method(fs, "writeSync", (fd: number, data: Uint8Array) => {
    calls += 1;
    if (calls > 1) throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    return realWrite(fd, data, 0, 10);
  });
  assert.throws(() => writeScreenshot(destination, PNG), reason("write"));
  assert.equal(calls, 2);
  assert.deepEqual(listing(join(workspace, "site-shot-output")), []);
});

test("after a failed write only the file the action created is deleted", (t) => {
  const { workspace } = setup(t);
  const destination = prepareDestination(workspace);
  t.mock.method(fs, "writeSync", () => {
    // Before the write fails, someone else's file takes the place of the new one.
    fs.unlinkSync(destination.file);
    fs.writeFileSync(destination.file, "someone else's file");
    throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
  });
  assert.throws(() => writeScreenshot(destination, PNG), reason("write"));
  assert.equal(fs.readFileSync(destination.file, "utf8"), "someone else's file");
});
