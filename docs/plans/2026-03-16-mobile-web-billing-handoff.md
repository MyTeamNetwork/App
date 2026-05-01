# Mobile Web Billing Handoff Implementation Plan

> **For Claude:** Tasks marked "Depends on: none" form Wave 1 and can run in
> parallel. Tasks with dependencies wait for their prerequisites to complete.
> REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Make mobile billing flows stop mutating Stripe state directly and instead guide admins into the existing web billing experience inside the app.

**Architecture:** Keep subscription status and quota visibility in mobile, but move all billing actions behind one shared mobile handoff flow. Reuse the existing in-app web modal, point every billing action at the existing web route `/${orgSlug}/settings/invites`, and refresh `useSubscription()` when the modal closes so webhook-driven changes are reflected.

**Tech Stack:** Expo Router, React Native, `react-native-webview`, Jest, shared mobile helpers in `apps/mobile/src/lib`

---

## Scope Guardrails

- Mobile files only. Do not modify `apps/web`.
- Treat `/${orgSlug}/settings/invites` as the canonical existing web destination because `/${orgSlug}/settings/billing` is not present in the web app.
- Keep `useSubscription()` as the source of truth for the mobile UI.
- Prefer a small shared helper plus minimal screen changes over introducing a new billing state system.

## Wave Overview

Wave 1: Task 1
Wave 2: Task 2, Task 3
Wave 3: Task 4
Wave 4: Task 5

### Task 1: Add Shared Billing Handoff Helper
**Depends on:** none

**Files:**
- Create: `apps/mobile/src/lib/billing-web-handoff.ts`
- Test: `apps/mobile/__tests__/lib/billing-web-handoff.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "@jest/globals";
import {
  getBillingWebUrl,
  shouldRefreshAfterBillingWebClose,
} from "@/lib/billing-web-handoff";

describe("billing web handoff", () => {
  it("builds the existing web invites route for an org", () => {
    expect(getBillingWebUrl("acme")).toBe("https://www.myteamnetwork.com/acme/settings/invites");
  });

  it("refreshes after the user closes the billing web flow", () => {
    expect(shouldRefreshAfterBillingWebClose()).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/mobile && bun test -- billing-web-handoff.test.ts`
Expected: FAIL because `billing-web-handoff.ts` does not exist yet.

**Step 3: Write minimal implementation**

```ts
import { getWebAppUrl } from "@/lib/web-api";

export function getBillingWebUrl(orgSlug: string): string {
  return `${getWebAppUrl()}/${orgSlug}/settings/invites`;
}

export function shouldRefreshAfterBillingWebClose(): boolean {
  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/mobile && bun test -- billing-web-handoff.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/mobile/src/lib/billing-web-handoff.ts apps/mobile/__tests__/lib/billing-web-handoff.test.ts
git commit -m "feat: add mobile billing web handoff helper"
```

### Task 2: Generalize The Existing Web Modal For Billing Handoff
**Depends on:** Task 1

**Files:**
- Modify: `apps/mobile/src/components/StripeWebView.tsx`
- Modify: `apps/mobile/src/lib/billing-web-handoff.ts`
- Test: `apps/mobile/__tests__/lib/billing-web-handoff.test.ts`

**Step 1: Extend the failing test for reusable close behavior**

```ts
import { matchesBillingWebCloseUrl } from "@/lib/billing-web-handoff";

it("closes when the user navigates back into the org route", () => {
  expect(matchesBillingWebCloseUrl("https://www.myteamnetwork.com/acme?checkout=success", "acme")).toBe(true);
  expect(matchesBillingWebCloseUrl("https://www.myteamnetwork.com/acme/settings/invites", "acme")).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/mobile && bun test -- billing-web-handoff.test.ts`
Expected: FAIL because `matchesBillingWebCloseUrl` does not exist yet.

**Step 3: Write minimal implementation**

```ts
export function matchesBillingWebCloseUrl(url: string, orgSlug: string): boolean {
  return url.includes(`/${orgSlug}?checkout=`) || url.endsWith(`/${orgSlug}`);
}
```

Then update `StripeWebView.tsx` so it becomes a generic embedded billing browser:
- Keep the file name unless the rename is trivial.
- Replace Stripe-specific comments and title defaults with generic web-billing wording.
- Use `matchesBillingWebCloseUrl()` instead of hard-coded success/cancel arrays when the caller only needs org return detection.

**Step 4: Run test to verify it passes**

Run: `cd apps/mobile && bun test -- billing-web-handoff.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/mobile/src/components/StripeWebView.tsx apps/mobile/src/lib/billing-web-handoff.ts apps/mobile/__tests__/lib/billing-web-handoff.test.ts
git commit -m "refactor: generalize mobile billing web modal"
```

### Task 3: Add A Reusable Mobile Prompt Before Opening Web Billing
**Depends on:** Task 1

**Files:**
- Create: `apps/mobile/src/components/BillingWebPrompt.tsx`
- Modify: `apps/mobile/app/(app)/(drawer)/[orgSlug]/settings.tsx`

**Step 1: Add the prompt contract in code comments and props**

Create a small modal component with these props:

```ts
type BillingWebPromptProps = {
  visible: boolean;
  title?: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};
```

**Step 2: Implement the minimal UI**

Use existing mobile patterns only:
- `Modal`
- `Pressable`
- `Text`
- `View`
- `StyleSheet`

