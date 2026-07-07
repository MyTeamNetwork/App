/**
 * Universal-link alias for the auth callback screen.
 *
 * `app/(auth)/callback.tsx` matches the route `/callback` (the group segment is
 * stripped), but universal links from the web arrive as `/auth/callback` — with
 * no route here, Expo Router rendered its "Unmatched Route" screen while the
 * deep-link listener processed the auth payload in the background. This alias
 * renders the same "Completing sign in..." screen at the universal-link path.
 */
export { default } from "../(auth)/callback";
