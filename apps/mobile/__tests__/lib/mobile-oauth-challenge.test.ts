import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  clearMobileOAuthVerifier,
  createMobileOAuthChallenge,
  getMobileOAuthVerifier,
} from "@/lib/mobile-oauth-challenge";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  getRandomBytesAsync: jest.fn(),
  digestStringAsync: jest.fn(),
}));

describe("mobile OAuth device binding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stores a random verifier locally under its SHA-256 challenge", async () => {
    jest
      .mocked(Crypto.getRandomBytesAsync)
      .mockResolvedValue(Uint8Array.from({ length: 32 }, (_, index) => index));
    jest.mocked(Crypto.digestStringAsync).mockResolvedValue("a".repeat(64));

    await expect(createMobileOAuthChallenge()).resolves.toBe("a".repeat(64));

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.stringContaining("a".repeat(64)),
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      expect.any(Object)
    );
  });

  it("reads and clears only the verifier for the callback challenge", async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue("device-verifier");

    await expect(getMobileOAuthVerifier("b".repeat(64))).resolves.toBe("device-verifier");
    await clearMobileOAuthVerifier("b".repeat(64));

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      expect.stringContaining("b".repeat(64)),
      expect.any(Object)
    );
  });
});
