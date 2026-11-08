# Site-Shot Screenshot GitHub Action

A GitHub Action that captures one public `https://` page as a PNG with the [Site-Shot](https://www.site-shot.com/) API and saves it in the job's workspace, by default as `site-shot-output/screenshot.png`. It is a thin adapter around the official [site-shot-sdk](https://www.npmjs.com/package/site-shot-sdk) for Node.js: the SDK talks to the API, and the action adds input checks, a PNG check and one checked place to write.

## Quick start

1. Get your API key at https://www.site-shot.com/start/. A confirmed account's key comes with the free plan: 100 API captures a month, no card needed.
2. Store the key as a repository secret named `SITESHOT_API_KEY` (Settings, Secrets and variables, Actions).
3. Add this workflow as `.github/workflows/screenshot.yml`, start it from the Actions tab with "Run workflow", and download the `screenshot` artifact from the run's summary page.

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
      - id: shot
        uses: site-shot/screenshot-action@v0.1.0
        with:
          url: https://www.example.com/
          api-key: ${{ secrets.SITESHOT_API_KEY }}
          width: 1280
          height: 800
      - uses: actions/upload-artifact@v4
        with:
          name: screenshot
          path: ${{ steps.shot.outputs.path }}
          if-no-files-found: error
```

Why it looks like this:

- `workflow_dispatch` runs the job only when someone with write access starts it. Every run makes a capture attempt that counts toward your plan; a `schedule` would make one on every run.
- It sets no `country`, so it works on the free plan, which captures from the default location or the US.
- The screenshot lives only on the runner until a later step keeps it: here `actions/upload-artifact` uploads it, and `if-no-files-found: error` fails the run if there is nothing to upload. You can commit it instead, in a job with `contents: write`.
- `contents: read` keeps the job's token read-only. The action itself uses no token.
- Never use the action in a `pull_request_target` workflow, or in any job that checks out or runs code from a pull request: that code could read the key. GitHub does not pass secrets to `pull_request` runs from forks; keep it that way.

`v0.1.0` is the current release tag. Inputs and messages marked "main only" below are in this repository's `main` branch and not yet in a release; until one includes them, a workflow that uses them has to point at `main` or at a commit (`uses: site-shot/screenshot-action@<commit SHA>`).

## Inputs and output

| Input | Required | Default | Value |
|---|---|---|---|
| `url` | yes | | A public `https://` page. Refused before anything is sent: other schemes, a user name or password, IP addresses, `localhost`, single-label host names, and reserved names such as `.local`, `.internal` and `.test`. Host names are not resolved: Site-Shot refuses an address it must not capture. |
| `api-key` | yes | | Your Site-Shot API key, from a secret such as `${{ secrets.SITESHOT_API_KEY }}`. Never write the key into a workflow. |
| `width` | no | `1024` | Viewport width in pixels, 100 to 8000. |
| `height` | no | `768` | Viewport height in pixels, 100 to 20000. |
| `country` | no | | A two-letter ISO 3166-1 alpha-2 country code, such as `US` or `DE` (`UK` is also accepted, and Site-Shot reads it as `GB`); the capture is strict and fails rather than use another country. On the free plan only `US` works: Site-Shot refuses any other country, the step fails, and the refused attempt still counts toward the month's 100. Other countries need a [paid plan](https://www.site-shot.com/pricing/). In `v0.1.0` that refusal is reported as `APIError`; on `main` the line says that the country needs a paid plan. |
| `full-page` | no | `false` | main only. `true` captures the whole scrollable page, up to 20000 pixels high, instead of the viewport only. |
| `no-cookie-popup` | no | `false` | main only. `true` has Site-Shot remove cookie-consent banners before the capture. |
| `no-ads` | no | `false` | main only. `true` has Site-Shot remove ads before the capture. |
| `delay` | no | | main only. A wait before the capture in milliseconds, 0 to 60000. Empty uses Site-Shot's default of 500. The action waits about 90 seconds for Site-Shot in all, and the delay comes out of that time: with a long delay a slow page can run past the limit, the step fails, and the attempt may still count toward the plan. |
| `path` | no | `site-shot-output/screenshot.png` | main only. Where to save the PNG, relative to the workspace and ending in `.png`, such as `screenshots/home.png`. Missing directories are created. |

The output `path` is the saved PNG, relative to the workspace: the `path` input, or `site-shot-output/screenshot.png` in `v0.1.0`.

## What it does, and what it does not

- **One step, one page, one capture attempt, retries disabled.** The action calls the SDK's `capture` once, with `retries: 0`, and does not try again after a failure or a damaged answer. Every capture attempt that reaches Site-Shot can count toward your plan, failed ones and timeouts included.
- **The free plan** gives a confirmed account's key 100 API captures a month, one at a time, and renews every month; once the 100 are spent, the API refuses captures until it renews. [Paid plans](https://www.site-shot.com/pricing/) start at $5 a month for 2,000 captures, and the key stays the same. An account that has had a paid plan before does not get the free plan; an account confirmed before 2026-10-30 switches it on with one button on https://www.site-shot.com/start/.
- **The key** is masked in the log, and the action prints neither it nor the page URL, the request or Site-Shot's answer. The SDK sends it to `https://api.site-shot.com/` in the `userkey` query parameter of an HTTPS request.
- **PNG only, checked before anything is written**: the signature, the CRC of every chunk, the header, the order of the chunks, and image data that decompresses to exactly the rows the header describes. That is all a pass means. It does not mean the page showed what you expected: the PNG may show a cookie wall, a login form, an error page or a CAPTCHA.
- **One file, never replaced.** Before anything is sent, the action refuses an existing file at the output path, and a directory on the way that is a link or a file. It creates the file exclusively and never deletes a file that was there before the step. In `v0.1.0`, to capture a second page in the same job, move the first file away before the second step; on `main`, give each step its own `path`.
- **A trusted runner and workspace.** The checks and the creation of the file are separate operations, and Node.js cannot make them one. A process that swaps a directory on the way for a link in between can make the action create an empty directory or an empty file where the link leads; no image data goes there, and the step fails. Code that runs in the same job can read the API key too, so do not run untrusted code in that job.
- **Nothing else is written.** It uses no GitHub token and makes no commits, pushes, comments, pull requests, releases, artifacts, uploads or telemetry. Whether the PNG is uploaded, committed or kept is up to the later steps of your workflow.

## Errors

A failed step prints one error line. A failure found before the capture attempt names the input at fault and ends with "Nothing was sent to Site-Shot." A failed capture names the kind of SDK error (`AuthError`, `QuotaError`, `CountryUnavailableError`, `InvalidParamsError`, `SiteShotTimeoutError` or `APIError`), with the HTTP status when it is not a 2xx one.

On `main` (main only), the line also carries the API's `error_code` when there is one, and says what to do for the answers Site-Shot words in a known way, without printing Site-Shot's text:

- a rejected key, or a plan problem: check the key at https://www.site-shot.com/start/;
- the free plan's month used up: the renewal date, and the price of a paid plan;
- a country other than US on the free plan: it needs a paid plan;
- too many captures at once (HTTP 429): the free plan allows one at a time;
- a page that could not be opened, such as a host name that does not resolve: the API's `error_code`, `proxy_navigation_failed`;
- no answer within the action's time limit: Site-Shot may still finish the capture, and the attempt may count toward the plan.

A failed step does not promise that it left no file in every case. Its error line says so when the screenshot was saved but the `path` output could not be added to the runner's `GITHUB_OUTPUT` file, and when the workspace changed during the save, as described under "A trusted runner and workspace". Rarely, an I/O error while the new file is being written or closed can leave the file, empty, partly written or complete.

## Using a copy of the action

To run the action from your own repository instead of `site-shot/screenshot-action`, copy `action.yml`, `dist/` and `LICENSE` into it as `.github/actions/site-shot`, add `actions/checkout` with `persist-credentials: false` before the step, and use `uses: ./.github/actions/site-shot`.

## Development

Building, testing and the release status: see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

MIT. `dist/index.mjs` includes site-shot-sdk, MIT-licensed by Site-Shot; its license is at the top of that file.
