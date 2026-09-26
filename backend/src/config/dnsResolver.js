import dns from "node:dns";

/**
 * Node keeps two independent DNS paths:
 *   - `dns.lookup()`   -> the operating system resolver (getaddrinfo)
 *   - `dns.resolve*()` -> Node's own c-ares resolver
 *
 * `mongodb+srv://` connection strings are resolved through the c-ares path
 * (SRV + TXT lookups). On some Windows/VPN/hotspot networks c-ares fails to
 * read the machine's nameservers and silently falls back to `127.0.0.1`, where
 * nothing answers on port 53. Every SRV/TXT lookup then fails with
 * `querySrv ECONNREFUSED`, so the backend cannot reach Atlas even though
 * `nslookup` and the OS resolver work perfectly.
 *
 * `DNS_SERVERS` (comma separated, e.g. `10.31.184.49` or `10.31.184.49,1.1.1.1`)
 * pins c-ares to nameservers that actually answer, without changing the
 * operating system's DNS configuration. It is optional: when unset, Node's
 * default resolver configuration is left untouched, so CI and normal
 * production hosts are unaffected.
 */

/** Parse a comma separated nameserver list, dropping blank entries. */
export function parseDnsServerList(raw = process.env.DNS_SERVERS || "") {
  return String(raw)
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
}

/**
 * Pin c-ares (NOT the OS resolver) to the servers listed in `DNS_SERVERS`.
 * Returns true when an override was applied. Never throws: an unusable value
 * is reported and startup continues with Node's default configuration.
 */
export function applyDnsServerOverride() {
  const configured = parseDnsServerList();
  if (configured.length === 0) return false;

  try {
    dns.setServers(configured);
    console.log(`[DNS] c-ares resolver pinned via DNS_SERVERS -> ${dns.getServers().join(", ")}`);
    return true;
  } catch (err) {
    console.error(`[DNS] Ignoring invalid DNS_SERVERS value "${process.env.DNS_SERVERS}": ${err.message}`);
    return false;
  }
}

/** Normalize a `dns.getServers()` entry (`127.0.0.1:53`, `[::1]:1053`, `::1`). */
function bareHost(server) {
  const value = String(server);
  const bracketed = value.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const withPort = value.match(/^([0-9.]+)(?::\d+)?$/);
  if (withPort) return withPort[1];
  return value;
}

function isLoopbackAddress(server) {
  const host = bareHost(server);
  return host.startsWith("127.") || /^(::1|0:0:0:0:0:0:0:1|::ffff:127\.)/i.test(host);
}

/**
 * True when c-ares has no usable nameserver left (empty list, or loopback
 * only) — the state that produces `querySrv ECONNREFUSED`.
 * Accepts an explicit list so callers (and tests) can evaluate any state.
 */
export function isLoopbackOnlyResolver(servers = dns.getServers()) {
  if (!Array.isArray(servers) || servers.length === 0) return true;
  return servers.every(isLoopbackAddress);
}

/**
 * Actionable next step after an SRV/TXT lookup failure, or `null` when the
 * local resolver looks healthy (the failure then has a different cause).
 */
export function srvDnsFailureHint(servers = dns.getServers()) {
  if (parseDnsServerList().length > 0) {
    return [
      "[DNS] DNS_SERVERS is set but SRV/TXT lookups still fail — the pinned server(s)",
      `      (${process.env.DNS_SERVERS}) may be unreachable from this network. Verify with`,
      "      `nslookup -type=SRV _mongodb._tcp.<cluster>.mongodb.net`, then update or remove",
      "      DNS_SERVERS (a DHCP-assigned DNS server changes between networks).",
    ].join("\n");
  }

  if (isLoopbackOnlyResolver(servers)) {
    return [
      "[DNS] Node's internal resolver (c-ares) has no working nameserver (loopback only),",
      "      so `mongodb+srv://` SRV/TXT lookups fail even though the OS can resolve names.",
      "      Fix: add the machine's DNS server to backend/.env, e.g. DNS_SERVERS=10.31.184.49",
      "      (find it with `ipconfig /all`), or replace DATABASE_URL with the standard",
      "      multi-host connection string: mongodb://user:pass@host1,host2,host3/db?ssl=true&replicaSet=...",
    ].join("\n");
  }

  return null;
}

