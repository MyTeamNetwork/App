import test from "node:test";
import assert from "node:assert/strict";
import { isDurableImageUrl, logoStoragePath, rehostProfileLogos } from "@/lib/linkedin/enrichment-writeback";
import { mapApifyToFields, normalizeApifyItem } from "@/lib/linkedin/apify";
import type { ApifyProfileResult } from "@/lib/linkedin/apify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DURABLE_URL = "https://xyzxyz.supabase.co/storage/v1/object/public/linkedin-photos/logos/abc123";
const LICDN_URL = "https://media.licdn.com/company/acme.png?e=1234567890";
const LICDN_URL_DIFFERENT_QUERY = "https://media.licdn.com/company/acme.png?e=9999999999";
const LICDN_URL_DIFFERENT_PATH = "https://media.licdn.com/company/globex.png?e=1234567890";

function makeFakeImageResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name === "content-type" ? "image/png" : null),
    },
    arrayBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]).buffer,
  };
}

function makeSupabaseStorageStub(headStatus: number, uploadError: null | { message: string }) {
  const uploadedPaths: string[] = [];
  const PUBLIC_BASE = "https://xyzxyz.supabase.co/storage/v1/object/public/linkedin-photos/";

  const storageFrom = () => ({
    upload: async (path: string) => {
      uploadedPaths.push(path);
      return { error: uploadError };
    },
    getPublicUrl: (path: string) => ({
      data: { publicUrl: PUBLIC_BASE + path },
    }),
  });

  return {
    storage: { from: storageFrom },
    _uploadedPaths: uploadedPaths,
    _headStatus: headStatus,
  };
}

