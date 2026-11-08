import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { captured, failedCapture, json } from "./support/api.ts";
import {
  HOSTILE,
  KEY,
  SCREENSHOT,
  TARGET,
  leaksIn,
  runAction,
  tree,
  type ActionRun,
  type Reply,
  type RunOptions,
} from "./support/action.ts";
import { refusals } from "./support/no-network.ts";
import { fixture } from "./support/png.ts";

after(() => assert.deepEqual(refusals, [], "a request tried to leave the machine"));

const OUTPUT = join("site-shot-output", "screenshot.png");

function errorLine(run: ActionRun): string {
  const errors = run.lines.filter((line) => line.startsWith("::error::"));
  assert.equal(errors.length, 1, run.lines.join("\n"));
  return errors[0] as string;
}

/** A failed run: exit code 1, no screenshot, no output, and the error line. */
function assertFailed(run: ActionRun, requests: number): string {
  assert.equal(run.code, 1, run.lines.join("\n"));
  assert.equal(run.calls.length, requests, "fetch calls to Site-Shot");
  assert.equal(fs.existsSync(join(run.workspace, OUTPUT)), false, "screenshot written");
  assert.equal(run.outputs, "");
  return errorLine(run);
}

test("captures the page with one fetch call through the installed SDK and saves the PNG", async (t) => {
  const run = await runAction(t);
  assert.equal(run.code, 0, run.lines.join("\n"));
  assert.equal(run.calls.length, 1);
  // One capture attempt, which is not always one HTTP request: fetch follows redirects.
  assert.equal(run.lines[1], "Capturing one page with Site-Shot at 1024x768: one capture attempt, retries disabled.");

  const [call] = run.calls as [ActionRun["calls"][number]];
  assert.equal(call.url.origin, "https://api.site-shot.com");
  assert.equal(call.url.pathname, "/");
  assert.deepEqual([...call.url.searchParams].sort(), [
    ["format", "png"],
    ["height", "768"],
    ["response_type", "json"],
    ["url", "https://www.example.com/pricing/?ref=target-query-marker&token=TARGETTOKEN"],
    ["userkey", KEY],
    ["width", "1024"],
  ]);
  // The request comes from the installed site-shot-sdk 0.2.1, not from the action.
  assert.deepEqual(call.init?.headers, { accept: "application/json", "user-agent": "site-shot-sdk/0.2.1 node" });

  assert.deepEqual(tree(run.workspace), ["site-shot-output", OUTPUT]);
  assert.deepEqual(fs.readFileSync(join(run.workspace, OUTPUT)), SCREENSHOT);
  assert.equal(run.outputs, "path=site-shot-output/screenshot.png\n");
  const saved = run.lines.at(-1) ?? "";
  for (const fact of ["1024x768", "83819 bytes", "site-shot-output/screenshot.png"]) {
    assert.ok(saved.includes(fact), `"${fact}" in: ${saved}`);
  }
});

test("width, height and country are sent as given, the country always with strict_country=1", async (t) => {
  const run = await runAction(t, { inputs: { width: "1280", height: "800", country: "de" } });
  assert.equal(run.code, 0, run.lines.join("\n"));
  const params = (run.calls[0] as ActionRun["calls"][number]).url.searchParams;
  assert.equal(params.get("width"), "1280");
  assert.equal(params.get("height"), "800");
  assert.deepEqual(params.getAll("country"), ["DE"]);
  assert.deepEqual(params.getAll("strict_country"), ["1"]);

  const withoutCountry = await runAction(t);
  const plain = (withoutCountry.calls[0] as ActionRun["calls"][number]).url.searchParams;
  assert.equal(plain.has("country"), false);
  assert.equal(plain.has("strict_country"), false);
});

