// The network guard is preloaded into every test process, refuses whatever
// would leave this machine and still lets loopback through. The refused
// targets are reserved ones (TEST-NET-1, .invalid), so even a broken guard
// would reach nobody.
import assert from "node:assert/strict";
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { refusals } from "./support/no-network.ts";

const DISABLED = { code: "ERR_TEST_NETWORK_DISABLED" };

function connectionError(socket: net.Socket): Promise<NodeJS.ErrnoException> {
  return new Promise((resolve) => socket.once("error", resolve));
}

test("the guard is preloaded into this test process", () => {
  const guard = fileURLToPath(new URL("./support/no-network.ts", import.meta.url));
  const preloaded = process.execArgv.flatMap((arg, index, all) =>
    arg === "--import" ? [all[index + 1]] : arg.startsWith("--import=") ? [arg.slice(9)] : [],
  );
  assert.ok(
    preloaded.some((file) => file !== undefined && fileURLToPath(new URL(file, `file://${process.cwd()}/`)) === guard),
    `execArgv: ${process.execArgv.join(" ")}`,
  );
});

test("TCP, TLS and fetch connections that would leave this machine are refused", async () => {
  assert.equal((await connectionError(net.connect({ host: "192.0.2.1", port: 443 }))).code, DISABLED.code);
  assert.equal((await connectionError(net.connect(80, "site-shot-guard.invalid"))).code, DISABLED.code);
  // fetch is what the SDK uses; a host name is refused before any DNS query.
  for (const url of ["https://192.0.2.1/", "https://site-shot-guard.invalid/"]) {
    await assert.rejects(fetch(url), (error: Error) => {
      assert.equal((error.cause as NodeJS.ErrnoException | undefined)?.code, DISABLED.code);
      return true;
    });
  }
  assert.ok(refusals.includes("TCP connection to 192.0.2.1:443"));
  assert.ok(refusals.includes("TCP connection to site-shot-guard.invalid:80"));
  assert.ok(refusals.includes("TCP connection to site-shot-guard.invalid:443"));
});

test("DNS queries are refused in their callback, promise and Resolver forms", async () => {
  const callbackError = (query: (done: (error: NodeJS.ErrnoException | null) => void) => void) =>
    new Promise<NodeJS.ErrnoException | null>((resolve) => query(resolve));
  assert.equal((await callbackError((done) => dns.lookup("site-shot-guard.invalid", done)))?.code, DISABLED.code);
  assert.equal((await callbackError((done) => dns.resolve4("site-shot-guard.invalid", done)))?.code, DISABLED.code);
  assert.equal((await callbackError((done) => new dns.Resolver().resolveTxt("site-shot-guard.invalid", done)))?.code, DISABLED.code);
  await assert.rejects(dns.promises.lookup("site-shot-guard.invalid"), DISABLED);
  await assert.rejects(new dns.promises.Resolver().resolve6("site-shot-guard.invalid"), DISABLED);
  // An IP address is given back as it is, without a query.
  assert.deepEqual(await dns.promises.lookup("127.0.0.1"), { address: "127.0.0.1", family: 4 });
});

test("UDP datagrams are refused", () => {
  const socket = dgram.createSocket("udp4");
  try {
    assert.throws(() => socket.send(Buffer.from("x"), 53, "192.0.2.1"), DISABLED);
  } finally {
    socket.close();
  }
});

test("loopback connections still work", async () => {
  const server = net.createServer((socket) => socket.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as net.AddressInfo;
    const reply = await new Promise<string>((resolve, reject) => {
      let data = "";
      net
        .connect(port, "127.0.0.1")
        .on("data", (chunk) => (data += chunk))
        .on("end", () => resolve(data))
        .on("error", reject);
    });
    assert.equal(reply, "ok");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
