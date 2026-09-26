/**
 * Unit tests for the c-ares DNS override helper — no database or Redis needed.
 *
 * Background: on some Windows/VPN/hotspot networks Node's internal resolver
 * (c-ares) falls back to 127.0.0.1, so `mongodb+srv://` SRV/TXT lookups fail
 * with `querySrv ECONNREFUSED` even though the OS resolver works fine.
 */
import { expect } from "chai";
import dns from "node:dns";
import {
  applyDnsServerOverride,
  isLoopbackOnlyResolver,
  parseDnsServerList,
  srvDnsFailureHint,
} from "../config/dnsResolver.js";

describe("dnsResolver", () => {
  const originalServers = dns.getServers();
  let originalEnvValue;

  beforeEach(() => {
    originalEnvValue = process.env.DNS_SERVERS;
    delete process.env.DNS_SERVERS;
  });

  afterEach(() => {
    if (originalEnvValue === undefined) delete process.env.DNS_SERVERS;
    else process.env.DNS_SERVERS = originalEnvValue;
    // Only c-ares state is touched by these tests, and only when it was
    // non-empty to begin with (dns.setServers([]) is rejected by Node).
    if (originalServers.length > 0) dns.setServers(originalServers);
  });

  describe("parseDnsServerList", () => {
    it("returns an empty list when DNS_SERVERS is not set", () => {
      expect(parseDnsServerList()).to.deep.equal([]);
    });

    it("trims whitespace and drops empty entries", () => {
      expect(parseDnsServerList(" 10.31.184.49 , 1.1.1.1 ,, ")).to.deep.equal([
        "10.31.184.49",
        "1.1.1.1",
      ]);
    });

    it("keeps the optional IP:port form intact", () => {
      expect(parseDnsServerList("10.0.0.1:5353")).to.deep.equal(["10.0.0.1:5353"]);
    });

    it("accepts an explicit value instead of the env var", () => {
      process.env.DNS_SERVERS = "should-be-ignored";
      expect(parseDnsServerList("8.8.8.8")).to.deep.equal(["8.8.8.8"]);
    });
  });

  describe("applyDnsServerOverride", () => {
    it("leaves the resolver untouched when DNS_SERVERS is unset", () => {
      const before = dns.getServers();
      expect(applyDnsServerOverride()).to.equal(false);
      expect(dns.getServers()).to.deep.equal(before);
    });

    it("pins c-ares when DNS_SERVERS holds usable nameservers", () => {
      process.env.DNS_SERVERS = "127.0.0.1, 8.8.8.8";
      expect(applyDnsServerOverride()).to.equal(true);
      expect(dns.getServers()).to.deep.equal(["127.0.0.1", "8.8.8.8"]);
    });

    it("ignores an invalid value instead of throwing", () => {
      const before = dns.getServers();
      process.env.DNS_SERVERS = "not-an-ip";
      expect(applyDnsServerOverride()).to.equal(false);
      expect(dns.getServers()).to.deep.equal(before);
    });
  });

  describe("isLoopbackOnlyResolver", () => {
    it("treats an empty server list as unusable", () => {
      expect(isLoopbackOnlyResolver([])).to.equal(true);
    });

    it("detects IPv4/IPv6 loopback, with or without a custom port", () => {
      expect(isLoopbackOnlyResolver(["127.0.0.1"])).to.equal(true);
      expect(isLoopbackOnlyResolver(["127.0.0.1:5353"])).to.equal(true);
      expect(isLoopbackOnlyResolver(["::1"])).to.equal(true);
      expect(isLoopbackOnlyResolver(["[::1]:5353"])).to.equal(true);
      expect(isLoopbackOnlyResolver(["::ffff:127.0.0.1"])).to.equal(true);
    });

    it("accepts real nameservers and mixed lists", () => {
      expect(isLoopbackOnlyResolver(["10.31.184.49"])).to.equal(false);
      expect(isLoopbackOnlyResolver(["10.31.184.49", "127.0.0.1"])).to.equal(false);
      expect(isLoopbackOnlyResolver(["2001:4860:4860::8888"])).to.equal(false);
    });
  });

  describe("srvDnsFailureHint", () => {
    it("recommends DNS_SERVERS when the resolver is loopback-only and nothing is pinned", () => {
      const hint = srvDnsFailureHint(["127.0.0.1"]);
      expect(hint).to.be.a("string");
      expect(hint).to.include("DNS_SERVERS");
    });

    it("flags an unusable pinned server when DNS_SERVERS is already set", () => {
      process.env.DNS_SERVERS = "10.31.184.49";
      const hint = srvDnsFailureHint(["127.0.0.1"]);
      expect(hint).to.be.a("string");
      expect(hint).to.include("DNS_SERVERS");
    });

    it("stays silent when the resolver looks healthy", () => {
      expect(srvDnsFailureHint(["10.31.184.49"])).to.equal(null);
    });
  });
});