function makeMinimalProfile(overrides: Partial<ApifyProfileResult> = {}): ApifyProfileResult {
  return {
    profile_url: "https://www.linkedin.com/in/test/",
    public_url: null,
    name: "Test User",
    first_name: null,
    last_name: null,
    headline: null,
    summary: null,
    photo_url: null,
    city: null,
    industry: null,
    current_company: null,
    experience: [],
    education: [],
    certifications: [],
    skills: [],
    languages: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: logoStoragePath
// ---------------------------------------------------------------------------

test("logoStoragePath: same origin+pathname with different ?e= query -> identical path", () => {
  const path1 = logoStoragePath(LICDN_URL);
  const path2 = logoStoragePath(LICDN_URL_DIFFERENT_QUERY);
  assert.ok(path1, "should return a path");
  assert.equal(path1, path2);
});

test("logoStoragePath: different pathname -> different path", () => {
  const path1 = logoStoragePath(LICDN_URL);
  const path2 = logoStoragePath(LICDN_URL_DIFFERENT_PATH);
  assert.ok(path1);
  assert.ok(path2);
  assert.notEqual(path1, path2);
});

test("logoStoragePath: returns null for non-URL string", () => {
  assert.equal(logoStoragePath("not-a-url"), null);
});

test("logoStoragePath: returns null for ftp:// URL", () => {
  assert.equal(logoStoragePath("ftp://example.com/logo.png"), null);
});

test("logoStoragePath: result matches /^logos\\/[0-9a-f]{64}$/", () => {
  const path = logoStoragePath(LICDN_URL);
  assert.ok(path);
  assert.match(path, /^logos\/[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// Tests: isDurableImageUrl
// ---------------------------------------------------------------------------

test("isDurableImageUrl: true for supabase public storage URL", () => {
  assert.equal(isDurableImageUrl(DURABLE_URL), true);
});

test("isDurableImageUrl: false for media.licdn.com URL", () => {
  assert.equal(isDurableImageUrl(LICDN_URL), false);
});

// ---------------------------------------------------------------------------
// Tests: rehostProfileLogos
// ---------------------------------------------------------------------------

test("rehostProfileLogos: mutates logo fields to durable URLs", async () => {
  const profile = makeMinimalProfile({
    experience: [
      {
        title: "Engineer",
        company: "Acme",
        company_logo_url: LICDN_URL,
        location: null,
        start_date: null,
        end_date: null,
        description_html: null,
      },
    ],
    education: [
      {
        title: "State U",
        institute_logo_url: "https://media.licdn.com/school/state.png?e=1234567890",
        degree: null,
        field_of_study: null,
        start_year: null,
        end_year: null,
        description: null,
      },
    ],
    certifications: [
      {
        name: "Cloud Cert",
        authority: "Acme",
        issued_on: null,
        logo_url: "https://media.licdn.com/cert/cloud.png?e=1234567890",
      },
    ],
  });

  const fetchFn = async (_url: string, opts?: { method?: string }) => {
    if (opts?.method === "HEAD") {
      return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return makeFakeImageResponse(200) as unknown as Response;
  };

  const stub = makeSupabaseStorageStub(404, null);
  const cache = new Map<string, Promise<string | null>>();
  await rehostProfileLogos(stub, profile, cache, fetchFn as unknown as typeof fetch);

  const companyLogo = profile.experience[0].company_logo_url;
  assert.ok(companyLogo, "company logo should be set");
  assert.ok(isDurableImageUrl(companyLogo), `expected durable company logo URL, got: ${companyLogo}`);

  const schoolLogo = profile.education[0].institute_logo_url;
  assert.ok(schoolLogo, "school logo should be set");
  assert.ok(isDurableImageUrl(schoolLogo), `expected durable school logo URL, got: ${schoolLogo}`);

  const certLogo = profile.certifications[0].logo_url;
  assert.ok(certLogo, "certification logo should be set");
  assert.ok(isDurableImageUrl(certLogo), `expected durable certification logo URL, got: ${certLogo}`);
});

test("rehostProfileLogos: reference-sharing - same object reachable via mapApifyToFields", async () => {
  const rawItem = {
    linkedinUrl: "https://www.linkedin.com/in/test/",
    fullName: "Test User",
    experiences: [
      {
        title: "Engineer",
        companyName: "Acme",
        logo: LICDN_URL,
      },
    ],
    educations: [],
    skills: [],
    licenseAndCertificates: [],
    languages: [],
  };

  const profile = normalizeApifyItem(rawItem);
  assert.ok(profile, "profile should normalize");

  const fetchFn = async (_url: string, opts?: { method?: string }) => {
    if (opts?.method === "HEAD") {
      return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return makeFakeImageResponse(200) as unknown as Response;
  };

  const stub = makeSupabaseStorageStub(404, null);
  const cache = new Map<string, Promise<string | null>>();
  await rehostProfileLogos(stub, profile, cache, fetchFn as unknown as typeof fetch);

  const directLogo = profile.experience[0].company_logo_url;
  assert.ok(directLogo && isDurableImageUrl(directLogo), "direct access should be durable");

  const fields = mapApifyToFields(profile);
  const viaFields = fields.work_history?.[0]?.company_logo_url;
  assert.equal(viaFields, directLogo, "mapApifyToFields returns the same array by reference");
});

test("rehostProfileLogos: leaves already-durable URL untouched, no fetch", async () => {
  const profile = makeMinimalProfile({
    experience: [
      {
        title: "Engineer",
        company: "Acme",
        company_logo_url: DURABLE_URL,
        location: null,
        start_date: null,
        end_date: null,
        description_html: null,
      },
    ],
  });

  let fetchCalled = false;
  const fetchFn = async () => {
    fetchCalled = true;
    return makeFakeImageResponse(200) as unknown as Response;
  };

  const stub = makeSupabaseStorageStub(200, null);
  const cache = new Map<string, Promise<string | null>>();
  await rehostProfileLogos(stub, profile, cache, fetchFn as unknown as typeof fetch);

  assert.equal(fetchCalled, false, "should not call fetchFn for already-durable URL");
  assert.equal(profile.experience[0].company_logo_url, DURABLE_URL, "URL should remain unchanged");
});

test("rehostProfileLogos: on GET fetch failure (403), leaves original URL in place", async () => {
  const profile = makeMinimalProfile({
    experience: [
      {
        title: "Engineer",
        company: "Acme",
        company_logo_url: LICDN_URL,
        location: null,
        start_date: null,
        end_date: null,
        description_html: null,
      },
    ],
  });

  const fetchFn = async (_url: string, opts?: { method?: string }) => {
    if (opts?.method === "HEAD") {
      return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: false, status: 403, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  const stub = makeSupabaseStorageStub(404, null);
  const cache = new Map<string, Promise<string | null>>();
  await rehostProfileLogos(stub, profile, cache, fetchFn as unknown as typeof fetch);

  assert.equal(profile.experience[0].company_logo_url, LICDN_URL, "original URL should remain on failure");
});

test("rehostProfileLogos: two entries with same logo pathname but different query -> exactly one GET", async () => {
  const profile = makeMinimalProfile({
    experience: [
      {
        title: "Engineer",
        company: "Acme",
        company_logo_url: LICDN_URL,
        location: null,
        start_date: null,
        end_date: null,
        description_html: null,
      },
      {
        title: "Senior Engineer",
        company: "Acme",
        company_logo_url: LICDN_URL_DIFFERENT_QUERY,
        location: null,
        start_date: null,
        end_date: null,
        description_html: null,
      },
    ],
  });

  let getCallCount = 0;
  const fetchFn = async (_url: string, opts?: { method?: string }) => {
    if (opts?.method === "HEAD") {
      return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    getCallCount++;
    return makeFakeImageResponse(200) as unknown as Response;
  };

  const stub = makeSupabaseStorageStub(404, null);
  const cache = new Map<string, Promise<string | null>>();
  await rehostProfileLogos(stub, profile, cache, fetchFn as unknown as typeof fetch);

  assert.equal(getCallCount, 1, `expected exactly 1 GET download for 2 entries with same path, got ${getCallCount}`);

  const logo0 = profile.experience[0].company_logo_url;
  const logo1 = profile.experience[1].company_logo_url;
  assert.ok(logo0 && isDurableImageUrl(logo0), "first entry should have durable URL");
  assert.ok(logo1 && isDurableImageUrl(logo1), "second entry should have durable URL");
  assert.equal(logo0, logo1, "both entries should have the same durable URL");
});
