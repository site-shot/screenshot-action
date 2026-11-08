// Built by `npm run build` from src/ with esbuild; do not edit.
// It includes site-shot-sdk 0.2.1 from the npm registry, under this license:
/*!
MIT License

Copyright (c) 2026 Site-Shot

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// src/index.ts
import fs3 from "node:fs";
import { EOL as EOL2 } from "node:os";

// node_modules/site-shot-sdk/dist/index.js
import { Buffer as Buffer2 } from "buffer";
import { writeFile } from "fs/promises";
var SiteShotError = class extends Error {
  httpStatus;
  body;
  constructor(message, options = {}) {
    super(
      message,
      options.cause !== void 0 ? { cause: options.cause } : void 0
    );
    this.name = new.target.name;
    this.httpStatus = options.httpStatus;
    this.body = options.body;
  }
};
var AuthError = class extends SiteShotError {
};
var QuotaError = class extends SiteShotError {
};
var CountryUnavailableError = class extends SiteShotError {
};
var InvalidParamsError = class extends SiteShotError {
};
var SiteShotTimeoutError = class extends SiteShotError {
};
var APIError = class extends SiteShotError {
};
var DEFAULT_BASE_URL = "https://api.site-shot.com/";
var SDK_VERSION = "0.2.1";
var DEFAULT_SERVER_TIMEOUT_MS = 6e4;
var CLIENT_TIMEOUT_HEADROOM_MS = 3e4;
var RESERVED_PARAMS = /* @__PURE__ */ new Set(["url", "userkey", "response_type", "request_headers"]);
function normalizeUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    throw new InvalidParamsError('Missing required "url" option.');
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(candidate);
  } catch {
    throw new InvalidParamsError(
      `Invalid url: "${trimmed}". Pass a web page URL such as https://example.com (bare domains like example.com are also accepted).`
    );
  }
  return candidate;
}
function appendParam(params, key, value) {
  if (value === void 0 || value === null) return;
  if (typeof value === "boolean") {
    params.append(key, value ? "1" : "0");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendParam(params, key, item);
    return;
  }
  params.append(key, String(value));
}
function stripDataUrlPrefix(image) {
  if (image.startsWith("data:")) {
    const comma = image.indexOf(",");
    if (comma !== -1) return image.slice(comma + 1);
  }
  return image;
}
function asErrorText(value) {
  return typeof value === "string" && value.trim() ? value : void 0;
}
function isAbortError(err) {
  return typeof err === "object" && err !== null && err.name === "AbortError";
}
var FREE_PLAN_REFUSAL = /free plan used up|free api trial used up|geotargeting needs a paid plan/;
function classifyError(status, errorText, body) {
  const opts = { httpStatus: status, body };
  const lower = (errorText ?? "").toLowerCase();
  if (lower === "country_unavailable") {
    return new CountryUnavailableError(
      "The requested country has no available capacity right now (country_unavailable). Retry later, or drop strict_country to allow the default US fallback.",
      opts
    );
  }
  if (FREE_PLAN_REFUSAL.test(lower)) {
    return new QuotaError(`Site-Shot free plan limit: ${errorText}`, opts);
  }
  if (/userkey|api.?key|invalid key|unauthoriz|authenticat/.test(lower) || status === 401) {
    return new AuthError(
      `Site-Shot rejected the API key${errorText ? `: ${errorText}` : ""}. Check the key or get one at https://www.site-shot.com/pricing/.`,
      opts
    );
  }
  if (status === 402 || status === 403 || status === 429 || /quota|limit exceed|payment|credit|subscription/.test(lower)) {
    return new QuotaError(
      `Site-Shot quota or payment issue${errorText ? `: ${errorText}` : ` (HTTP ${status})`}.`,
      opts
    );
  }
  if (status === 400 || /invalid|out of range|must be|unsupported/.test(lower)) {
    return new InvalidParamsError(
      `Site-Shot rejected the request parameters${errorText ? `: ${errorText}` : ` (HTTP ${status})`}.`,
      opts
    );
  }
  if (/time.?out|timed out/.test(lower)) {
    return new SiteShotTimeoutError(`Site-Shot render timed out: ${errorText}`, opts);
  }
  return new APIError(
    `Site-Shot API error${errorText ? `: ${errorText}` : ""} (HTTP ${status}).`,
    opts
  );
}
var SiteShot = class {
  apiKey;
  baseUrl;
  timeoutMs;
  retries;
  fetchImpl;
  constructor(apiKey, options = {}) {
    const key = apiKey ?? process.env.SITESHOT_API_KEY;
    if (!key || !String(key).trim()) {
      throw new AuthError(
        "Missing Site-Shot API key. Pass it to new SiteShot(apiKey) or set the SITESHOT_API_KEY environment variable. Get a key at https://www.site-shot.com/pricing/."
      );
    }
    this.apiKey = String(key).trim();
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs;
    this.retries = Math.max(0, options.retries ?? 0);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new APIError(
        "No fetch implementation available. site-shot-sdk requires Node.js >= 18 (built-in fetch) or an explicit fetchImpl option."
      );
    }
  }
  /**
   * Capture a screenshot and return the image bytes as a Buffer.
   */
  async capture(options) {
    const base64 = await this.captureBase64(options);
    const buf = Buffer2.from(base64, "base64");
    const expectedLength = Math.floor(base64.replace(/[\s=]/g, "").length * 3 / 4);
    if (buf.length === 0 || buf.length < expectedLength) {
      throw new APIError(
        `Site-Shot returned a malformed base64 image payload (decoded ${buf.length} bytes from ${base64.length} base64 characters).`
      );
    }
    return buf;
  }
  /**
   * Capture a screenshot and write it to `filePath`.
   */
  async captureToFile(options, filePath) {
    await writeFile(filePath, await this.capture(options));
  }
  /**
   * Capture a screenshot and return it as a plain base64 string (no data-URL
   * prefix) — handy for data URLs and LLM vision payloads.
   */
  async captureBase64(options) {
    const result = await this.captureJson(options);
    const image = typeof result.image === "string" ? result.image : void 0;
    if (!image) {
      throw new APIError("Site-Shot response did not contain an image.", { body: result });
    }
    return stripDataUrlPrefix(image);
  }
  /**
   * Capture and return the full JSON result (image, plus `source_code` and
   * any other metadata fields the API includes).
   */
  async captureJson(options) {
    const params = this.buildParams(options);
    params.set("response_type", "json");
    const endpoint = `${this.baseUrl}${this.baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
    const serverTimeout = Number(options.timeout);
    const timeoutMs = this.timeoutMs ?? (Number.isFinite(serverTimeout) && serverTimeout > 0 ? serverTimeout : DEFAULT_SERVER_TIMEOUT_MS) + CLIENT_TIMEOUT_HEADROOM_MS;
    let attempt = 0;
    for (; ; ) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let res;
        try {
          res = await this.fetchImpl(endpoint, {
            signal: controller.signal,
            headers: {
              accept: "application/json",
              "user-agent": `site-shot-sdk/${SDK_VERSION} node`
            }
          });
        } catch (err) {
          if (isAbortError(err)) {
            throw new SiteShotTimeoutError(
              `Site-Shot request timed out after ${timeoutMs} ms (client-side abort).`,
              { cause: err }
            );
          }
          if (attempt < this.retries) {
            attempt += 1;
            await backoff(attempt);
            continue;
          }
          throw new APIError(`Connection to the Site-Shot API failed: ${String(err)}`, {
            cause: err
          });
        }
        let text;
        try {
          text = await res.text();
        } catch (err) {
          if (isAbortError(err) || controller.signal.aborted) {
            throw new SiteShotTimeoutError(
              `Site-Shot request timed out after ${timeoutMs} ms while downloading the response body (client-side abort).`,
              { httpStatus: res.status, cause: err }
            );
          }
          throw new APIError(`Failed to read the Site-Shot API response body: ${String(err)}`, {
            httpStatus: res.status,
            cause: err
          });
        }
        return this.parseResponse(res, text);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  /**
   * Build the request URL without executing it (debugging, server-side
   * proxying). The URL is in the API's default image-response mode.
   *
   * ⚠️ The returned URL embeds your API key (`userkey`) and Site-Shot has no
   * signed-URL scheme — never expose it client-side (e.g. in an `<img src>`
   * on a public page). Server-side use only.
   */
  buildUrl(options) {
    const params = this.buildParams(options);
    return `${this.baseUrl}${this.baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }
  buildParams(options) {
    const params = new URLSearchParams();
    params.set("url", normalizeUrl(options.url));
    params.set("userkey", this.apiKey);
    for (const [key, value] of Object.entries(options)) {
      if (RESERVED_PARAMS.has(key)) continue;
      appendParam(params, key, value);
    }
    const headers = options.request_headers;
    if (headers && typeof headers === "object") {
      for (const [name, value] of Object.entries(headers)) {
        params.append("request_header", `${name}:${value}`);
      }
    }
    return params;
  }
  parseResponse(res, text) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = void 0;
    }
    if (json && typeof json === "object") {
      const envelope = json;
      const appError = asErrorText(envelope.error);
      if (appError) {
        throw classifyError(res.status, appError, envelope);
      }
      if (!res.ok) {
        throw classifyError(res.status, asErrorText(envelope.message), envelope);
      }
      return envelope;
    }
    if (!res.ok) {
      throw classifyError(res.status, text ? text.slice(0, 500) : void 0, text);
    }
    throw new APIError(
      `Unexpected non-JSON response from the Site-Shot API (HTTP ${res.status}).`,
      { httpStatus: res.status, body: text.slice(0, 500) }
    );
  }
};
async function backoff(attempt) {
  const base = Math.min(250 * 2 ** (attempt - 1), 2e3);
  const jittered = base * (0.5 + Math.random() * 0.5);
  await new Promise((resolve) => setTimeout(resolve, jittered));
}

