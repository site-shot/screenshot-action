// Preloaded with `node --import` into every test process, and into every child
// process the tests start: connections that would leave this machine are
// refused, and so are DNS queries and UDP datagrams. Site-Shot is always
// replaced by a fetch stub in the tests, so a stub that is missed fails here
// instead of reaching api.site-shot.com.
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";

/** What was refused, in order; test files check that it stays empty. */
export const refusals: string[] = [];

const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

function refused(what: string): Error {
  refusals.push(what);
  return Object.assign(new Error(`Network access is disabled in tests: ${what}`), {
    code: "ERR_TEST_NETWORK_DISABLED",
  });
}

function isLoopback(host: unknown): boolean {
  const family = net.isIP(String(host));
  return family !== 0 && LOOPBACK.check(String(host), family === 6 ? "ipv6" : "ipv4");
}

// TCP, and TLS and fetch on top of it: only local IPC paths and loopback
// addresses. Host names are refused too, because connecting to one starts with
// a DNS query.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  // net.connect() passes its normalized arguments as one array.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  let target: { path?: unknown; host?: unknown; port?: unknown };
  if (first !== null && typeof first === "object") {
    target = first;
  } else if (typeof first === "string" && !(Number(first) >= 0)) {
    target = { path: first };
  } else {
    target = { port: first, host: typeof args[1] === "string" ? args[1] : undefined };
  }
  if (typeof target.path === "string" || isLoopback(target.host)) {
    return Reflect.apply(connect, this, args);
  }
  const error = refused(`TCP connection to ${String(target.host)}:${String(target.port)}`);
  process.nextTick(() => this.destroy(error));
  return this;
} as typeof connect;

// DNS, in its callback, promise and Resolver forms.
const QUERIES = /^(lookup|lookupService|resolve\w*|reverse)$/;

function refuseQueries(target: object, promises: boolean): void {
  const methods = target as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(target)) {
    const original = methods[name];
    if (!QUERIES.test(name) || typeof original !== "function") continue;
    methods[name] = function (this: unknown, query: unknown, ...rest: unknown[]) {
      // Looking up an IP address gives it back as it is, without a query.
      if (name === "lookup" && net.isIP(String(query)) !== 0) {
        return Reflect.apply(original, this, [query, ...rest]);
      }
      const error = refused(`DNS ${name} ${String(query)}`);
      if (promises) return Promise.reject(error);
      const callback = rest.at(-1);
      if (typeof callback !== "function") throw error;
      process.nextTick(callback, error);
      return undefined;
    };
  }
}

refuseQueries(dns, false);
refuseQueries(dns.Resolver.prototype, false);
refuseQueries(dns.promises, true);
refuseQueries(dns.promises.Resolver.prototype, true);

// UDP: nothing in these tests uses it.
for (const name of ["connect", "send"] as const) {
  dgram.Socket.prototype[name] = function () {
    throw refused(`UDP ${name}`);
  };
}

// Named ESM imports of node:dns and node:dgram see the replacements too.
syncBuiltinESMExports();
