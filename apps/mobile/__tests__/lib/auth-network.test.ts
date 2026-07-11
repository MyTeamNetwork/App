import { pingAuthSurfaces } from "@/lib/auth-network";

describe("pingAuthSurfaces", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns supabase: true when fetch returns 2xx", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as jest.Mock;

    const result = await pingAuthSurfaces("https://example.supabase.co");

    expect(result).toEqual({ supabase: true });
  });

  it("returns supabase: false on 5xx response", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as jest.Mock;

    const result = await pingAuthSurfaces("https://example.supabase.co");

    expect(result).toEqual({ supabase: false });
  });

  it("returns supabase: false on 4xx response", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as jest.Mock;

    const result = await pingAuthSurfaces("https://example.supabase.co");

    expect(result).toEqual({ supabase: false });
  });

  it("returns supabase: false when fetch throws TypeError", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError("Network request failed")) as jest.Mock;

    const result = await pingAuthSurfaces("https://invalid.example.invalid");

    expect(result).toEqual({ supabase: false });
  });

  it("returns supabase: false when no url provided and env unset", async () => {
    const prev = process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as jest.Mock;

    const result = await pingAuthSurfaces();

    expect(result.supabase).toBe(false);

    if (prev !== undefined) process.env.EXPO_PUBLIC_SUPABASE_URL = prev;
  });
});