// src/inputs.ts
import { isIP } from "node:net";
var VIEWPORT = {
  width: { min: 100, max: 8e3 },
  height: { min: 100, max: 2e4 }
};
var InputError = class extends Error {
  input;
  constructor(input, message) {
    super(message);
    this.name = "InputError";
    this.input = input;
  }
};
var WHITESPACE_OR_CONTROL = /[\x00-\x20\x7f]/;
var NON_PUBLIC_TLDS = /* @__PURE__ */ new Set(["alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion", "test"]);
function parseApiKey(value) {
  if (value === "") {
    throw new InputError(
      "api-key",
      "Input api-key is empty: store your Site-Shot API key as a repository secret and pass it with api-key: ${{ secrets.SITESHOT_API_KEY }}. A confirmed account's key comes with the free plan, 100 captures a month; get it at https://www.site-shot.com/start/."
    );
  }
  if (WHITESPACE_OR_CONTROL.test(value)) {
    throw new InputError("api-key", "Input api-key must be one API key, without spaces or line breaks.");
  }
  return value;
}
function parsePageUrl(value) {
  const url = WHITESPACE_OR_CONTROL.test(value) ? null : URL.parse(value);
  if (url === null || url.protocol !== "https:") {
    throw new InputError("url", "Input url must be one absolute https:// address, such as https://www.example.com/.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new InputError("url", "Input url must not contain a user name or password.");
  }
  const labels = url.hostname.replace(/\.$/, "").split(".");
  if (isIP(url.hostname) !== 0 || labels.length < 2 || NON_PUBLIC_TLDS.has(labels.at(-1) ?? "")) {
    throw new InputError(
      "url",
      "Input url must name a public host: IP addresses, localhost and local or reserved names are refused."
    );
  }
  return url.href;
}
function parseDimension(name, value) {
  const { min, max } = VIEWPORT[name];
  const pixels = /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
  if (!(pixels >= min && pixels <= max)) {
    throw new InputError(name, `Input ${name} must be a whole number of pixels from ${min} to ${max}.`);
  }
  return pixels;
}
var COUNTRIES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW UK".split(" ")
);
function parseSwitch(name, value) {
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new InputError(name, `Input ${name} must be true or false.`);
}
function parseDelay(value) {
  if (value === "") return void 0;
  const ms = /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!(ms >= 0 && ms <= 6e4)) {
    throw new InputError("delay", "Input delay must be empty or a whole number of milliseconds from 0 to 60000.");
  }
  return ms;
}
function parseOutputPath(value, fallback) {
  if (value === "") return fallback;
  const parts = value.split("/");
  if (parts.length > 16 || !parts.every((part) => /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/.test(part)) || !/\.png$/.test(value)) {
    throw new InputError(
      "path",
      "Input path must be a relative path inside the workspace that ends in .png, such as screenshots/home.png, with no part that starts with a dot."
    );
  }
  return value;
}
function parseCountry(value) {
  if (value === "") return void 0;
  if (!/^[A-Za-z]{2}$/.test(value)) {
    throw new InputError("country", "Input country must be empty or a two-letter country code, such as DE.");
  }
  const code = value.toUpperCase();
  if (!COUNTRIES.has(code)) {
    throw new InputError("country", "Input country must be an ISO 3166-1 alpha-2 country code, such as US or DE.");
  }
  return code;
}