test("full-page, no-cookie-popup, no-ads and delay are sent only when set", async (t) => {
  const run = await runAction(t, {
    inputs: { "full-page": "true", "no-cookie-popup": "true", "no-ads": "true", delay: "2000", country: "us" },
  });
  assert.equal(run.code, 0, run.lines.join("\n"));
  assert.equal(
    run.lines[1],
    "Capturing one page with Site-Shot at 1024x768, full page, country US (strict), cookie banners removed, ads removed, delay 2000 ms: one capture attempt, retries disabled.",
  );
  const params = (run.calls[0] as ActionRun["calls"][number]).url.searchParams;
  assert.deepEqual(
    ["full_size", "no_cookie_popup", "no_ads", "delay_time"].map((name) => params.getAll(name)),
    [["1"], ["1"], ["1"], ["2000"]],
  );

  const off = await runAction(t, { inputs: { "full-page": "false", "no-cookie-popup": "false", "no-ads": "false", delay: "" } });
  assert.equal(off.code, 0, off.lines.join("\n"));
  const plain = (off.calls[0] as ActionRun["calls"][number]).url.searchParams;
  for (const name of ["full_size", "no_cookie_popup", "no_ads", "delay_time"]) assert.equal(plain.has(name), false, name);
  const zero = await runAction(t, { inputs: { delay: "0" } });
  assert.equal((zero.calls[0] as ActionRun["calls"][number]).url.searchParams.get("delay_time"), "0");
});

test("the path input saves the screenshot there, so a second capture in the job needs no move", async (t) => {
  const first = join("site-shot-output", "screenshot.png");
  const run = await runAction(t, {
    inputs: { path: "shots/pages/home.png" },
    arrange: (paths) => {
      fs.mkdirSync(join(paths.workspace, "site-shot-output"));
      fs.writeFileSync(join(paths.workspace, first), "the first capture");
    },
  });
  assert.equal(run.code, 0, run.lines.join("\n"));
  assert.deepEqual(fs.readFileSync(join(run.workspace, "shots", "pages", "home.png")), SCREENSHOT);
  assert.equal(fs.readFileSync(join(run.workspace, first), "utf8"), "the first capture");
  assert.equal(run.outputs, "path=shots/pages/home.png\n");
  assert.ok((run.lines.at(-1) ?? "").includes("to shots/pages/home.png."), run.lines.join("\n"));

  const top = await runAction(t, { inputs: { path: "home.png" } });
  assert.equal(top.code, 0, top.lines.join("\n"));
  assert.deepEqual(tree(top.workspace), ["home.png"]);

  const taken = await runAction(t, {
    inputs: { path: "shots/home.png" },
    arrange: (paths) => {
      fs.mkdirSync(join(paths.workspace, "shots"));
      fs.writeFileSync(join(paths.workspace, "shots", "home.png"), "committed");
    },
  });
  const line = assertFailed(taken, 0);
  assert.ok(line.includes("shots/home.png already exists"), line);
  assert.equal(fs.readFileSync(join(taken.workspace, "shots", "home.png"), "utf8"), "committed");

  const linked = await runAction(t, {
    inputs: { path: "shots/deep/home.png" },
    arrange: (paths) => fs.symlinkSync(paths.outside, join(paths.workspace, "shots")),
  });
  assert.ok(assertFailed(linked, 0).includes("shots/deep and every directory above it"), linked.lines.join("\n"));
  assert.deepEqual(fs.readdirSync(linked.outside), []);
});

test("inputs are trimmed, as a YAML block scalar ends with a line break", async (t) => {
  const run = await runAction(t, {
    inputs: { url: ` ${TARGET}\n`, "api-key": `${KEY}\n`, width: " 1280 ", height: "800\n", country: " de\n" },
  });
  assert.equal(run.code, 0, run.lines.join("\n"));
  assert.equal(run.lines[0], `::add-mask::${KEY}`);
  const params = (run.calls[0] as ActionRun["calls"][number]).url.searchParams;
  assert.deepEqual(
    ["url", "userkey", "width", "height", "country"].map((name) => params.get(name)),
    [TARGET, KEY, "1280", "800", "DE"],
  );
});

