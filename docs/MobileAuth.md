# Mobile App Authentication Setup

This document covers authentication setup for the TeamMeet mobile app (Expo/React Native).

## Current Status

| Environment | Email/Password | Google/LinkedIn/Microsoft OAuth | Apple Sign-In |
|-------------|---------------|-------------------------------|---------------|
| Expo Web (localhost:8081) | ✅ Works | ❌ Blocked | ❌ Not supported |
| Expo Go (QR code) | ✅ Works | ❌ Blocked | ⚠️ Limited preview only |
| Native Dev Build | ✅ Works | ✅ Works | ✅ iOS only |
| Production Build | ✅ Works | ✅ Works | ✅ iOS only |

**Why is web-based OAuth blocked in Expo Go/Web?**
- OAuth requires deep link handling with custom URL schemes (`teammeet://`)
- Expo Go and Expo Web cannot register custom URL schemes
- OAuth callbacks would redirect to the production web app, not back to the mobile app

Apple Sign-In uses the native iOS `expo-apple-authentication` module instead of the web OAuth handoff. It is hidden on Android and web.

---

## Setting Up Social Auth for Native Builds

### 1. Supabase Dashboard Configuration

Add the mobile deep link URL to allowed redirects:

1. Go to **Supabase Dashboard → Authentication → URL Configuration**
2. Under **Redirect URLs**, add:
   ```
   teammeet://(auth)/callback
   ```

### 2. Provider Console Setup

Configure OAuth for mobile platforms:

**iOS:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Credentials
2. Edit your OAuth 2.0 Client ID (or create one for iOS)
3. Add your iOS bundle identifier: `com.myteamnetwork.teammeet`

**Android:**
1. Create an OAuth 2.0 Client ID for Android
2. Add package name: `com.myteamnetwork.teammeet`
3. Add SHA-1 certificate fingerprint:
   ```bash
   # For debug keystore
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

**Apple:**
1. In Apple Developer, enable **Sign in with Apple** for bundle ID `com.myteamnetwork.teammeet`.
2. In Supabase Dashboard → Authentication → Providers, enable Apple for the production project.
3. For native iOS Sign-In, the app uses Apple’s identity token with `supabase.auth.signInWithIdToken({ provider: "apple" })`.

### 3. Create Development Build with EAS

Install EAS CLI if not already installed:
```bash
npm install -g eas-cli
```

Configure EAS (first time only):
```bash
cd apps/mobile
eas build:configure
```

Build for iOS Simulator:
```bash
eas build --profile development --platform ios
```

Build for Android Emulator:
```bash
eas build --profile development --platform android
```

### 4. Install and Run Development Build

After the build completes:
```bash
# iOS - download and drag to simulator, or:
eas build:run -p ios

# Android - install APK, or:
eas build:run -p android
```

Start the dev server:
```bash
cd apps/mobile
bun expo start --dev-client
```

---

## Architecture Notes

### Web OAuth Flow (Native)
1. User taps Google, LinkedIn, or Microsoft
2. `expo-web-browser` opens a web-owned `/auth/mobile/<provider>` route
3. User authenticates with the provider
4. Web callback creates a short-lived mobile handoff and redirects to `teammeet://callback?handoff_code=...`
5. App receives the deep link via `expo-linking`
6. `consumeMobileAuthHandoff()` exchanges the one-time handoff code for Supabase session tokens
7. `_layout.tsx` detects auth state change and navigates to app

### Apple Sign-In Flow (iOS Native)
1. User taps the official Apple button
2. `expo-apple-authentication` opens the native Apple sheet
3. The app hashes a nonce for Apple and sends the raw nonce with Apple’s identity token to Supabase
4. Supabase validates the token through `signInWithIdToken({ provider: "apple" })`
5. The session persists through the existing mobile Supabase client
6. First-login full name metadata is saved when Apple provides it

### Key Files
- `apps/mobile/app/(auth)/login.tsx` - email, web OAuth, and Apple Sign-In triggers
- `apps/mobile/app/(auth)/signup.tsx` - age-gated signup flows
- `apps/mobile/app/(auth)/callback.tsx` - Deep link handler
- `apps/mobile/app/_layout.tsx` - Auth state management
- `apps/mobile/src/lib/apple-auth.ts` - Native Apple Sign-In helper
- `apps/mobile/src/lib/supabase.ts` - Supabase client config

### Supabase Client Configuration
```typescript
// apps/mobile/src/lib/supabase.ts
export const supabase = createClient(url, key, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
    flowType: "pkce",
  },
});
```

---

## Troubleshooting

### OAuth redirects to web app instead of mobile
- Ensure `teammeet://(auth)/callback` is in Supabase redirect URLs
- Verify you're using a native build, not Expo Go

### "Expo Go Limitation" alert appears
- Expected behavior - Google OAuth is intentionally blocked in Expo Go
- Use email/password login for testing, or create a development build

### Session not persisting after OAuth
- Check that `SecureStore`/mobile auth storage is properly configured
- Verify the handoff code is being consumed by `/api/auth/mobile-handoff/consume`
- Check console logs for errors in token extraction

### Apple button does not appear
- Confirm the app is running on iOS and `AppleAuthentication.isAvailableAsync()` returns true
- Confirm the build includes the `expo-apple-authentication` native module
- Rebuild the dev client after changing native config
