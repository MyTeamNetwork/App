# Mobile App — CLAUDE.md

Self-contained reference for `apps/mobile/`. Root `CLAUDE.md` covers web app, payments, and database patterns.

## Commands

All commands run from `apps/mobile/`.

### Development

```bash
bun run start                # Expo dev server (web at localhost:8081)
bun run start:dev-client     # Expo dev server for custom dev client builds
bun run ios                  # Start + open iOS Simulator (dev client)
bun run android              # Start + open Android Emulator (dev client, auto-detects SDK)
bun run web                  # Start Expo web mode
```

### Building

```bash
bun run prebuild             # Generate native projects (android/, ios/)
bun run prebuild:clean       # Regenerate native projects from scratch
bun run run:ios              # Build and run on iOS device/simulator
bun run run:android          # Build and run on Android device/emulator
eas build --platform ios     # Cloud build for iOS (EAS)
eas build --platform android # Cloud build for Android (EAS)
eas submit --platform ios    # Submit to App Store
eas submit --platform android # Submit to Play Store
```

### Quality

```bash
bun run typecheck            # tsc --noEmit
bun test                     # All Jest tests
bun test -- --watch          # Watch mode
bun test -- --coverage       # Coverage report
bun test -- --ci             # CI runner with coverage
```

### Diagnostics

```bash
bun run config               # Print resolved Expo config (public)
bun run config:introspect    # Print full introspected Expo config
bun run android:doctor       # Verify Android SDK, Java, and adb setup
```

## Architecture

**Stack:** Expo SDK 54, React Native 0.81, React 19, Expo Router 6
**Auth:** Supabase with AsyncStorage (not cookies)
**Styling:** `useThemedStyles` hook + `TYPOGRAPHY` + `SPACING`/`RADIUS` from design-tokens (not Tailwind/NativeWind)
**State:** React Context + hooks (no Redux/Zustand)
**Icons:** `lucide-react-native`
**Animations:** `react-native-reanimated` (FadeIn, FadeInDown, etc.)

**Provider hierarchy:**
```
AuthProvider → GestureHandlerRootView → StripeProvider → Stack
  └─ (auth): login, signup, forgot-password, reset-password, callback
  └─ (app)/(drawer): org list, profile, terms
       └─ [orgSlug] (OrgProvider)
            └─ (tabs): home, members, alumni, announcements, calendar, menu
            └─ Feature stacks: chat, events, announcements, workouts, schedules, etc.
```

## Routing

| Route Group | Purpose |
|---|---|
| `(auth)` | Unauthenticated screens |
| `(app)/(drawer)` | Authenticated — org list, profile, terms |
| `(app)/(drawer)/[orgSlug]/(tabs)` | Org-scoped tab screens (primary nav) |
| `(app)/(drawer)/[orgSlug]/[feature]` | Org-scoped feature stacks |

Drawer = secondary nav (org logo tap). Tabs = primary nav.

## Styling

Use the `useThemedStyles` hook (dark-mode-ready) for screen styles. Typography from `src/lib/typography.ts`, tokens from `src/lib/design-tokens.ts`.

```typescript
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS, SEMANTIC } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const styles = useThemedStyles((n, s) => ({
  card: {
    backgroundColor: n.surface,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: n.border,
    padding: SPACING.md,
    boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
  },
  title: {
    ...TYPOGRAPHY.titleLarge,
    color: n.foreground,
  },
}));
```

**Design tokens** (`src/lib/design-tokens.ts`):
- **NEUTRAL / NEUTRAL_DARK** — surface, background, foreground, border, muted (app chrome)
- **SEMANTIC / SEMANTIC_DARK** — success, warning, error, info
- **ENERGY** — live indicators, achievements
- **SPACING** (8pt grid), **RADIUS**, **SHADOWS**, **AVATAR_SIZES**
- Also: `ROLE_COLORS`, `RSVP_COLORS`