test("a key with a line break or a percent sign is masked as one escaped command", async (t) => {
  // The runner decodes %0A and %25; a raw line break would put the rest of the key on a line of its own.
  const cases: [string, string][] = [
    ["sk-first-half\nsk-second-half", "::add-mask::sk-first-half%0Ask-second-half"],
    ["sk-first-half\r\nsk-second-half", "::add-mask::sk-first-half%0D%0Ask-second-half"],
    ["sk-100%-key", "::add-mask::sk-100%25-key"],
  ];
  for (const [key, mask] of cases) {
    const run = await runAction(t, { inputs: { "api-key": key } });
    assert.equal(run.lines[0], mask);
    // A key with a line break is refused before anything is sent; a percent sign is allowed.
    const refused = /\s/.test(key);
    assert.equal(run.code, refused ? 1 : 0, run.lines.join("\n"));
    assert.equal(run.calls.length, refused ? 0 : 1);
    assert.ok(run.lines.slice(1).every((line) => !line.includes("second-half")), run.lines.join("\n"));
  }
});

test("an invalid input fails before any request and leaves the workspace untouched", async (t) => {
  const cases: [Record<string, string>, string][] = [
    [{ url: "" }, "Input url"],
    [{ url: "http://www.example.com/" }, "Input url"],
    [{ url: "https://localhost/" }, "Input url"],
    [{ width: "99" }, "Input width"],
    [{ width: "wide" }, "Input width"],
    [{ height: "20001" }, "Input height"],
    [{ country: "DEU" }, "Input country"],
    [{ country: "ZZ" }, "Input country"],
    [{ "full-page": "yes" }, "Input full-page"],
    [{ "no-cookie-popup": "1" }, "Input no-cookie-popup"],
    [{ "no-ads": "TRUE" }, "Input no-ads"],
    [{ delay: "60001" }, "Input delay"],
    [{ delay: "2s" }, "Input delay"],
    [{ path: "../outside.png" }, "Input path"],
    [{ path: "/tmp/screenshot.png" }, "Input path"],
    [{ path: ".git/screenshot.png" }, "Input path"],
    [{ path: "shots//home.png" }, "Input path"],
    [{ path: "shots/home.jpg" }, "Input path"],
    [{ path: "shots\\home.png" }, "Input path"],
    [{ "api-key": "" }, "Input api-key"],
    [{ "api-key": "two words" }, "Input api-key"],
  ];
  for (const [inputs, expected] of cases) {
    const run = await runAction(t, { inputs });
    const line = assertFailed(run, 0);
    assert.ok(line.includes(expected), line);
    assert.ok(line.includes("Nothing was sent to Site-Shot."), line);
    assert.deepEqual(tree(run.workspace), []);
  }
});

test("an unusable runner environment or output location fails before any request", async (t) => {
  const cases: [string, RunOptions, string][] = [
    ["no workspace", { env: { GITHUB_WORKSPACE: undefined } }, "GITHUB_WORKSPACE"],
    ["no output file", { env: { GITHUB_OUTPUT: undefined } }, "GITHUB_OUTPUT"],
    [
      "site-shot-output is a link",
      { arrange: (paths) => fs.symlinkSync(paths.outside, join(paths.workspace, "site-shot-output")) },
      "site-shot-output",
    ],
    [
      "the screenshot exists",
      {
        arrange: (paths) => {
          fs.mkdirSync(join(paths.workspace, "site-shot-output"));
          fs.writeFileSync(join(paths.workspace, OUTPUT), "caller's file");
        },
      },
      "already exists",
    ],
  ];
  for (const [name, options, expected] of cases) {
    const run = await runAction(t, options);
    assert.equal(run.code, 1, name);
    assert.equal(run.calls.length, 0, name);
    const line = errorLine(run);
    assert.ok(line.includes(expected), `${name}: ${line}`);
    assert.ok(line.includes("Nothing was sent to Site-Shot."), `${name}: ${line}`);
    assert.deepEqual(fs.readdirSync(run.outside), [], name);
    if (name === "the screenshot exists") {
      assert.equal(fs.readFileSync(join(run.workspace, OUTPUT), "utf8"), "caller's file");
    }
  }
});