// src/output.ts
import fs from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
var OUTPUT_DIRECTORY = "site-shot-output";
var OUTPUT_FILE = "screenshot.png";
var OUTPUT_PATH = `${OUTPUT_DIRECTORY}/${OUTPUT_FILE}`;
function describeProblem(reason, path) {
  const folder = path.includes("/") ? dirname(path) : "The workspace";
  switch (reason) {
    case "workspace":
      return "GITHUB_WORKSPACE must be the absolute path of an existing directory: run the action as a step of a GitHub Actions job.";
    case "directory":
      return `${folder} and every directory above it in the workspace must be a real directory that the action can read, not a link or a file.`;
    case "exists":
      return `${path} already exists, and the action never replaces a file: move or delete it before this step, or choose another path.`;
    case "changed":
      return "The workspace changed while the screenshot was being saved, so the screenshot was not created.";
    case "diverted":
      return `The workspace changed while the screenshot was being saved: the new file did not end up at ${path}, the place that was checked, so it was left empty, without image data.`;
    case "write":
      return `The screenshot could not be written to ${path}.`;
  }
}
var OutputError = class extends Error {
  reason;
  constructor(reason, path = OUTPUT_PATH) {
    super(describeProblem(reason, path));
    this.name = "OutputError";
    this.reason = reason;
  }
};
function prepareDestination(workspace, path = OUTPUT_PATH) {
  const root = workspace && isAbsolute(workspace) ? realDirectory(workspace) : void 0;
  if (root === void 0) throw new OutputError("workspace", path);
  const parts = path.split("/");
  const destination = { directory: join(root, ...parts.slice(0, -1)), file: join(root, ...parts) };
  let file;
  try {
    let current = root;
    let complete = true;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      const directory = fs.lstatSync(current, { throwIfNoEntry: false });
      if (directory === void 0) {
        complete = false;
        break;
      }
      if (!directory.isDirectory()) throw new OutputError("directory", path);
    }
    file = complete ? fs.lstatSync(destination.file, { throwIfNoEntry: false }) : void 0;
  } catch (error) {
    if (error instanceof OutputError) throw error;
    throw new OutputError("directory", path);
  }
  if (file !== void 0) throw new OutputError("exists", path);
  return destination;
}
function writeScreenshot(destination, png, path = OUTPUT_PATH) {
  const directory = ensureDirectory(destination.directory, path);
  let fd;
  try {
    fd = fs.openSync(destination.file, "wx", 420);
  } catch (error) {
    throw new OutputError(errorCode(error) === "EEXIST" ? "exists" : "write", path);
  }
  let file;
  let problem;
  try {
    file = fs.fstatSync(fd);
    if (!isAt(destination.file, file) || !isAt(destination.directory, directory)) {
      problem = "diverted";
    } else {
      for (let offset = 0; offset < png.length; ) offset += fs.writeSync(fd, png, offset);
    }
  } catch {
    problem = "write";
  } finally {
    fs.closeSync(fd);
  }
  if (problem === "write" && file !== void 0 && isAt(destination.file, file)) fs.unlinkSync(destination.file);
  if (problem !== void 0) throw new OutputError(problem, path);
}
function realDirectory(path) {
  try {
    const real = fs.realpathSync(path);
    return fs.statSync(real).isDirectory() ? real : void 0;
  } catch {
    return void 0;
  }
}
function ensureDirectory(path, output) {
  try {
    fs.mkdirSync(path, { recursive: true });
  } catch {
  }
  let directory;
  let real;
  try {
    directory = fs.lstatSync(path);
    real = fs.realpathSync(path);
  } catch {
    throw new OutputError("directory", output);
  }
  if (!directory.isDirectory()) throw new OutputError("directory", output);
  if (real !== path) throw new OutputError("changed", output);
  return directory;
}
function isAt(path, expected) {
  try {
    const found = fs.lstatSync(path, { throwIfNoEntry: false });
    return found !== void 0 && found.dev === expected.dev && found.ino === expected.ino;
  } catch {
    return false;
  }
}
function errorCode(error) {
  return error instanceof Error ? error.code : void 0;
}

