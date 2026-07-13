const ENABLED_KEY = "teammeet.biometric_enabled.v1";
const LEGACY_SESSION_KEY = "teammeet.biometric_session.v1";
const LEGACY_MARKER_KEY = "teammeet.biometric_session_available.v1";

function loadBiometricModule({
  hasHardware = true,
  isEnrolled = true,
  authenticationResult = { success: true } as { success: true } | { success: false; error: string },
  deleteError,
}: {
  hasHardware?: boolean;
  isEnrolled?: boolean;
  authenticationResult?: { success: true } | { success: false; error: string };
  deleteError?: Error;
} = {}) {
  jest.resetModules();

  const getItemAsync = jest.fn().mockResolvedValue(null);
  const setItemAsync = jest.fn().mockResolvedValue(undefined);
  const deleteItemAsync = deleteError
    ? jest.fn().mockRejectedValue(deleteError)
    : jest.fn().mockResolvedValue(undefined);
  const hasHardwareAsync = jest.fn().mockResolvedValue(hasHardware);
  const isEnrolledAsync = jest.fn().mockResolvedValue(isEnrolled);
  const authenticateAsync = jest.fn().mockResolvedValue(authenticationResult);

  jest.doMock("expo-secure-store", () => ({
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
  }));
  jest.doMock("expo-local-authentication", () => ({
    hasHardwareAsync,
    isEnrolledAsync,
    authenticateAsync,
  }));

  const module = require("../../src/lib/biometric");
  return {
    module,
    secureStore: { getItemAsync, setItemAsync, deleteItemAsync },
    localAuth: { hasHardwareAsync, isEnrolledAsync, authenticateAsync },
  };
}

describe("biometric app lock", () => {
  afterEach(() => {
    jest.dontMock("expo-secure-store");
    jest.dontMock("expo-local-authentication");
    jest.clearAllMocks();
  });

  it("requests strong Android biometrics while allowing the device credential fallback", async () => {
    const { module, localAuth } = loadBiometricModule();

    await expect(module.authenticate("Unlock TeamNetwork")).resolves.toEqual({ success: true });
    expect(localAuth.authenticateAsync).toHaveBeenCalledWith({
      promptMessage: "Unlock TeamNetwork",
      biometricsSecurityLevel: "strong",
      disableDeviceFallback: false,
      cancelLabel: "Cancel",
    });
  });

  it("distinguishes confirmed sign-out from a provisional empty startup session", () => {
    const { module } = loadBiometricModule();

    expect(module.didAuthenticatedSessionEnd(null, null)).toBe(false);
    expect(module.didAuthenticatedSessionEnd(null, "user-1")).toBe(false);
    expect(module.didAuthenticatedSessionEnd("user-1", "user-1")).toBe(false);
    expect(module.didAuthenticatedSessionEnd("user-1", null)).toBe(true);
  });

  it.each([
    {
      name: "persisted session restoration",
      previousUserId: null,
      currentUserId: "user-1",
      isEnabled: true,
      expected: true,
    },
    {
      name: "direct account change",
      previousUserId: "user-1",
      currentUserId: "user-2",
      isEnabled: true,
      expected: true,
    },
    {
      name: "same-user preference enable",
      previousUserId: "user-1",
      currentUserId: "user-1",
      isEnabled: true,
      expected: false,
    },
    {
      name: "same-user token refresh",
      previousUserId: "user-1",
      currentUserId: "user-1",
      isEnabled: false,
      expected: false,
    },
    {
      name: "confirmed sign-out",
      previousUserId: "user-1",
      currentUserId: null,
      isEnabled: true,
      expected: false,
    },
  ])("locks only for an enabled authenticated-user transition: $name", (scenario) => {
    const { module } = loadBiometricModule();

    expect(module.shouldLockOnAuthTransition(scenario)).toBe(scenario.expected);
  });

  it.each([
    { busy: true, isEnrolled: true, isEnabled: false, expected: true },
    { busy: false, isEnrolled: false, isEnabled: false, expected: true },
    { busy: false, isEnrolled: false, isEnabled: true, expected: false },
    { busy: false, isEnrolled: true, isEnabled: false, expected: false },
  ])("keeps an enabled app lock switchable off: %#", (scenario) => {
    const { module } = loadBiometricModule();

    expect(module.isBiometricLockToggleDisabled(scenario)).toBe(scenario.expected);
  });

  it("enables only the device-scoped app lock after local authentication", async () => {
    const { module, secureStore } = loadBiometricModule();

    await expect(module.enableBiometricLock()).resolves.toEqual({ success: true });
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(ENABLED_KEY, "1");
    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it("does not enable the app lock when no biometric is enrolled", async () => {
    const { module, secureStore, localAuth } = loadBiometricModule({ isEnrolled: false });

    await expect(module.enableBiometricLock()).resolves.toEqual({
      success: false,
      error: "Biometric unlock is not available on this device.",
      cancelled: false,
      lockUnavailable: true,
    });
    expect(localAuth.authenticateAsync).not.toHaveBeenCalled();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("maps native cancellation codes to a semantic result", async () => {
    const { module } = loadBiometricModule({
      authenticationResult: { success: false, error: "user_cancel" },
    });

    await expect(module.authenticate("Unlock TeamNetwork")).resolves.toEqual({
      success: false,
      error: "user_cancel",
      cancelled: true,
      lockUnavailable: false,
    });
  });

  it.each(["not_enrolled", "not_available", "passcode_not_set"])(
    "marks %s as requiring app-lock recovery",
    async (error) => {
      const { module } = loadBiometricModule({
        authenticationResult: { success: false, error },
      });

      await expect(module.authenticate("Unlock TeamNetwork")).resolves.toEqual({
        success: false,
        error,
        cancelled: false,
        lockUnavailable: true,
      });
    }
  );

  it("propagates app-lock deletion failures so logout can report them", async () => {
    const deleteError = new Error("Keychain deletion failed");
    const { module } = loadBiometricModule({ deleteError });

    await expect(module.clearBiometricLock()).rejects.toBe(deleteError);
  });

  it("purges retired biometric session credentials without disabling the app lock", async () => {
    const { module, secureStore } = loadBiometricModule();

    await module.clearLegacyBiometricCredentials();

    expect(secureStore.deleteItemAsync.mock.calls.map(([key]) => key)).toEqual([
      LEGACY_SESSION_KEY,
      LEGACY_MARKER_KEY,
    ]);
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalledWith(ENABLED_KEY);
  });

  it("clears both the app-lock preference and retired session credentials on logout", async () => {
    const { module, secureStore } = loadBiometricModule();

    await module.clearBiometricLock();

    expect(secureStore.deleteItemAsync.mock.calls.map(([key]) => key)).toEqual([
      ENABLED_KEY,
      LEGACY_SESSION_KEY,
      LEGACY_MARKER_KEY,
    ]);
  });
});
