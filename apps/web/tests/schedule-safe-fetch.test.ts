import assert from "node:assert";
import { describe, it } from "node:test";
import { Agent, fetch, Response } from "undici";
import {
  assertPublicHost,
  createPinnedLookup,
  isPrivateIp,
  safeFetch,
  setSafeFetchImplementationForTests,
  type SafeFetchImplementation,
} from "../src/lib/schedule-security/safe-fetch.ts";
import { ScheduleSecurityError } from "../src/lib/schedule-security/errors.ts";

describe("Schedule safe fetch SSRF protection", () => {
  describe("literal IP validation", () => {
    for (const hostname of ["[::1]", "[::ffff:127.0.0.1]", "[64:ff9b::a9fe:a9fe]"]) {
      it(`rejects ${hostname} as a private IP`, () => {
        assert.throws(
          () => assertPublicHost(hostname),
          (error: unknown) => error instanceof ScheduleSecurityError && error.code === "private_ip"
        );
      });
    }
  });

  describe("embedded IPv4 classification", () => {
    it("rejects dotted-quad IPv4-mapped private addresses", () => {
      assert.strictEqual(isPrivateIp("::ffff:169.254.169.254"), true);
    });

    it("rejects hexadecimal IPv4-mapped private addresses", () => {
      assert.strictEqual(isPrivateIp("::ffff:a9fe:a9fe"), true);
    });

    it("rejects NAT64 addresses embedding private IPv4 addresses", () => {
      assert.strictEqual(isPrivateIp("64:ff9b::a9fe:a9fe"), true);
    });

    it("allows NAT64 addresses embedding public IPv4 addresses", () => {
      assert.strictEqual(isPrivateIp("64:ff9b::808:808"), false);
    });
  });

  describe("IPv4 special ranges", () => {
    for (const address of [
      "192.0.0.1",
      "192.0.0.8",
      "192.0.0.11",
      "192.0.2.1",
      "192.88.99.1",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      it(`rejects ${address}`, () => {
        assert.strictEqual(isPrivateIp(address), true);
      });
    }

    for (const address of ["1.1.1.1", "8.8.8.8", "192.0.0.9", "192.0.0.10"]) {
      it(`allows public address ${address}`, () => {
        assert.strictEqual(isPrivateIp(address), false);
      });
    }
  });

  describe("pinned DNS lookup", () => {
    it("rejects a private address returned by the connection resolver", async () => {
      const pinnedLookup = createPinnedLookup(async () => [
        { address: "169.254.169.254", family: 4 },
      ]);

      const error = await new Promise<Error | null>((resolve) => {
        pinnedLookup("attacker.example", { all: true }, (lookupError) => {
          resolve(lookupError);
        });
      });

      assert.ok(error instanceof ScheduleSecurityError);
      assert.strictEqual(error.code, "private_ip");
    });

    it("preserves the private-IP error in undici's rejection chain", async () => {
      const pinnedLookup = createPinnedLookup(async () => [
        { address: "169.254.169.254", family: 4 },
      ]);
      const agent = new Agent({ connect: { lookup: pinnedLookup } });

      try {
        await assert.rejects(
          fetch("http://attacker.example", { dispatcher: agent }),
          (error: unknown) =>
            error instanceof TypeError &&
            error.cause instanceof ScheduleSecurityError &&
            error.cause.code === "private_ip"
        );
      } finally {
        await agent.close();
      }
    });
  });

  describe("IPv6 special ranges", () => {
    for (const address of [
      "::",
      "::1",
      "64:ff9b:1::1",
      "100::1",
      "100:0:0:1::1",
      "fc00::1",
      "fdff::1",
      "fe80::1",
      "febf::1",
      "fec0::1",
      "feff::1",
      "ff00::1",
      "2001::1",
      "2001:1::4",
      "2001:2::1",
      "2001:4:111::1",
      "2001:4:113::1",
      "2001:10::1",
      "2001:100::1",
      "2001:db8::1",
      "2002::1",
      "3ffe::1",
      "3fff:fff::1",
      "5f00::1",
    ]) {
      it(`rejects ${address}`, () => {
        assert.strictEqual(isPrivateIp(address), true);
      });
    }

    for (const address of [
      "2001:1::1",
      "2001:1::2",
      "2001:1::3",
      "2001:3::1",
      "2001:4:112::1",
      "2001:20::1",
      "2001:2f::1",
      "2001:30::1",
      "2001:3f::1",
      "2003::1",
      "3fff:1000::1",
      "2606:4700:4700::1111",
    ]) {
      it(`allows public address ${address}`, () => {
        assert.strictEqual(isPrivateIp(address), false);
      });
    }
  });

  describe("response size limits", () => {
    it("cancels an oversized streaming response and rejects without hanging", async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
        },
        cancel() {
          cancelled = true;
          throw new Error("test cancellation failure");
        },
      });
      const response = new Response(body, { status: 200 });
      const mockFetch = (async () => response) as SafeFetchImplementation;
      setSafeFetchImplementationForTests(mockFetch);

      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          safeFetch("https://example.com", { timeoutMs: 1_000, maxBytes: 1 }).catch(
            (error: unknown) => error
          ),
          new Promise<"timed_out">((resolve) => {
            timeout = setTimeout(() => resolve("timed_out"), 250);
            timeout.unref();
          }),
        ]);

        assert.notStrictEqual(result, "timed_out", "safeFetch did not settle after size rejection");
        assert.ok(result instanceof ScheduleSecurityError);
        assert.strictEqual(result.code, "response_too_large");
        assert.strictEqual(cancelled, true, "oversized response body was not cancelled");
      } finally {
        if (timeout) clearTimeout(timeout);
        setSafeFetchImplementationForTests(null);
      }
    });
  });
});
