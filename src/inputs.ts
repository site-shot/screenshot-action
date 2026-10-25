// Validates the action's inputs before anything is sent. An error names the
// input and never repeats its value: a page URL can carry a token in its
// query, and the API key is a secret.
import { isIP } from "node:net";

/** The capture API's viewport limits, as published in https://www.site-shot.com/openapi-capture.json. */
export const VIEWPORT = {
  width: { min: 100, max: 8000 },
  height: { min: 100, max: 20000 },
} as const;

export type InputName = "url" | "api-key" | "width" | "height" | "country";

export class InputError extends Error {
  readonly input: InputName;

  constructor(input: InputName, message: string) {
    super(message);
    this.name = "InputError";
    this.input = input;
  }
}

const WHITESPACE_OR_CONTROL = /[\x00-\x20\x7f]/;

// Top-level domains that never name a public host: the special-use names of
// RFC 6761, 6762, 7686, 8375 and 9476, and ICANN's private-use .internal.
const NON_PUBLIC_TLDS = new Set(["alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion", "test"]);

export function parseApiKey(value: string): string {
  if (value === "") {
    throw new InputError("api-key", "Input api-key is required: pass a paid Site-Shot API key from a GitHub Actions secret.");
  }
  if (WHITESPACE_OR_CONTROL.test(value)) {
    throw new InputError("api-key", "Input api-key must be one API key, without spaces or line breaks.");
  }
  return value;
}

/**
 * Returns the URL in its normalized form. Only the form is checked, the host
 * name is not resolved: Site-Shot itself refuses an address it must not
 * capture.
 */
export function parsePageUrl(value: string): string {
  // The URL parser would silently drop tabs and line breaks, so they are refused instead.
  const url = WHITESPACE_OR_CONTROL.test(value) ? null : URL.parse(value);
  if (url === null || url.protocol !== "https:") {
    throw new InputError("url", "Input url must be one absolute https:// address, such as https://www.example.com/.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new InputError("url", "Input url must not contain a user name or password.");
  }
  // A bracketed IPv6 address is serialized without dots, so it is one label
  // like `localhost`; an IPv4 address in any notation is normalized to
  // dotted decimal.
  const labels = url.hostname.replace(/\.$/, "").split(".");
  if (isIP(url.hostname) !== 0 || labels.length < 2 || NON_PUBLIC_TLDS.has(labels.at(-1) ?? "")) {
    throw new InputError(
      "url",
      "Input url must name a public host: IP addresses, localhost and local or reserved names are refused.",
    );
  }
  return url.href;
}

export function parseDimension(name: "width" | "height", value: string): number {
  const { min, max } = VIEWPORT[name];
  const pixels = /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
  if (!(pixels >= min && pixels <= max)) {
    throw new InputError(name, `Input ${name} must be a whole number of pixels from ${min} to ${max}.`);
  }
  return pixels;
}

/** Returns the code upper-cased, or undefined for no country. */
export function parseCountry(value: string): string | undefined {
  if (value === "") return undefined;
  if (!/^[A-Za-z]{2}$/.test(value)) {
    throw new InputError("country", "Input country must be empty or a two-letter country code, such as DE.");
  }
  return value.toUpperCase();
}
