import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const ROOT = "/Users/louisciccone/Desktop/TeamMeet";
const env = {};
for (const line of fs.readFileSync(`${ROOT}/.env.local`, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const BASE = "http://localhost:3000";
const ORG = "south-rock-ridge";
const EMAIL = "logan.doyle.s1@villanovademo.com";
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const url = `${BASE}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/${ORG}/members`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE-ERR:", m.text().slice(0, 200)); });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

await page.goto(`${BASE}/${ORG}/members`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
console.log("members URL:", page.url());
const html = await page.content();
console.log("html length:", html.length);
console.log("innerText len:", (await page.evaluate(() => document.body.innerText)).length);
console.log("innerText:", (await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n+/g, " | "));
console.log("nav links:", await page.evaluate(() => Array.from(document.querySelectorAll("nav a")).map(a=>a.textContent.trim()).slice(0,8)));
await page.screenshot({ path: "/tmp/debug-members.png", fullPage: false });
console.log("saved /tmp/debug-members.png");
await browser.close();
