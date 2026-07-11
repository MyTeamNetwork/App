import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const VERIFIER_KEY_PREFIX = "teammeet.mobile-oauth-verifier.";
const CHALLENGE_PATTERN = /^[a-f0-9]{64}$/i;
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function storageKey(challenge: string): string {
  return `${VERIFIER_KEY_PREFIX}${challenge.toLowerCase()}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createMobileOAuthChallenge(): Promise<string> {
  const verifier = bytesToHex(await Crypto.getRandomBytesAsync(32));
  const challenge = (
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier)
  ).toLowerCase();

  if (!CHALLENGE_PATTERN.test(challenge)) {
    throw new Error("Could not create a secure sign-in challenge.");
  }

  await SecureStore.setItemAsync(storageKey(challenge), verifier, STORE_OPTIONS);
  return challenge;
}

export async function getMobileOAuthVerifier(challenge: string): Promise<string | null> {
  if (!CHALLENGE_PATTERN.test(challenge)) return null;
  return SecureStore.getItemAsync(storageKey(challenge), STORE_OPTIONS);
}

export async function clearMobileOAuthVerifier(challenge: string): Promise<void> {
  if (!CHALLENGE_PATTERN.test(challenge)) return;
  await SecureStore.deleteItemAsync(storageKey(challenge), STORE_OPTIONS);
}
