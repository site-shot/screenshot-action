// Preloaded with `node --import` into the bundle's process by test/dist.test.ts.
// It replaces the global fetch, which the bundled site-shot-sdk uses, with a
// stub that appends each request to the file STUB_CALLS and answers with
// STUB_STATUS and the contents of STUB_BODY. With STUB_CRASH it instead fails
// the way a stray error would, outside any try/catch, with STUB_MESSAGE.
import fs from "node:fs";

const env = process.env;

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  fs.appendFileSync(env.STUB_CALLS ?? "", `${JSON.stringify({ url: String(input), headers: init?.headers })}\n`);
  if (env.STUB_CRASH === "exception") {
    setImmediate(() => {
      throw new Error(env.STUB_MESSAGE);
    });
    return new Promise<Response>(() => {});
  }
  if (env.STUB_CRASH === "rejection") {
    void Promise.reject(new Error(env.STUB_MESSAGE));
    return new Promise<Response>(() => {});
  }
  return new Response(fs.readFileSync(env.STUB_BODY ?? ""), {
    status: Number(env.STUB_STATUS ?? 200),
    headers: { "content-type": "application/json" },
  });
};
