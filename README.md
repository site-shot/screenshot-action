# Site-Shot Screenshot GitHub Action

A GitHub Action that captures one public `https://` page as a PNG with the [Site-Shot](https://www.site-shot.com/) API and saves it in the job's workspace as `site-shot-output/screenshot.png`. It is a thin adapter around the official [site-shot-sdk](https://www.npmjs.com/package/site-shot-sdk) for Node.js: the SDK talks to the API, and the action adds input checks, a PNG check and one checked place to write.

## Status: release candidate, not released; local and native offline acceptance passed

As of 2026-10-25:

- **Offline tests**: pass on Node.js 24.10.0 with site-shot-sdk 0.2.0. They replace the SDK's `fetch` with a stub, refuse every network connection, use synthetic images and never contact Site-Shot.
- **The largest PNG it accepts**: checked once, locally on one Mac with Node.js 24.10.0, through this exact bundle, with the offline tests' stub in place of Site-Shot. A synthetic 8000x20000 PNG with 16-bit RGBA went through the decoding, the PNG check and the write with a peak RSS of 2,706,407,424 bytes (2.52 GiB), and the action child process took 0.804 s, excluding fixture generation. That image compresses very well, to a 6.6 MiB PNG, so the check does not cover every image of that size, other operating systems or a GitHub runner.
- **Against the live Site-Shot API**: one capture, made locally through this exact bundle, not on a GitHub runner: `https://example.com/` as a 1024x768 PNG, country `DE` (strict), retries disabled. It succeeded, and the saved PNG shows that page, with its text and link readable. The API key was not given to GitHub. It is a single test capture of one page.
- **On a GitHub Actions runner**: one manual run of `.github/workflows/native-acceptance.yml`, on 2026-10-25, passed: https://github.com/site-shot/screenshot-action/actions/runs/40236678006, from commit `bad2c9b11626aa3b42d4ce1bef72f0b9992d44b1`. It ran on a standard `ubuntu-latest` runner, which reported Ubuntu 24.04.5. The runner itself ran the action with `uses: ./`, through `action.yml` and this exact bundle in `dist/`, on Node.js 24.21.0. Five runs of the action passed their checks, and so did the 66 offline tests. The run was offline, with a synthetic PNG, the tests' dummy key, the stub in place of Site-Shot and the network guard. It captured no page: no capture from a GitHub runner has been made.
- **Release**: none yet. The source is public at https://github.com/site-shot/screenshot-action, but there is no release tag, GitHub Release or GitHub Marketplace listing. Publishing to the GitHub Marketplace requires acceptance of the GitHub Marketplace Developer Agreement; Marketplace publication is pending.

The release is a separate step, with its own approval and evidence. An approval for live captures has to list every capture attempt it allows, including those expected to fail and those whose outcome turns out unknown, because each one can be billed.

## What it does, and what it does not

- **One step, one page, one capture attempt, retries disabled.** The action calls the SDK's `capture` once, with `retries: 0`, and does not try again after a failure or a damaged answer. That attempt is one HTTP request unless the API redirects it: the SDK's `fetch` follows redirects. Every capture attempt that reaches Site-Shot can count toward your plan.
- **A paid Site-Shot API key** is required, from a GitHub Actions secret. The SDK sends it to `https://api.site-shot.com/` in the `userkey` query parameter of an HTTPS request, which is how the API authenticates; it is not sent in a header. The action masks the key in the log, and prints neither it nor the page URL, the request or Site-Shot's answer.
- **Strict country.** When `country` is set, the capture request always carries `strict_country=1`: if Site-Shot has no capacity in that country, the step fails instead of capturing from another one, which the API would otherwise do. The code is upper-cased and sent as written, never mapped to another; Site-Shot itself reads `UK` as `GB`.
- **PNG only, checked before anything is written**: the signature, the CRC of every chunk, the header, the order of the chunks, and image data that decompresses to exactly the rows the header describes. That is all a pass means. It does not mean the page showed what you expected: the PNG may show a cookie wall, a login form, an error page or a CAPTCHA.
- **One file**, `site-shot-output/screenshot.png` relative to the workspace, also given as the `path` output. Before anything is sent, the action refuses a `site-shot-output` that is a link or a file, and an existing `screenshot.png` of any kind. It creates the file exclusively, so it never replaces one. It never deletes a file that was there before the step and does not clean up earlier screenshots: to capture a second page in the same job, move the first file away before the second step. The one file it deletes is its own new `screenshot.png`, when writing it fails partway.
- **A trusted runner and workspace.** The checks and the creation of the file are separate operations, and Node.js cannot make them one. A process that swaps `site-shot-output`, or a directory above it, for a link in between can make the action create an empty directory or an empty `screenshot.png` where the link leads. The action checks where the new file is before writing to it, so no image data goes there, and the step fails. It does not defend against such a process; code that runs in the same job can read the API key too, so do not run untrusted code in that job.
- **Nothing else is written.** On the runner, the action writes only `site-shot-output/screenshot.png` in the workspace, creating `site-shot-output` if it is missing, and the `path` output. It uses no GitHub token, so it needs no token permissions, and it makes no commits, pushes, comments, pull requests, releases, artifacts, uploads or telemetry. Whether the PNG is committed, uploaded or kept is up to the later steps of your workflow.

## Inputs and output

| Input | Required | Default | Value |
|---|---|---|---|
| `url` | yes | | A public `https://` page. Refused before anything is sent: other schemes, a user name or password, IP addresses, `localhost`, single-label host names, and reserved names such as `.local`, `.internal` and `.test`. Host names are not resolved: Site-Shot refuses an address it must not capture. |
| `api-key` | yes | | A paid Site-Shot API key, from a secret. |
| `width` | no | `1024` | Viewport width in pixels, 100 to 8000. |
| `height` | no | `768` | Viewport height in pixels, 100 to 20000. |
| `country` | no | | A two-letter country code (ISO 3166-1 alpha-2), such as `DE`. |

The output `path` is always `site-shot-output/screenshot.png`.

## Example

Until a release exists, use the action as a local action: copy `action.yml`, `dist/` and `LICENSE` from this directory into your repository as `.github/actions/site-shot`, and store your API key as the repository secret `SITE_SHOT_API_KEY`.

```yaml
name: Screenshot
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  screenshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - id: shot
        uses: ./.github/actions/site-shot
        with:
          url: https://www.example.com/
          api-key: ${{ secrets.SITE_SHOT_API_KEY }}
          width: 1280
          height: 800
          country: DE
      - run: ls -l "$SCREENSHOT"
        env:
          SCREENSHOT: ${{ steps.shot.outputs.path }}
```

Why it looks like this:

- `workflow_dispatch` runs the job only when someone with write access starts it, and every run makes a capture attempt that can be billed. A `schedule` would make one on every run.
- Never use the action in a `pull_request_target` workflow, or in any job that checks out or runs code from a pull request: that code could read the key, and for a local action it could replace the action itself. GitHub does not pass secrets to `pull_request` runs from forks; keep it that way.
- `contents: read` is for the checkout only. The action itself uses no token.
- The output reaches the shell through `env`, not through `${{ }}` inside `run`.

## Errors

A failed step prints one error line. The line names the input at fault, or the kind of SDK error (`AuthError`, `QuotaError`, `CountryUnavailableError`, `InvalidParamsError`, `SiteShotTimeoutError` or `APIError`) with the HTTP status when it is not a 2xx one. A failure found before the capture attempt ends with "Nothing was sent to Site-Shot."

A failed step does not promise that it left no file. Its error line says so when the screenshot was saved but the `path` output could not be added to the runner's `GITHUB_OUTPUT` file, and when the workspace changed during the save, which can leave an empty directory or file where the changed path led, as described under "A trusted runner and workspace". Rarely, an I/O error while the new file is being checked, written, removed again or closed fails the step and can leave the file, empty, partly written or complete, even when the error line says that the screenshot was not saved.

## Development

Building and testing: see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

MIT. `dist/index.mjs` includes site-shot-sdk, MIT-licensed by Site-Shot; its license is at the top of that file.
