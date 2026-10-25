import assert from "node:assert/strict";
import test from "node:test";

import { parseApiKey, parseCountry, parseDimension, parsePageUrl } from "../src/inputs.ts";

function refused(input: string) {
  return { name: "InputError", input };
}

test("a public https:// page URL is accepted in its normalized form", () => {
  const cases: [string, string][] = [
    ["https://www.example.com/", "https://www.example.com/"],
    ["HTTPS://Example.COM", "https://example.com/"],
    ["https://example.com/path/?q=1&b=two#part", "https://example.com/path/?q=1&b=two#part"],
    ["https://example.com:8443/status", "https://example.com:8443/status"],
    ["https://example.com:443/", "https://example.com/"],
    ["https://пример.рф/", "https://xn--e1afmkfd.xn--p1ai/"],
    ["https://shop.example.co.uk./", "https://shop.example.co.uk./"],
  ];
  for (const [value, href] of cases) {
    assert.equal(parsePageUrl(value), href, value);
  }
});

test("a URL that is not an absolute https:// address is refused", () => {
  for (const value of [
    "",
    "example.com",
    "www.example.com/page",
    "//example.com/",
    "http://example.com/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "data:text/html,hello",
    "javascript:alert(1)",
    "https://",
    "https://exa mple.com/",
    "https://example.com/a b",
    "https://example.com/\nhttps://other.example.com/",
    "https://example.com/\tpath",
  ]) {
    assert.throws(() => parsePageUrl(value), refused("url"), JSON.stringify(value));
  }
});

test("a URL with a user name or password is refused", () => {
  for (const value of ["https://user:secret@example.com/", "https://user@example.com/", "https://:secret@example.com/"]) {
    assert.throws(() => parsePageUrl(value), refused("url"), value);
  }
});

test("a URL whose host is an IP address, local or reserved is refused", () => {
  for (const value of [
    "https://localhost/",
    "https://localhost:3000/",
    "https://LOCALHOST./",
    "https://app.localhost/",
    "https://intranet/",
    "https:///intranet",
    "https://127.0.0.1/",
    "https://0x7f.1/",
    "https://2130706433/",
    "https://10.0.0.8/",
    "https://192.168.1.10/",
    "https://169.254.169.254/latest/meta-data/",
    "https://8.8.8.8/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[2606:4700::1111]/",
    "https://printer.local/",
    "https://db.internal/",
    "https://site.test/",
    "https://www.example/",
    "https://foo.invalid/",
    "https://hidden.onion/",
    "https://name.alt/",
    "https://router.home.arpa/",
    "https://1.0.0.127.in-addr.arpa/",
  ]) {
    assert.throws(() => parsePageUrl(value), refused("url"), value);
  }
});

test("a refused URL is not repeated in the error", () => {
  for (const value of [
    "http://example.com/?token=url-marker-1",
    "https://user:url-marker-2@example.com/",
    "https://127.0.0.1/?q=url-marker-3",
    "https://example.com/url-marker-4 x",
  ]) {
    assert.throws(
      () => parsePageUrl(value),
      (error: Error) => !error.message.includes("url-marker") && error.name === "InputError",
      value,
    );
  }
});

test("width and height are whole numbers within the API's viewport limits", () => {
  assert.equal(parseDimension("width", "100"), 100);
  assert.equal(parseDimension("width", "1024"), 1024);
  assert.equal(parseDimension("width", "8000"), 8000);
  assert.equal(parseDimension("height", "100"), 100);
  assert.equal(parseDimension("height", "768"), 768);
  assert.equal(parseDimension("height", "20000"), 20000);
});

test("a width or height outside the limits or not a plain whole number is refused", () => {
  const notNumbers = ["", "0", "-1", "+1024", "1e3", "1024.0", "1024.5", "0x400", "01024", "1 024", "１０２４", "NaN", "Infinity"];
  for (const value of [...notNumbers, "99", "8001", "20000"]) {
    assert.throws(() => parseDimension("width", value), refused("width"), `width ${JSON.stringify(value)}`);
  }
  for (const value of [...notNumbers, "99", "20001"]) {
    assert.throws(() => parseDimension("height", value), refused("height"), `height ${JSON.stringify(value)}`);
  }
});

test("a country is two ASCII letters, upper-cased and otherwise sent as given", () => {
  assert.equal(parseCountry(""), undefined);
  assert.equal(parseCountry("DE"), "DE");
  assert.equal(parseCountry("de"), "DE");
  assert.equal(parseCountry("gB"), "GB");
  // Not an assigned ISO code, but the action does not map or substitute codes.
  assert.equal(parseCountry("UK"), "UK");
});

test("a country that is not two ASCII letters is refused", () => {
  for (const value of ["D", "DEU", "D1", "1D", "D-", "Germany", "ÄÖ", "D E"]) {
    assert.throws(() => parseCountry(value), refused("country"), value);
  }
});

test("an API key is one token without spaces or control characters", () => {
  assert.equal(parseApiKey("abcDEF123"), "abcDEF123");
  assert.equal(parseApiKey("a-b_c.d~e+f/g="), "a-b_c.d~e+f/g=");
  for (const value of ["", "two words", "line\nbreak", "tab\tkey", "nul\u0000key", "del\u007fkey"]) {
    assert.throws(() => parseApiKey(value), refused("api-key"), JSON.stringify(value));
  }
});

test("a refused API key is not repeated in the error", () => {
  assert.throws(
    () => parseApiKey("key-marker with space"),
    (error: Error) => !error.message.includes("key-marker") && error.name === "InputError",
  );
});
