# Developing the Site-Shot Screenshot action

For maintainers. Users read the [README](README.md).

## Layout

- `action.yml` - the action's metadata: inputs, the `path` output, and `runs: using: node24, main: dist/index.mjs`.
- `src/` - the action, in TypeScript that Node.js 24 runs as it is (only erasable syntax, no build step for the tests):
  - `action.ts` - the step: inputs, destination, one capture through site-shot-sdk with `retries: 0`, the PNG check, the write, and every message it prints;
  - `inputs.ts`, `png.ts`, `output.ts` - the input checks, the PNG validator, and the workspace checks and exclusive write;
  - `runner.ts` - the runner protocol: `INPUT_*` variables, `::add-mask::` and `::error::` commands, the `GITHUB_OUTPUT` file;
  - `index.ts` - the entry point, which also ends the step with a fixed message if an error escapes.
- `dist/index.mjs` - `src/` and site-shot-sdk bundled into one file by `scripts/build.ts` (esbuild), because the runner does not install dependencies. Generated: never edit it, rebuild it.
- `test/` - `node:test` tests and their support code; `test/fixtures/README.md` says where each fixture came from.
- `.github/workflows/native-acceptance.yml` - the manual native acceptance described below. It is the only workflow, and nothing starts it but a person.

## Commands

```sh
npm ci            # site-shot-sdk 0.2.0 and the dev tools, as locked
npm run check     # tsc, then the build, then every test
```

`npm run build` rewrites `dist/index.mjs`. `npm test` fails if the file is not the build of the current sources.

## The SDK

The action depends on exactly `site-shot-sdk@0.2.0`, locked in `package-lock.json` to the registry tarball with integrity `sha512-ctHA/2va7FFEdF1daLGG9bIeq/ycSDJvh5N1yt0aJVg0A1GTIEELLdGQZIxPK+b0ky0UbDJsoBX10G7dV6K3Sg==`. That tarball was checked on 2026-10-24: its runtime code differs from site-shot-sdk 0.1.3 only in the `SDK_VERSION` string, and its types only add `webp` to `format`, which the action does not use. The action relies on the SDK for everything on the wire: the endpoint, the `userkey` query parameter, `response_type=json`, the call to `fetch`, which follows redirects as it does by default, base64 decoding and the error classes. It adds no request of its own, no proxy and no fallback, and changes nothing in the SDK's transport.

Changing the SDK version is a reviewed change: read the new tarball, update the pin and the lock, rebuild, and update the assertions in `test/metadata.test.ts` that hold the version and integrity.

## Tests

Nothing in a test run can reach the network. `npm test` preloads `test/support/no-network.ts` into every test process and into every process the tests start: it refuses TCP and TLS connections other than loopback, DNS queries and UDP. `test/no-network.test.ts` checks that the guard is loaded and works, and the action tests check that it refused nothing. Site-Shot is always replaced by a stub of `fetch`, the SDK's transport, so the tests count `fetch` calls, one per capture attempt, not HTTP requests; the API key in the tests is a dummy.

- `png.test.ts` - the validator against PNG files from another encoder, and damaged files built from them one defect at a time: not a PNG, cut short, CRC, header, chunk order, image data, and a zlib stream that inflates to 1 GiB.
- `inputs.test.ts` - URL, width, height, country and key, accepted and refused, and that errors do not repeat a refused value.
- `output.test.ts` - the workspace and the destination in real temporary directories: links, dangling links, files in the way, a directory that cannot be read, changes during the capture, a directory swapped for a link between the last check and the open, which leaves an empty file where the link led and no image data, a file whose identity cannot be read after the open, and a failed write, after which only the file the action created is deleted.
- `action.test.ts` - the step in-process against the installed SDK: the one `fetch` call and its parameters, `strict_country=1` with a country, refusals before anything is sent, each kind of API error, answers that are not a valid PNG, files that appear during the capture, a saved screenshot whose `path` output cannot be set, and that the key, the page URL, the request and the answer never reach the log or the outputs, including errors made to carry them.
- `dist.test.ts` - the bundle as the runner runs it, from a copy of `action.yml` and `dist/` alone, with the defaults of `action.yml` as inputs; and that the bundle matches the sources.
- `metadata.test.ts` - `action.yml`, the SDK pin, and the example workflow in the README.

## Native acceptance

`.github/workflows/native-acceptance.yml` runs the action on a standard `ubuntu-latest` GitHub-hosted runner, offline. It has never run. Only a person can start it (`workflow_dispatch`). The job reads the repository with a read-only token that the checkout does not keep, uses no secret, and uploads and caches nothing. Its steps:

1. It stops unless `dist/index.mjs` has the SHA-256 written in the workflow, that of the accepted bundle (`f10db86c...`).
2. It installs the locked dependencies with `npm ci --ignore-scripts`, for the checks only: the action itself runs from `dist/`.
3. It makes `api.site-shot.com` resolve to the runner itself, in `/etc/hosts`.
4. It runs the action five times with `uses: ./`, so the runner itself reads `action.yml` and starts `dist/index.mjs` with its own node24. `NODE_OPTIONS` preloads three modules: `test/support/no-network.ts`, `test/support/fetch-stub.ts` and a stdout copier that the workflow writes to `RUNNER_TEMP`. The stub answers for the API, the guard refuses every other connection, and the copier keeps the printed lines and records the Node.js version and what the guard refused. If the runner did not apply `NODE_OPTIONS`, a run would fail to connect instead of reaching Site-Shot, and its check would fail.
5. A check after each run holds it to the offline tests' own constants:
   - one `fetch` call with exactly the expected parameters and headers, or none for a refusal before sending;
   - the step outcome, the `path` output and the saved PNG, byte for byte;
   - the printed lines, with none of the text the tests keep out of logs;
   - no connection refused by the guard, and node24 as the runtime;
   - a workspace unchanged apart from `site-shot-output`, which the check removes again.

   The five runs:
   - the defaults of `action.yml`;
   - a request for 1280x800 with a lower-case country. The request carries 1280x800 and `DE`, but the stub still answers with its 1024x768 PNG, which the action saves and reports as 1024x768: this run checks the request, not an image of the requested size;
   - a hostile 401 answer;
   - a width below the minimum;
   - an existing `screenshot.png`.

   The last three fail on purpose, and each leaves one error annotation.
6. It type-checks and runs the offline test suite, then checks that the bundle and the checkout are unchanged.

It tests the action's contract with the runner, not a capture: no page is captured and nothing is billed. The key is the tests' dummy key, and the runner shows it in the log among the action's inputs. `actions/checkout` and `actions/setup-node` are pinned to full commit SHAs.

## Known limits

- One capture attempt is one call to `fetch`, which follows redirects: if the API redirected, the attempt would take more than one HTTP request.
- The workspace checks and the creation of the file are separate calls: Node.js has no `openat()` to make them one. A concurrent swap of `site-shot-output`, or of a directory above it, for a link can make the action create an empty directory or an empty `screenshot.png` where the link leads. The check after the open then writes no image data and fails the step (`diverted` in `src/output.ts`, shown in `test/output.test.ts`). The removal of a partly written file goes by path after an identity check, so a swap at that moment could misdirect it too. The action trusts the runner and the workspace, and does not defend against such a process.
- If `fstat` fails right after the file is created, the action closes the file and fails the step, but leaves the empty file in place, because it cannot tell that the file is its own.
- If closing the new file fails, a rare I/O error such as `EIO`, or removing a partly written one fails, the error escapes `writeScreenshot`: the step fails with the unexpected-error line, which says the screenshot was not saved, and the file stays, complete or not. The action never promises that a failed step leaves no file.
- The PNG check inflates all image data in memory: for 8000x20000 that is 457.8 MiB at 8-bit RGB, 610.4 MiB with alpha and at most 1220.7 MiB at 16-bit. Node.js `inflateSync` collects the output in 16 KiB pieces and then copies them into one buffer, so for a moment it holds about twice that. For the largest 16-bit case, the whole process peaked at 2.52 GiB of RSS on one Mac (see "Verified locally"). Decompression stops at the size the header declares.

## Verified locally

Two checks went beyond the offline tests. Each ran once, locally and not on a GitHub runner, through the accepted bundle (`dist/index.mjs`, SHA-256 `f10db86c7e6d38046947690d71f469f8769c19b12f52994180cab78e29f8310c`) with site-shot-sdk 0.2.0:

- **The largest PNG the action accepts.** On one Mac with Node.js 24.10.0, the bundle ran as the runner runs it, with the offline tests' network guard and `fetch` stub. Its input was a synthetic 8000x20000 PNG with 16-bit RGBA, whose image data is 1,280,020,000 bytes. It decoded, checked and saved the image with a peak RSS of 2,706,407,424 bytes (2.52 GiB), and the action child process took 0.804 s, excluding fixture generation, against limits of 4 GiB and 120 s. The image repeats every 256 pixels and compresses to a 6.6 MiB PNG. So the result does not cover less compressible images of that size, other operating systems or GitHub runners.
- **One capture through the live Site-Shot API.** One attempt, with retries disabled: `https://example.com/` as a 1024x768 PNG, country `DE` with `strict_country=1`. It succeeded. The saved PNG, inspected by eye, shows that page with its text and link readable, not a blank page, a login form or a challenge. The API key was not given to GitHub. For this one attempt, an existing free demo access to the API was enabled for a short time and then restored. That is no offer of free captures: the action needs a paid API key.

## Not verified

- A run on a GitHub-hosted or self-hosted runner, on any operating system: the native acceptance workflow is prepared but has never run. The tests ran on macOS with Node.js 24.10.0; the bundle uses only Node.js built-ins.
- Any capture through the live Site-Shot API other than the one above: none from a GitHub runner, and none of another page, size or country. The API's error answers are tested only against the stub.
- Large images whose content compresses less well. A less compressible PNG of the largest size makes a larger answer, which takes memory on top of the decompression. The offline tests reach the size limits only with images of 8000x1 and 1x20000, and their largest image is 1024x768.
- The GitHub Marketplace requirements, and whether the name in `action.yml` is free there.

## Releasing

Nothing has been released, and this file plans or authorizes no run, capture or publication. Of the checks before a release, the two in "Verified locally" are done. Each remaining step needs its own explicit approval and evidence:
- a run of the native acceptance workflow;
- publication.

An approval for live captures has to list every real capture attempt it allows, including attempts expected to fail and attempts whose outcome turns out unknown, such as a timeout or a lost connection, because each one can be billed.

Publication would need:
- a public repository, planned as `site-shot/screenshot-action`, with this directory at its root;
- a release tag;
- a check that the action's name is free on the GitHub Marketplace;
- for a listing, acceptance of the GitHub Marketplace Developer Agreement.
