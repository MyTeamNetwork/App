import { lookup } from "node:dns/promises";
import { isIP, isIPv6, type LookupFunction } from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";
import { fetch as undiciFetch, Agent } from "undici";
import { normalizeHost } from "./allowlist";
import { ScheduleSecurityError } from "./errors";

const MAX_REDIRECTS = 2;
export type SafeFetchImplementation = typeof undiciFetch;
type UndiciResponse = Awaited<ReturnType<SafeFetchImplementation>>;

let fetchImplementation: SafeFetchImplementation = undiciFetch;

export function setSafeFetchImplementationForTests(
  implementation: SafeFetchImplementation | null
) {
  fetchImplementation = implementation ?? undiciFetch;
}

export type SafeFetchResult = {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  text: string;
};

export type SafeFetchConfig = {
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
  onBeforeRequest?: (url: string, host: string) => Promise<void>;
};

export async function safeFetch(
  url: string,
  config: SafeFetchConfig,
  redirectCount = 0
): Promise<SafeFetchResult> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new ScheduleSecurityError("too_many_redirects", "Too many redirects.");
  }

  const parsed = new URL(url);
  assertAllowedScheme(parsed);
  assertAllowedPort(parsed);

  const host = normalizeHost(parsed.hostname);
  assertPublicHost(host);

  if (config.onBeforeRequest) {
    await config.onBeforeRequest(url, host);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const agent = new Agent({ connect: { lookup: pinnedLookup } });
  let requestFailed = false;

  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "TeamMeet-ScheduleSync/1.0",
        Accept: "text/html,application/json,text/calendar,text/plain",
        ...config.headers,
      },
      signal: controller.signal,
      dispatcher: agent,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        const headers = collectHeaders(response);
        return { finalUrl: url, status: response.status, headers, text: "" };
      }

      const redirected = new URL(location, url).toString();
      return safeFetch(redirected, config, redirectCount + 1);
    }

    const headers = collectHeaders(response);
    const text = await readResponseText(response, config.maxBytes);

    return { finalUrl: url, status: response.status, headers, text };
  } catch (error) {
    requestFailed = true;
    const securityError = findScheduleSecurityError(error);
    if (securityError) {
      throw securityError;
    }

    const message = error instanceof Error ? error.message : "Fetch failed.";
    throw new ScheduleSecurityError("fetch_failed", message);
  } finally {
    try {
      if (requestFailed) {
        controller.abort();
        await agent.destroy().catch(() => undefined);
      } else {
        await agent.close();
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function collectHeaders(response: UndiciResponse) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

function assertAllowedScheme(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScheduleSecurityError("invalid_url", "URL must start with http(s) or webcal.");
  }
}

function assertAllowedPort(url: URL) {
  if (!url.port) return;
  if (url.port !== "80" && url.port !== "443") {
    throw new ScheduleSecurityError("invalid_port", "Only ports 80 and 443 are allowed.");
  }
}

export function assertPublicHost(hostname: string) {
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new ScheduleSecurityError("localhost", "Localhost URLs are not allowed.");
  }

  const unbracketedHostname = stripIpv6Brackets(hostname);
  if (isIP(unbracketedHostname)) {
    if (isPrivateIp(unbracketedHostname)) {
      throw new ScheduleSecurityError("private_ip", "Private IPs are not allowed.");
    }
  }
}

type ResolveAddresses = (hostname: string, options: LookupOptions) => Promise<LookupAddress[]>;

export function createPinnedLookup(
  resolveAddresses: ResolveAddresses = resolveAndValidateAddresses
): LookupFunction {
  return (hostname, options, callback) => {
    void resolveAddresses(hostname, options)
      .then((addresses) => {
        validateAddresses(addresses);
        if (options.all) {
          callback(null, addresses);
          return;
        }

        const address = addresses[0];
        if (!address) {
          callback(new Error("DNS lookup returned no addresses."), []);
          return;
        }

        callback(null, address.address, address.family);
      })
      .catch((error: unknown) => {
        callback(toLookupError(error), []);
      });
  };
}

const pinnedLookup = createPinnedLookup();

async function resolveAndValidateAddresses(
  hostname: string,
  options: LookupOptions
): Promise<LookupAddress[]> {
  const addresses = await lookup(stripIpv6Brackets(hostname), {
    family: options.family,
    hints: options.hints,
    all: true,
  });

  return addresses;
}

function validateAddresses(addresses: LookupAddress[]) {
  for (const address of addresses) {
    if (isPrivateIp(stripIpv6Brackets(address.address))) {
      throw new ScheduleSecurityError("private_ip", "Private IPs are not allowed.");
    }
  }
}

export function isPrivateIp(rawIp: string) {
  const ip = stripIpv6Brackets(rawIp);
  if (isIPv4(ip)) {
    return isPrivateIpv4(ip);
  }

  if (!isIPv6(ip)) {
    return false;
  }

  const segments = parseIpv6Segments(ip);
  if (!segments) {
    // Fail closed if Node accepts an IPv6 form that our canonicalizer cannot parse.
    return true;
  }

  const first = segments[0];
  if (segments.every((segment) => segment === 0)) return true;
  if (segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;

  const isIpv4Mapped =
    segments.slice(0, 5).every((segment) => segment === 0) && segments[5] === 0xffff;
  const isNat64 =
    segments[0] === 0x0064 &&
    segments[1] === 0xff9b &&
    segments.slice(2, 6).every((segment) => segment === 0);

  if (isIpv4Mapped || isNat64) {
    return isPrivateIpv4(embeddedIpv4(segments));
  }

  if ((first & 0xe000) !== 0x2000) return true;
  // IANA marks 2001::/23 non-global except for the allocations preserved below.
  if (first === 0x2001 && (segments[1] & 0xfe00) === 0 && !isPublic2001Special(segments))
    return true;
  if (first === 0x2001 && segments[1] === 0x0db8) return true;
  if (first === 0x2002) return true;
  if (first === 0x3ffe) return true;
  if (first === 0x3fff && (segments[1] & 0xf000) === 0) return true;

  return false;
}

function isPublic2001Special(segments: number[]) {
  const second = segments[1];
  const isProtocolAnycast =
    second === 0x0001 &&
    segments.slice(2, 7).every((segment) => segment === 0) &&
    (segments[7] === 1 || segments[7] === 2 || segments[7] === 3);

  return (
    isProtocolAnycast ||
    second === 0x0003 ||
    (second === 0x0004 && segments[2] === 0x0112) ||
    (second & 0xfff0) === 0x0020 ||
    (second & 0xfff0) === 0x0030
  );
}

function isPrivateIpv4(ip: string) {
  const [a, b, c, d] = ip.split(".").map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 0 && d !== 9 && d !== 10) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function parseIpv6Segments(ip: string): number[] | null {
  const expanded = expandIpv4Tail(ip.toLowerCase());
  if (!expanded) return null;

  const compressionIndex = expanded.indexOf("::");
  if (compressionIndex !== expanded.lastIndexOf("::")) return null;

  const left =
    compressionIndex === -1 ? expanded.split(":") : expanded.slice(0, compressionIndex).split(":");
  const right = compressionIndex === -1 ? [] : expanded.slice(compressionIndex + 2).split(":");
  const leftParts = left.filter(Boolean);
  const rightParts = right.filter(Boolean);
  const missing = 8 - leftParts.length - rightParts.length;

  if ((compressionIndex === -1 && missing !== 0) || (compressionIndex !== -1 && missing < 1)) {
    return null;
  }

  const parts = [...leftParts, ...Array(missing).fill("0"), ...rightParts];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }

  return parts.map((part) => Number.parseInt(part, 16));
}

function expandIpv4Tail(ip: string): string | null {
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (!tail.includes(".")) return ip;
  if (!isIPv4(tail)) return null;

  const octets = tail.split(".").map(Number);
  const high = ((octets[0] << 8) | octets[1]).toString(16);
  const low = ((octets[2] << 8) | octets[3]).toString(16);
  return `${ip.slice(0, lastColon + 1)}${high}:${low}`;
}

function embeddedIpv4(segments: number[]) {
  return [segments[6] >> 8, segments[6] & 0xff, segments[7] >> 8, segments[7] & 0xff].join(".");
}

function stripIpv6Brackets(value: string) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function toLookupError(error: unknown): NodeJS.ErrnoException {
  return error instanceof Error ? error : new Error("DNS lookup failed.");
}

function findScheduleSecurityError(error: unknown): ScheduleSecurityError | null {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    if (current instanceof ScheduleSecurityError) return current;
    if (current instanceof AggregateError) pending.push(...current.errors);
    if (current instanceof Error && current.cause) pending.push(current.cause);
  }

  return null;
}

function isIPv4(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

async function readResponseText(response: UndiciResponse, maxBytes: number) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.length;
      if (received > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ScheduleSecurityError("response_too_large", "Response exceeds size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
  }

  text += decoder.decode();
  return text;
}
