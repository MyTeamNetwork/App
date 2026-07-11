import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();

// Desktop 1280
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page0:;
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.locator("#features").scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);

// Structure checks
const info = await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.textContent.trim());
  const segments = document.querySelectorAll(".showcase-segment").length;
  const chapters = Array.from(document.querySelectorAll(".showcase-chapter")).map((c) => c.textContent.trim());
  const roundedPill = Array.from(document.querySelectorAll(".showcase-tab")).some((t) => {
    const r = getComputedStyle(t).borderRadius;
    return r && parseFloat(r) > 50;
  });
  const videos = Array.from(document.querySelectorAll(".showcase video")).map((v) => ({
    paused: v.paused,
    src: (v.querySelector("source") || {}).src || "",
  }));
  return { tabs, segments, chapters, roundedPill, videoCount: videos.length, videos };
});
console.log(JSON.stringify(info, null, 2));

await page.locator("#features").screenshot({ path: "/tmp/verify-features-default.png" });

// Click the Matching tab → should swap device to the matching video
await page.getByRole("tab", { name: "Matching", exact: true }).click();
await page.waitForTimeout(2000);
await page.locator("#features").screenshot({ path: "/tmp/verify-features-matching.png" });
const afterClick = await page.evaluate(() => {
  const active = document.querySelector('[role="tab"][aria-selected="true"]');
  const playing = Array.from(document.querySelectorAll(".showcase video")).filter((v) => !v.paused).length;
  return { activeTab: active && active.textContent.trim(), playingVideos: playing };
});
console.log("after Matching click:", JSON.stringify(afterClick));
await ctx.close();

// Mobile 390 — no horizontal page scroll
const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await m.newPage();
await mp.goto(BASE, { waitUntil: "domcontentloaded" });
await mp.locator("#features").scrollIntoViewIfNeeded();
await mp.waitForTimeout(1000);
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("mobile horizontal overflow px:", overflow);
await mp.locator("#features").screenshot({ path: "/tmp/verify-features-mobile.png" });
await browser.close();
console.log("DONE");