test("each kind of API failure fails the step with its own error, after one fetch call and with no file", async (t) => {
  // A failure during the capture arrives as HTTP 200 with `error` in the body:
  // only a status that is not 2xx is worth reporting.
  const cases: [string, Reply, string, number | undefined][] = [
    ["key rejected", json({ message: "Invalid authentication credentials" }, 401), "AuthError", 401],
    ["no subscription", json({ message: "No active subscription found" }, 403), "QuotaError", 403],
    ["too many captures", json({ message: "API rate limit exceeded" }, 429), "QuotaError", 429],
    [
      "no capacity in the country",
      json(failedCapture("country_unavailable", 503, SCREENSHOT, TARGET)),
      "CountryUnavailableError",
      undefined,
    ],
    [
      "capture failed, with a placeholder PNG",
      json(failedCapture("Screenshot capture failed", 500, SCREENSHOT, TARGET)),
      "APIError",
      undefined,
    ],
    ["parameters rejected", json({ message: "width is out of range" }, 400), "InvalidParamsError", 400],
    [
      "render timed out",
      json(failedCapture("Timeout: render timed out", 504, SCREENSHOT, TARGET)),
      "SiteShotTimeoutError",
      undefined,
    ],
    ["gateway error page", new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 }), "APIError", 502],
    ["connection failure", new TypeError("fetch failed"), "APIError", undefined],
    [
      "client-side timeout",
      Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
      "SiteShotTimeoutError",
      undefined,
    ],
  ];
  for (const [name, reply, kind, status] of cases) {
    const run = await runAction(t, { inputs: { country: "DE" }, reply });
    const line = assertFailed(run, 1);
    assert.ok(line.includes(kind), `${name}: ${line}`);
    assert.equal(line.includes("HTTP "), status !== undefined, `${name}: ${line}`);
    if (status !== undefined) assert.ok(line.includes(`HTTP ${status}`), `${name}: ${line}`);
    assert.deepEqual(tree(run.workspace), [], name);
  }
});

test("a country the free plan does not cover fails the step with a line that says so, without Site-Shot's message", async (t) => {
  // In JSON mode Site-Shot refuses such a country with HTTP 200 and `error` in
  // the body, as the README says; only the "Geotargeting needs a paid plan"
  // prefix is stable, the rest of the sentence will change.
  const message = "Geotargeting needs a paid plan: MARKER-REST-OF-SENTENCE. Plans: https://www.site-shot.com/pricing/";
  const run = await runAction(t, { inputs: { country: "DE" }, reply: json({ error: message }) });
  const line = assertFailed(run, 1);
  assert.ok(line.includes("(QuotaError)."), line);
  assert.ok(line.includes("Site-Shot refused country DE"), line);
  assert.ok(line.includes("a country other than US needs a paid plan (https://www.site-shot.com/pricing/)"), line);
  assert.equal(line.includes("HTTP "), false, line);
  assert.equal(line.includes("MARKER-REST-OF-SENTENCE"), false, line);
  assert.deepEqual(tree(run.workspace), [], "workspace");
});

test("with a country set, a refusal for another reason is not reported as a country refusal", async (t) => {
  const used = "Free plan used up: 100 captures this month. It renews on 2026-11-30 (UTC).";
  const cases: [string, string, string[]][] = [
    ["free plan used up", used, ["renews on 2026-11-30 (UTC)", "(QuotaError)."]],
    ["no subscription", "No active subscription found", ["https://www.site-shot.com/start/", "(QuotaError)."]],
  ];
  for (const [label, message, expected] of cases) {
    const run = await runAction(t, { inputs: { country: "DE" }, reply: json({ error: message }) });
    const line = assertFailed(run, 1);
    for (const part of expected) assert.ok(line.includes(part), `${label}: ${line}`);
    assert.equal(line.includes("refused country"), false, `${label}: ${line}`);
  }
});