**Typography** (`src/lib/typography.ts`): `displayLarge/Medium`, `headlineLarge/Medium/Small`, `titleLarge/Medium/Small`, `bodyLarge/Medium/Small`, `labelLarge/Medium/Small`, `caption`, `overline`, `tabLabel`.

**APP_CHROME** (`src/lib/chrome.ts`): Fixed header gradient (`#0f172a` → `#020617`) and tab bar colors.

**Legacy:** `src/lib/theme.ts` (`spacing`, `fontSize`, `fontWeight`, `borderRadius`) is still used by some screens but new screens should use `design-tokens.ts` + `typography.ts` + `useThemedStyles`.

**Brand wordmark** (`assets/brand-logo.png`, `@2x.png`, `@3x.png`): Product logo sourced from the web app (`apps/web/public/TeamNetwor.png`). Use via `require()` with `expo-image`, `contentFit="contain"`, `transition={0}`, `cachePolicy="memory"`. Intended for dark surfaces only (`#0a0a0a`–`#0f172a` range) — the type is light-colored. NOT for use as launcher icon or splash; those are separate assets in `android/app/src/main/res/` and `assets/splash.png`.

## Screen UI Pattern

All org screens follow this layout:

```typescript
<View style={styles.container}>
  <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}>
    <SafeAreaView edges={["top"]}>
      <Pressable onPress={handleDrawerToggle}>
        <Image source={{ uri: org.logo_url }} />
      </Pressable>
      <Text style={styles.headerTitle}>Screen Title</Text>
    </SafeAreaView>
  </LinearGradient>
  <View style={styles.contentSheet}>{/* content */}</View>
</View>
```

Requirements:
1. `headerShown: false` in screen options
2. Org logo opens drawer via `DrawerActions.toggleDrawer()`
3. Content sheet uses `NEUTRAL.surface` background
4. Web URLs: `https://www.myteamnetwork.com/[orgSlug]/[screen]` (not `app.teammeet.com`)

## Drawer Navigation

File: `src/navigation/DrawerContent.tsx`. Accessible via org logo tap.

Sections: Main (Home, Chat, Alumni*, Mentorship), Training, Money, Other (Forms). Pinned footer: Settings, Navigation, Organizations, Sign Out. *Alumni conditional on `permissions.canViewAlumni`.

Navigation: Home/Organizations use `router.push()`, everything else uses `router.replace()`.

## Data Fetching

Custom hooks in `src/hooks/` (e.g., `useEvents`, `useMembers`, `useAnnouncements`):

- **Stale-while-revalidate:** 30s stale time. `refetchIfStale()` on tab focus, `refetch()` on pull-to-refresh.
- **Realtime:** Supabase `postgres_changes` channel subscriptions auto-refetch.
- **Cleanup:** `isMountedRef` prevents updates after unmount.
- **Soft deletes:** Always filter `.is("deleted_at", null)`.

## Adding a New Screen

1. Create file in appropriate route group
2. Follow gradient header + content sheet pattern
3. Set `headerShown: false`
4. Use `useOrg()` for org context
5. Create data hook in `src/hooks/` following `useEvents` pattern
6. Use `useFocusEffect` with `refetchIfStale()`

## Component Patterns

- **Pressable** over TouchableOpacity
- **expo-image** Image over RN Image
- **lucide-react-native** for icons
- **@gorhom/bottom-sheet** for bottom sheets
- **SafeAreaView** from react-native-safe-area-context
- **LinearGradient** from expo-linear-gradient

## Supabase Client

`src/lib/supabase.ts` uses AsyncStorage (not cookies): `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`.

## TypeScript Patterns

**Database Nullability:** Always handle nulls from Supabase. Provide defaults when displaying.

**RPC Parameters:** Use `undefined` (not `null`) for optional params: `p_uses: usesValue ?? undefined`.