// src/png.ts
import { crc32, inflateSync } from "node:zlib";
var SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
var MAX_CHUNK_LENGTH = 2147483647;
var CHUNK_TYPE = /^[A-Za-z]{4}$/;
var COLOR_TYPES = /* @__PURE__ */ new Map([
  [0, { channels: 1, depths: [1, 2, 4, 8, 16] }],
  // grayscale
  [2, { channels: 3, depths: [8, 16] }],
  // truecolor
  [3, { channels: 1, depths: [1, 2, 4, 8] }],
  // palette
  [4, { channels: 2, depths: [8, 16] }],
  // grayscale and alpha
  [6, { channels: 4, depths: [8, 16] }]
  // truecolor and alpha
]);
var ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2]
];
var SINGLE_PASS = [[0, 0, 1, 1]];
var PROBLEMS = {
  "not-png": "it is not a PNG image",
  truncated: "the PNG is incomplete",
  crc: "a PNG chunk failed its CRC check",
  header: "the PNG header is invalid or larger than the API can return",
  structure: "the PNG chunks are malformed or out of order",
  "image-data": "the PNG image data does not match its header"
};
var PngError = class extends Error {
  problem;
  constructor(problem) {
    super(PROBLEMS[problem]);
    this.name = "PngError";
    this.problem = problem;
  }
};
function checkPng(data, limits) {
  const png = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new PngError("not-png");
  const first = readChunk(png, SIGNATURE.length);
  if (first.type !== "IHDR") throw new PngError("structure");
  const header = readHeader(first.body, limits);
  let palette = false;
  const imageData = [];
  let imageDataEnded = false;
  for (let at = first.next; ; ) {
    const { type, body, next } = readChunk(png, at);
    at = next;
    if (type === "IDAT") {
      if (imageDataEnded || header.colorType === 3 && !palette) throw new PngError("structure");
      imageData.push(body);
      continue;
    }
    imageDataEnded = imageData.length > 0;
    if (type === "IEND") {
      if (body.length !== 0 || imageData.length === 0 || at !== png.length) throw new PngError("structure");
      break;
    }
    if (type === "PLTE") {
      checkPalette(body, header, palette || imageData.length > 0);
      palette = true;
    } else if ((type.charCodeAt(0) & 32) === 0) {
      throw new PngError("structure");
    }
  }
  checkImageData(Buffer.concat(imageData), header);
  return { width: header.width, height: header.height };
}
function readChunk(png, at) {
  if (png.length - at < 12) throw new PngError("truncated");
  const length = png.readUInt32BE(at);
  if (length > MAX_CHUNK_LENGTH) throw new PngError("structure");
  const next = at + 12 + length;
  if (next > png.length) throw new PngError("truncated");
  if (crc32(png.subarray(at + 4, next - 4)) !== png.readUInt32BE(next - 4)) throw new PngError("crc");
  const type = png.toString("latin1", at + 4, at + 8);
  if (!CHUNK_TYPE.test(type)) throw new PngError("structure");
  return { type, body: png.subarray(at + 8, next - 4), next };
}
function readHeader(body, limits) {
  if (body.length !== 13) throw new PngError("header");
  const width = body.readUInt32BE(0);
  const height = body.readUInt32BE(4);
  const bitDepth = body.readUInt8(8);
  const colorType = body.readUInt8(9);
  const color = COLOR_TYPES.get(colorType);
  if (width === 0 || height === 0 || width > limits.maxWidth || height > limits.maxHeight || color === void 0 || !color.depths.includes(bitDepth) || body.readUInt8(10) !== 0 || // compression method
  body.readUInt8(11) !== 0 || // filter method
  body.readUInt8(12) > 1) {
    throw new PngError("header");
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    bitsPerPixel: color.channels * bitDepth,
    interlaced: body.readUInt8(12) === 1
  };
}
function checkPalette(body, header, late) {
  const entries = body.length / 3;
  const maxEntries = header.colorType === 3 ? 2 ** header.bitDepth : 256;
  if (late || header.colorType === 0 || header.colorType === 4 || !Number.isInteger(entries) || entries < 1 || entries > maxEntries) {
    throw new PngError("structure");
  }
}
function checkImageData(stream, header) {
  const rows = (header.interlaced ? ADAM7 : SINGLE_PASS).flatMap(([column, row, columnStep, rowStep]) => {
    const passWidth = Math.ceil((header.width - column) / columnStep);
    const passHeight = Math.ceil((header.height - row) / rowStep);
    return passWidth > 0 && passHeight > 0 ? [[passHeight, 1 + Math.ceil(passWidth * header.bitsPerPixel / 8)]] : [];
  });
  const expected = rows.reduce((sum, [count, length]) => sum + count * length, 0);
  let raw;
  let consumed;
  try {
    const result = inflateSync(stream, { maxOutputLength: expected, info: true });
    raw = result.buffer;
    consumed = result.engine.bytesWritten;
  } catch {
    throw new PngError("image-data");
  }
  if (raw.length !== expected || consumed !== stream.length) throw new PngError("image-data");
  let at = 0;
  for (const [count, length] of rows) {
    for (let index = 0; index < count; index += 1, at += length) {
      if (raw.readUInt8(at) > 4) throw new PngError("image-data");
    }
  }
}