test("the answers Site-Shot words in a known way get a line that says what to do, without Site-Shot's text", async (t) => {
  const used =
    "Free plan used up: 100 captures this month. It renews on 2026-11-30 (UTC). A paid plan switches this key back on now; paid plans start at $5/month for 2,000 captures: https://www.site-shot.com/pricing/";
  const unresolvable = { ...failedCapture("504 Gateway Timeout", 504, SCREENSHOT, TARGET), error_code: "proxy_navigation_failed" };
  const hostNotFound = {
    ...failedCapture("Host not found: nonexistent-host.invalid. Check the URL for typos.", 0, SCREENSHOT, TARGET),
    error_code: "dns_lookup_failed",
  };
  const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  const cases: [string, Reply, string[]][] = [
    [
      "free plan used up",
      new Response(used, { status: 403 }),
      ["renews on 2026-11-30 (UTC)", "$5 a month for 2,000 captures (https://www.site-shot.com/pricing/)", "(QuotaError, HTTP 403)."],
    ],
    ["key rejected", json({ message: "Invalid authentication credentials" }, 401), ["https://www.site-shot.com/start/", "(AuthError, HTTP 401)."]],
    ["no subscription", json({ message: "No active subscription found" }, 403), ["https://www.site-shot.com/start/", "(QuotaError, HTTP 403)."]],
    ["parallel limit", json({ message: "API rate limit exceeded" }, 429), ["one at a time", "(QuotaError, HTTP 429)."]],
    [
      "unresolvable host",
      json(unresolvable),
      ["could not open the page", "host name resolves", "(SiteShotTimeoutError, error_code proxy_navigation_failed)."],
    ],
    ["host not found", json(hostNotFound), ["could not open the page", "host name resolves", "error_code dns_lookup_failed)."]],
    ["render timed out", json(failedCapture("Timeout: render timed out", 504, SCREENSHOT, TARGET)), ["counts toward the plan"]],
    ["client-side timeout", abort, ["may still finish the capture", "may count toward the plan", "(SiteShotTimeoutError)."]],
    [
      "no capacity in the country",
      json({ ...failedCapture("country_unavailable", 503, SCREENSHOT, TARGET), error_code: "http_503" }),
      ["(CountryUnavailableError, error_code http_503)."],
    ],
  ];
  for (const [name, reply, expected] of cases) {
    const run = await runAction(t, { reply });
    const line = assertFailed(run, 1);
    for (const text of expected) assert.ok(line.includes(text), `${name}: "${text}" in ${line}`);
    for (const text of ["Free plan used up", "Gateway", "right now", "Invalid authentication"]) {
      assert.equal(line.includes(text), false, `${name}: ${line}`);
    }
  }
});

test("an answer that is not a valid PNG fails the step with no file", async (t) => {
  const damaged = Buffer.from(SCREENSHOT);
  damaged[5000] = (damaged[5000] as number) ^ 0x01;
  const { image: _image, ...withoutImage } = captured(SCREENSHOT, TARGET);
  const cases: [string, Reply, string][] = [
    ["a JPEG", json(captured(fixture("photo.jpg"), TARGET)), "not a PNG"],
    ["a damaged PNG", json(captured(damaged, TARGET)), "CRC"],
    ["a cut-off PNG", json(captured(SCREENSHOT.subarray(0, 10_000), TARGET)), "incomplete"],
    ["no image", json(withoutImage), "APIError"],
    ["malformed base64", json({ ...withoutImage, image: "data:image/png;base64,!!!!" }), "APIError"],
    ["not JSON", new Response("<html>ok</html>", { status: 200 }), "APIError"],
  ];
  for (const [name, reply, expected] of cases) {
    const run = await runAction(t, { reply });
    const line = assertFailed(run, 1);
    assert.ok(line.includes(expected), `${name}: ${line}`);
    assert.deepEqual(tree(run.workspace), [], name);
  }
});