**React Navigation Types:** Use `any` for nav props due to Expo Router / React Navigation type conflicts.

**Expo SDK 54 APIs:**
- Notifications: Include `shouldShowBanner` and `shouldShowList` in handler
- Application: Use `Application.getAndroidId()` (not `.androidId`)
- FileSystem: Use string `"base64"` (not `FileSystem.EncodingType.Base64`)

**ThemeColors:** Screen-local `*_COLORS` must include all ThemeColors properties (background, foreground, card, border, muted, primary/secondary variants, success, warning, error, etc.).

## Analytics

PostHog (product analytics) + Sentry (error tracking). Abstraction in `src/lib/analytics/`. Auto screen tracking via `src/hooks/useScreenTracking.ts`. Disabled in `__DEV__` by default. Init in `app/_layout.tsx`.

## Environment Variables

Copy `.env.example` to `.env.local` (never commit `.env.local`).

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `EXPO_PUBLIC_WEB_URL` | No | Web app URL for API calls (default: `https://www.myteamnetwork.com`) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | No | Google OAuth web client ID (native Google Sign-In) |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | No | Google OAuth iOS client ID |
| `EXPO_PUBLIC_POSTHOG_KEY` | No | PostHog product analytics key |
| `EXPO_PUBLIC_SENTRY_DSN` | No | Sentry error tracking DSN |
| `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` | No | hCaptcha site key (donations/Stripe) |
| `EXPO_PUBLIC_HCAPTCHA_BASE_URL` | No | hCaptcha base URL |

## Testing

- **Runner:** Jest 29 with `babel-jest` + `babel-preset-expo`
- **Environment:** `node` (not jsdom)
- **Location:** `__tests__/` mirroring `src/`
- **Scope:** Pure function tests only (components/hooks need Detox/Maestro for E2E)
- **Module aliases:** `@/` and `@teammeet/*` mapped in `jest.config.js`
- **Coverage:** Per-file thresholds in `jest.config.js`

## Shared Packages

```typescript
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization, UserRole } from "@teammeet/types";
import { baseSchemas, z } from "@teammeet/validation";
```

## Monorepo Integration

- `@/*` → `./src/*` (tsconfig.json + jest.config.js)
- Metro config: `watchFolders` includes workspace root, `extraNodeModules` pins react/react-native to local copies

## Key Files

| File | Purpose |
|---|---|
| `app/_layout.tsx` | Root layout, auth, Stripe, analytics init |
| `app/(app)/(drawer)/[orgSlug]/(tabs)/_layout.tsx` | Tab navigator |
| `app/(app)/(drawer)/[orgSlug]/(tabs)/index.tsx` | Home screen (reference impl) |
| `app/(app)/(drawer)/[orgSlug]/_layout.tsx` | Org stack — registers all feature screens |
| `src/contexts/AuthContext.tsx` | Auth state |
| `src/contexts/OrgContext.tsx` | Org scope |
| `src/contexts/NetworkContext.tsx` | Online/offline state |
| `src/contexts/ColorSchemeContext.tsx` | Light/dark mode, provides `neutral`/`semantic` |
| `src/hooks/useThemedStyles.ts` | Dark-mode-ready StyleSheet factory |
| `src/navigation/DrawerContent.tsx` | Drawer sections |
| `src/lib/design-tokens.ts` | Colors, spacing, radius, shadows |
| `src/lib/typography.ts` | Typography scale |
| `src/lib/chrome.ts` | Header/tab bar colors |
| `app.json` | Expo config (authoritative — prebuild-only) |
| `eas.json` | EAS Build profiles |
| `metro.config.js` | Metro monorepo config |
| `scripts/with-android-env.sh` | Auto-detects Android SDK/Java for `bun run android` |

## Coding Conventions

TypeScript strict, 2-space indent, semicolons, double quotes. PascalCase components, camelCase functions. `useX` hooks. Commits: `feat:`, `fix:`, `chore:`.