// src/runner.ts
import fs2 from "node:fs";
import { EOL } from "node:os";
var RunnerError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerError";
  }
};
function getInput(env, name) {
  return (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}
function command(name, data) {
  return `::${name}::${data.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;
}
function outputFile(env) {
  const file = env.GITHUB_OUTPUT;
  if (!file) throw new RunnerError("GITHUB_OUTPUT is not set: run the action as a step of a GitHub Actions job.");
  return file;
}
function setOutput(file, name, value) {
  fs2.appendFileSync(file, `${name}=${value}${EOL}`);
}

// src/action.ts
var START = "https://www.site-shot.com/start/";
var PRICING = "https://www.site-shot.com/pricing/";
var CAPTURE_ERRORS = [
  [
    CountryUnavailableError,
    "CountryUnavailableError",
    "Site-Shot has no capture capacity in the requested country, and a strict country capture does not fall back to another country"
  ],
  [AuthError, "AuthError", `Site-Shot rejected the API key; get or check your key at ${START}`],
  [
    QuotaError,
    "QuotaError",
    `Site-Shot refused the capture because of the plan behind the key: quota used up, payment due or no active subscription; check the key's plan at ${START}`
  ],
  [InvalidParamsError, "InvalidParamsError", "Site-Shot rejected the capture parameters"],
  [SiteShotTimeoutError, "SiteShotTimeoutError", "The capture timed out"],
  [
    APIError,
    "APIError",
    "The Site-Shot API request failed: a server error, an answer without a usable image, or a failed connection"
  ]
];
async function run(env, print2) {
  const apiKey = getInput(env, "api-key");
  if (apiKey !== "") print2(command("add-mask", apiKey));
  let capture;
  try {
    capture = prepare(env, apiKey);
  } catch (error) {
    print2(command("error", `${describe(error)} Nothing was sent to Site-Shot.`));
    return 1;
  }
  const { options } = capture;
  const settings = [
    options.full_size === 1 ? "full page" : "",
    options.country === void 0 ? "" : `country ${String(options.country)} (strict)`,
    options.no_cookie_popup === 1 ? "cookie banners removed" : "",
    options.no_ads === 1 ? "ads removed" : "",
    options.delay_time === void 0 ? "" : `delay ${String(options.delay_time)} ms`
  ].flatMap((setting) => setting === "" ? [] : [`, ${setting}`]);
  print2(
    `Capturing one page with Site-Shot at ${options.width}x${options.height}${settings.join("")}: one capture attempt, retries disabled.`
  );
  let png;
  try {
    png = await new SiteShot(capture.apiKey, { retries: 0 }).capture(options);
  } catch (error) {
    print2(command("error", `${describeCaptureError(error, options)} Nothing was saved, and the action does not retry.`));
    return 1;
  }
  let size;
  try {
    size = checkPng(png, { maxWidth: VIEWPORT.width.max, maxHeight: VIEWPORT.height.max });
    writeScreenshot(capture.destination, png, capture.path);
  } catch (error) {
    const message = error instanceof PngError ? `Site-Shot answered with an image that failed PNG validation: ${error.message}. Nothing was saved.` : `${describe(error)} The capture was made and may count toward the plan, but it was not saved.`;
    print2(command("error", message));
    return 1;
  }
  try {
    setOutput(capture.outputs, "path", capture.path);
  } catch {
    print2(command("error", `The screenshot was saved to ${capture.path}, but the path output could not be added to GITHUB_OUTPUT.`));
    return 1;
  }
  print2(`Saved a ${size.width}x${size.height} PNG (${png.length} bytes) to ${capture.path}.`);
  return 0;
}
function prepare(env, apiKey) {
  const options = {
    url: parsePageUrl(getInput(env, "url")),
    width: parseDimension("width", getInput(env, "width")),
    height: parseDimension("height", getInput(env, "height")),
    format: "png"
  };
  if (parseSwitch("full-page", getInput(env, "full-page"))) options.full_size = 1;
  const country = parseCountry(getInput(env, "country"));
  if (country !== void 0) {
    options.country = country;
    options.strict_country = 1;
  }
  if (parseSwitch("no-cookie-popup", getInput(env, "no-cookie-popup"))) options.no_cookie_popup = 1;
  if (parseSwitch("no-ads", getInput(env, "no-ads"))) options.no_ads = 1;
  const delay = parseDelay(getInput(env, "delay"));
  if (delay !== void 0) options.delay_time = delay;
  const path = parseOutputPath(getInput(env, "path"), OUTPUT_PATH);
  return {
    apiKey: parseApiKey(apiKey),
    options,
    path,
    outputs: outputFile(env),
    destination: prepareDestination(env.GITHUB_WORKSPACE, path)
  };
}
function describe(error) {
  if (error instanceof InputError || error instanceof OutputError || error instanceof RunnerError) {
    return error.message;
  }
  return "The action failed with an unexpected error.";
}
function describeCaptureError(error, options) {
  try {
    for (const [type, name, meaning] of CAPTURE_ERRORS) {
      if (error instanceof type) {
        const status = error.httpStatus;
        const http = typeof status === "number" && Number.isInteger(status) && status >= 300 && status <= 599 ? `, HTTP ${status}` : "";
        const code = errorCode2(error.body);
        return `${explain(error, options, code) ?? meaning} (${name}${http}${code === void 0 ? "" : `, error_code ${code}`}).`;
      }
    }
  } catch {
  }
  return "The capture failed with an unexpected error.";
}
function explain(error, options, code) {
  const text = answerText(error.body);
  if (code === "proxy_navigation_failed") {
    return "Site-Shot could not open the page: check that its host name resolves and that the site is reachable from the internet";
  }
  if (error instanceof QuotaError) {
    if (/geotargeting needs a paid plan/i.test(text)) {
      return `Site-Shot refused country ${String(options.country)}: the free plan captures from the default location or the US only, and a country other than US needs a paid plan (${PRICING}); the refused attempt counts toward the month's captures`;
    }
    if (/free plan used up|free api trial used up/i.test(text)) {
      const renews = /renews on (\d{4}-\d{2}-\d{2})/i.exec(text)?.[1];
      return `The free plan's captures for this month are used up${renews === void 0 ? "" : `; it renews on ${renews} (UTC)`}. Paid plans start at $5 a month for 2,000 captures (${PRICING}), and the key stays the same`;
    }
    if (error.httpStatus === 429) {
      return "Site-Shot refused the capture: too many captures at once on this key (the free plan allows one at a time)";
    }
  }
  if (error instanceof SiteShotTimeoutError && error.body === void 0) {
    return "Site-Shot did not answer within the action's time limit; it may still finish the capture, and the attempt may count toward the plan";
  }
  if (error instanceof SiteShotTimeoutError) {
    return "The page did not finish rendering in time; the attempt counts toward the plan";
  }
  return void 0;
}
function answerText(body) {
  if (typeof body === "string") return body;
  if (typeof body === "object" && body !== null) {
    const { error, message } = body;
    if (typeof error === "string") return error;
    if (typeof message === "string") return message;
  }
  return "";
}
function errorCode2(body) {
  if (typeof body !== "object" || body === null) return void 0;
  const code = body.error_code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : void 0;
}

// src/index.ts
function print(line) {
  fs3.writeSync(process.stdout.fd, `${line}${EOL2}`);
}
process.on("uncaughtException", () => {
  print(command("error", "The action failed with an unexpected internal error."));
  process.exit(1);
});
process.exitCode = await run(process.env, print);