test("a screenshot.png that appears during the capture is not replaced", async (t) => {
  const run = await runAction(t, {
    reply: (_call, paths) => {
      fs.mkdirSync(join(paths.workspace, "site-shot-output"));
      fs.writeFileSync(join(paths.workspace, OUTPUT), "written during the capture");
      return json(captured(SCREENSHOT, TARGET));
    },
  });
  assert.equal(run.code, 1);
  assert.equal(run.calls.length, 1);
  const line = errorLine(run);
  assert.ok(line.includes("already exists"), line);
  assert.ok(line.includes("not saved"), line);
  assert.equal(fs.readFileSync(join(run.workspace, OUTPUT), "utf8"), "written during the capture");
  assert.equal(run.outputs, "");
});

test("a site-shot-output swapped for a link during the capture receives nothing", async (t) => {
  const run = await runAction(t, {
    arrange: (paths) => fs.mkdirSync(join(paths.workspace, "site-shot-output")),
    reply: (_call, paths) => {
      fs.rmSync(join(paths.workspace, "site-shot-output"), { recursive: true });
      fs.symlinkSync(paths.outside, join(paths.workspace, "site-shot-output"));
      return json(captured(SCREENSHOT, TARGET));
    },
  });
  assert.equal(run.code, 1);
  assert.equal(run.calls.length, 1);
  assert.ok(errorLine(run).includes("site-shot-output"));
  assert.deepEqual(fs.readdirSync(run.outside), []);
  assert.equal(run.outputs, "");
});

test("a screenshot saved without its path output fails the step and says that the file is there", async (t) => {
  // The runner creates GITHUB_OUTPUT as a file: appending to a directory fails.
  const directory = fs.mkdtempSync(join(tmpdir(), "site-shot-github-output-"));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const run = await runAction(t, { env: { GITHUB_OUTPUT: directory } });
  assert.equal(run.code, 1);
  assert.equal(run.calls.length, 1);
  assert.deepEqual(fs.readFileSync(join(run.workspace, OUTPUT)), SCREENSHOT);
  const line = errorLine(run);
  assert.ok(line.includes("saved to site-shot-output/screenshot.png"), line);
  assert.ok(line.includes("GITHUB_OUTPUT"), line);
  assert.ok(!line.includes("not saved"), line);
});

test("the key, the target URL, the request and the answer never reach the log or the outputs", async (t) => {
  const hostile = HOSTILE;
  const cases: [string, RunOptions][] = [
    ["a successful capture", {}],
    ["an invalid input", { inputs: { width: "1" } }],
    ["an error message carrying the key", { reply: json({ message: hostile }, 401) }],
    ["a capture error carrying the key", { reply: json(failedCapture(hostile, 500, SCREENSHOT, TARGET)) }],
    [
      "an error_code carrying the key",
      { reply: json({ ...failedCapture("Screenshot capture failed", 500, SCREENSHOT, TARGET), error_code: hostile }) },
    ],
    ["a refusal carrying the key", { reply: new Response(`Free plan used up. ${hostile}`, { status: 403 }) }],
    ["a plain-text error body", { reply: new Response(hostile, { status: 500 }) }],
    [
      "a fetch error quoting the request URL",
      {
        reply: (call) => {
          throw Object.assign(new TypeError(`Failed to parse URL from ${call.url.href}`), { cause: { hostile } });
        },
      },
    ],
    [
      "a body that fails while it is read",
      {
        reply: new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error(hostile));
            },
          }),
        ),
      },
    ],
    [
      "a thrown object that throws on every access",
      {
        reply: () => {
          throw new Proxy(
            {},
            {
              get: () => {
                throw new Error(hostile);
              },
              getPrototypeOf: () => {
                throw new Error(hostile);
              },
            },
          );
        },
      },
    ],
  ];
  for (const [name, options] of cases) {
    const run = await runAction(t, options);
    assert.equal(run.lines[0], `::add-mask::${KEY}`, `${name}: the key is masked first`);
    const shown = [...run.lines.slice(1), run.outputs].join("\n");
    assert.deepEqual(leaksIn(shown), [], `${name}:\n${shown}`);
  }
});
