import { test, expect } from "@playwright/test";
import { TestData } from "../fixtures/test-data";

test.describe("Invite management", () => {
  const orgSlug = TestData.getOrgSlug();

  test("create invite code, verify visible, revoke", async ({ page }) => {
    // Navigate to invites settings
    await page.goto(`/${orgSlug}/settings/invites`);
    await page.waitForLoadState("networkidle");

    // Count existing invite rows before creating
    const initialRowCount = await page.getByTestId("invite-row").count();

    // CREATE — click generate code button
    await page.getByTestId("invite-submit").click();

    // VERIFY — a new invite row should appear
    await expect(page.getByTestId("invite-row")).toHaveCount(initialRowCount + 1, {
      timeout: 10000,
    });

    // REVOKE the newest invite
    // Handle confirm dialog if present
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    // Find the newest invite row and click its revoke button
    const inviteRows = page.getByTestId("invite-row");
    const newestRow = inviteRows.first();
    await newestRow.getByTestId("invite-revoke").click();

    // Verify the invite is revoked — revoke button should no longer be present on that row,
    // or the row count should decrease back to the original
    await expect(async () => {
      const revokeButtons = newestRow.getByTestId("invite-revoke");
      const count = await revokeButtons.count();
      expect(count).toBe(0);
    }).toPass({ timeout: 10000 });
  });
});
