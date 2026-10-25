// One step, one page, at most one capture attempt: the action checks its
// inputs and the place the screenshot will go, captures the page through the
// official site-shot-sdk with retries off, checks that the answer is a valid
// PNG and saves it. The SDK's fetch follows redirects, so the attempt is one
// HTTP request only if the API does not redirect it. Every line the action
// prints is written here. SDK errors are reported by kind only, because their
// text can carry the request URL with the API key, the page URL and the API's
// answer.
import {
  APIError,
  AuthError,
  CountryUnavailableError,
  InvalidParamsError,
  QuotaError,
  SiteShot,
  SiteShotTimeoutError,
  type CaptureOptions,
} from "site-shot-sdk";

import { InputError, VIEWPORT, parseApiKey, parseCountry, parseDimension, parsePageUrl } from "./inputs.ts";
import { OUTPUT_PATH, OutputError, prepareDestination, writeScreenshot, type Destination } from "./output.ts";
import { PngError, checkPng, type PngSize } from "./png.ts";
import { RunnerError, command, getInput, outputFile, setOutput, type Env } from "./runner.ts";

/** What each SDK error class means, in the order they are tested. */
const CAPTURE_ERRORS = [
  [
    CountryUnavailableError,
    "CountryUnavailableError",
    "Site-Shot has no capacity in the requested country right now, and a strict country capture does not fall back to another country",
  ],
  [AuthError, "AuthError", "Site-Shot rejected the API key"],
  [
    QuotaError,
    "QuotaError",
    "Site-Shot refused the capture because of the plan behind the key: quota used up, payment due, no active subscription or too many captures at once",
  ],
  [InvalidParamsError, "InvalidParamsError", "Site-Shot rejected the capture parameters"],
  [SiteShotTimeoutError, "SiteShotTimeoutError", "The capture timed out"],
  [
    APIError,
    "APIError",
    "The Site-Shot API request failed: a server error, an answer without a usable image, or a failed connection",
  ],
] as const;

interface Capture {
  apiKey: string;
  options: CaptureOptions;
  destination: Destination;
  outputs: string;
}

/** Runs the action and returns its exit code. `print` writes one line to stdout. */
export async function run(env: Env, print: (line: string) => void): Promise<number> {
  const apiKey = getInput(env, "api-key");
  // Masked before anything else is printed, although nothing printed contains it.
  if (apiKey !== "") print(command("add-mask", apiKey));

  let capture: Capture;
  try {
    capture = prepare(env, apiKey);
  } catch (error) {
    print(command("error", `${describe(error)} Nothing was sent to Site-Shot.`));
    return 1;
  }

  const { options } = capture;
  const country = options.country === undefined ? "" : `, country ${String(options.country)} (strict)`;
  print(
    `Capturing one page with Site-Shot at ${options.width}x${options.height}${country}: one capture attempt, retries disabled.`,
  );
  let png: Buffer;
  try {
    // retries: 0 is the SDK default as well; it is set here because every
    // attempt can count toward the plan.
    png = await new SiteShot(capture.apiKey, { retries: 0 }).capture(options);
  } catch (error) {
    print(command("error", `${describeCaptureError(error)} Nothing was saved, and the action does not retry.`));
    return 1;
  }

  let size: PngSize;
  try {
    size = checkPng(png, { maxWidth: VIEWPORT.width.max, maxHeight: VIEWPORT.height.max });
    writeScreenshot(capture.destination, png);
  } catch (error) {
    const message =
      error instanceof PngError
        ? `Site-Shot answered with an image that failed PNG validation: ${error.message}. Nothing was saved.`
        : `${describe(error)} The capture was made and may count toward the plan, but it was not saved.`;
    print(command("error", message));
    return 1;
  }

  try {
    setOutput(capture.outputs, "path", OUTPUT_PATH);
  } catch {
    print(command("error", `The screenshot was saved to ${OUTPUT_PATH}, but the path output could not be added to GITHUB_OUTPUT.`));
    return 1;
  }
  print(`Saved a ${size.width}x${size.height} PNG (${png.length} bytes) to ${OUTPUT_PATH}.`);
  return 0;
}

function prepare(env: Env, apiKey: string): Capture {
  const options: CaptureOptions = {
    url: parsePageUrl(getInput(env, "url")),
    width: parseDimension("width", getInput(env, "width")),
    height: parseDimension("height", getInput(env, "height")),
    format: "png",
  };
  const country = parseCountry(getInput(env, "country"));
  if (country !== undefined) {
    // Strict, always: without it the API would fall back to another country.
    options.country = country;
    options.strict_country = 1;
  }
  return {
    apiKey: parseApiKey(apiKey),
    options,
    outputs: outputFile(env),
    destination: prepareDestination(env.GITHUB_WORKSPACE),
  };
}

/** The message of an error raised by the action itself; anything else is unexpected. */
function describe(error: unknown): string {
  if (error instanceof InputError || error instanceof OutputError || error instanceof RunnerError) {
    return error.message;
  }
  return "The action failed with an unexpected error.";
}

function describeCaptureError(error: unknown): string {
  try {
    for (const [type, name, meaning] of CAPTURE_ERRORS) {
      if (error instanceof type) {
        // A capture that failed arrives as HTTP 200 with the failure in the
        // body; only a status that is not 2xx says something more.
        const status = error.httpStatus;
        const http =
          typeof status === "number" && Number.isInteger(status) && status >= 300 && status <= 599 ? `, HTTP ${status}` : "";
        return `${meaning} (${name}${http}).`;
      }
    }
  } catch {
    // A thrown value that throws when it is inspected is an unexpected error too.
  }
  return "The capture failed with an unexpected error.";
}