Copy should urge web usage:
- Title: `Manage Billing on the Web`
- Body: `Subscriptions, invoices, payment methods, and cancellation are handled in the web app. Continue there for the full billing experience.`
- Buttons: `Open Web App` and `Not Now`

**Step 3: Integrate it into `settings.tsx` without changing billing behavior yet**

Add state only:

```ts
const [showBillingPrompt, setShowBillingPrompt] = useState(false);
const [billingWebUrl, setBillingWebUrl] = useState<string | null>(null);
```

Render the prompt and wire `onConfirm` to set `billingWebUrl(getBillingWebUrl(orgSlug))`.

**Step 4: Run targeted typecheck**

Run: `cd apps/mobile && bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/mobile/src/components/BillingWebPrompt.tsx apps/mobile/app/\(app\)/\(drawer\)/[orgSlug]/settings.tsx
git commit -m "feat: add mobile billing web prompt"
```

### Task 4: Replace Direct Billing Mutations In Mobile Settings
**Depends on:** Task 2, Task 3

**Files:**
- Modify: `apps/mobile/app/(app)/(drawer)/[orgSlug]/settings.tsx`
- Modify: `apps/mobile/src/lib/billing-web-handoff.ts`
- Modify: `apps/mobile/src/components/StripeWebView.tsx`

**Step 1: Remove direct billing API ownership from handlers**

Delete or replace the code paths that currently call:

```ts
await fetchWithAuth("/api/stripe/billing-portal", ...);
await fetchWithAuth(`/api/organizations/${orgId}/start-checkout`, ...);
await fetchWithAuth(`/api/organizations/${orgId}/subscription`, ...);
await fetchWithAuth(`/api/organizations/${orgId}/cancel-subscription`, ...);
```

Replace them with one shared entry point:

```ts
function openBillingHandoff() {
  setShowBillingPrompt(true);
}
```

Use that shared entry point for:
- `Manage Billing`
- `Update Plan`
- `Cancel Subscription`
- any alumni-upgrade nudges that currently imply direct in-app billing mutation

**Step 2: Rewire the modal close path**

When the embedded web modal closes:

```ts
const handleCloseBillingWeb = async () => {
  setBillingWebUrl(null);
  await refetchSubscription();
};
```

Do not assume checkout finished successfully. Always refresh defensively.

**Step 3: Keep current mobile quota UI, but change the action wording**

Examples:
- `Update Plan` can stay if product wants continuity.
- Helper text should say the user will continue in the web app.
- `Manage Billing` should clearly indicate it opens the web app inside the modal.

**Step 4: Run verification**

Run: `cd apps/mobile && bun run typecheck && bun test -- billing-web-handoff.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/mobile/app/\(app\)/\(drawer\)/[orgSlug]/settings.tsx apps/mobile/src/components/StripeWebView.tsx apps/mobile/src/lib/billing-web-handoff.ts
git commit -m "refactor: move mobile billing settings to web handoff"
```

### Task 5: Align The Dedicated Billing Screen With The Shared Handoff Pattern
**Depends on:** Task 4

**Files:**
- Modify: `apps/mobile/app/(app)/(drawer)/[orgSlug]/billing/index.tsx`
- Modify: `apps/mobile/src/lib/billing-web-handoff.ts`
- Optional: `apps/mobile/src/components/BillingWebPrompt.tsx`

**Step 1: Replace direct external linking with the shared helper**

Current code:

```ts
const url = `https://www.myteamnetwork.com/${orgSlug}/settings/billing`;
Linking.openURL(url);
```

Target behavior:

```ts
const url = getBillingWebUrl(orgSlug);
setShowBillingPrompt(true);
```

Use the same prompt copy and the same embedded web modal used in settings.

**Step 2: Tighten the informational copy**

Make the billing screen consistent with the new product direction:
- Mobile shows plan, status, dates, and quota.
- Web handles subscription changes, invoices, payment methods, and cancellation.

**Step 3: Run verification**

Run: `cd apps/mobile && bun run typecheck && bun test -- billing-web-handoff.test.ts`
Expected: PASS

**Step 4: Manual QA**

Run the app and verify:
- Admin opens `Billing` and sees a prompt before leaving the screen.
- Admin opens `Manage Billing`, `Update Plan`, and `Cancel Subscription` from settings and always gets the same prompt.
- `Open Web App` loads `/${orgSlug}/settings/invites` in the embedded web modal.
- Closing the modal triggers a subscription refresh and does not crash if nothing changed.
- Non-admin users still cannot access admin billing controls.

**Step 5: Commit**

```bash
git add apps/mobile/app/\(app\)/\(drawer\)/[orgSlug]/billing/index.tsx apps/mobile/src/components/BillingWebPrompt.tsx apps/mobile/src/lib/billing-web-handoff.ts
git commit -m "feat: unify mobile billing screens around web handoff"
```

## Notes For Execution

- Do not rename `StripeWebView.tsx` unless the rename is trivial and localized. A behavioral cleanup is enough.
- Do not add new web routes or web APIs.
- Do not remove `useSubscription()` data fetching; only change the mutation entry points.
- If the current settings screen contains multiple billing-related button labels, normalize them after the shared flow works.

## Final Verification Commands

```bash
cd apps/mobile
bun run typecheck
bun test -- billing-web-handoff.test.ts
```

Expected:
- TypeScript passes
- New helper test passes
- Manual QA confirms a consistent mobile-only handoff to the existing web billing route
