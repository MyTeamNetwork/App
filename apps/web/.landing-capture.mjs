// TEMP capture script (deleted after run). Logs in as the seed persona Logan
// Doyle via service-role magic-link, captures crisp 2x stills + two AI videos,
// all seed-only. Run from apps/web so playwright + supabase-js resolve.
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/louisciccone/Desktop/TeamMeet";
const env = {};
for (const line of fs.readFileSync(`${ROOT}/.env.local`, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = "http://localhost:3000";
const ORG = "south-rock-ridge";
const EMAIL = "logan.doyle.s1@villanovademo.com";
const OUT = "/tmp/landing-caps";
const PROFILE_ID = "da3bed4a-df0a-4f73-9f92-6889be340c91"; // Aiden Powell
const DISCUSSION_ID = "e7c037c3-7f21-4416-9e59-bb9d8b56bd56"; // finance mentor thread
const MAYA_ID = "3fd1fbad-9ecc-4d69-b29a-810ffa33d8a0"; // mentee for pairing
const THREAD_SNIPPET = "Compare the best mentor options for Brooke";

// Real (non-seed) people connected to the org → cosmetically replaced in the
// DOM before every screenshot so no real identity appears (chat lists, etc.).
const REAL_NAMES = {
  "Adrian Montemayor": "Jordan Avery",
  "Alex Gonzalez": "Marcus Hale",
  "Andy Falletta": "Devin Brooks",
  "Anthony C": "Chris Monroe",
  "Elena Torres": "Riley Quinn",
  "Frank Ciccone": "Owen Parker",
  "Jack McKillop": "Cole Bennett",
  "Josh Johnson": "Tyler Reed",
  "Lenny Annunziata": "Marco Bellini",
  "Louis Ciccone": "Ethan Cole",
  "Matt Leonard": "Drew Foster",
  "Matthew McKillop": "Aaron Wells",
  "Michael Keoleian": "Nathan Pierce",
  "Patrick Leonard": "Sean Walker",
  "Rupert McShary": "Henry Dalton",
  "Tom McKillop": "Liam Carter",
};

fs.mkdirSync(OUT, { recursive: true });

const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supa.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
if (error) throw error;
const confirmUrl = `${BASE}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/${ORG}/members`;

async function clean(p) {
  await p.evaluate((realNames) => {
    const kill = (el) => el && (el.style.display = "none");
    document
      .querySelectorAll("nextjs-portal,[data-nextjs-toast],#__next-build-watcher")
      .forEach(kill);
    document.querySelectorAll("button,a").forEach((b) => {
      const t = (b.getAttribute("aria-label") || "") + " " + (b.textContent || "");
      if (/dev panel|open ai assistant|open assistant|toggle theme/i.test(t)) kill(b);
    });
    // Hide the docked AI panel + its edge tab if present (belt-and-suspenders).
    document.querySelectorAll(".ai-panel-enter").forEach(kill);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRes = Object.entries(realNames).map(([from, to]) => [
      new RegExp("\\b" + esc(from) + "\\b", "g"),
      to,
    ]);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      let v = n.nodeValue;
      if (!v) continue;
      if (/villanova/i.test(v)) {
        v = v.replace(/villanovademo\.com/gi, "southridgehs.org").replace(/villanova/gi, "Southridge");
      }
      for (const [re, to] of nameRes) v = v.replace(re, to);
      if (v !== n.nodeValue) n.nodeValue = v;
    }
  }, REAL_NAMES);
}

const browser = await chromium.launch();
let state;
try {
  // ── Login + 2x stills ────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
  ctx.setDefaultNavigationTimeout(90000);
  const page = await ctx.newPage();
  await page.goto(confirmUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  // Keep the docked AI assistant panel collapsed everywhere (admins default-open).
  await page.evaluate(() => localStorage.setItem("ai-panel-preference", "closed"));
  state = await ctx.storageState();

  const shot = async (name) =>
    page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: 1440, height: 810 } });

  // STILL_ONLY=<name> captures just that one still (skips the rest + videos) for
  // fast single-screenshot re-captures.
  const ONLY = process.env.STILL_ONLY;
  const still = async (name, url, after) => {
    if (ONLY && name !== ONLY) return;
    await page.goto(BASE + url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1600);
    if (after) await after();
    await clean(page);
    await page.waitForTimeout(300);
    await shot(name);
    console.log("still", name);
  };

  if (!process.env.VIDEO_ONLY) {
    await still("directory", `/${ORG}/members`);
    await still("profile", `/${ORG}/members/${PROFILE_ID}`);
    await still("records", `/${ORG}/records`);
    // The demo org's June 2026 calendar has an off-brand synced "RÜFÜS DU SOL"
    // concert plus a sparse/cluttered month. Rewrite the month grid's event chips
    // (cosmetic, capture-time only — the DB is untouched) with a clean, believable
    // spread of summer team events so the screenshot reads well in production. Chip
    // markup mirrors CalendarMonthView.tsx exactly so it's pixel-identical.
    await still("calendar", `/${ORG}/calendar`, async () => {
      await page.evaluate(() => {
        // This org's theme: primary = black, secondary = green. Group by type:
        // training = green, game = black, community = blue accent.
        const EVENTS = [
          { day: 2, title: "Summer Lifting", variant: "training" },
          { day: 4, title: "7v7 Practice", variant: "training" },
          { day: 6, title: "Scrimmage vs. Riverside", variant: "game" },
          { day: 10, title: "Captains' Meeting", variant: "training" },
          { day: 12, title: "vs. Lincoln (Away)", variant: "game" },
          { day: 15, title: "Film Session", variant: "training" },
          { day: 19, title: "vs. Westfield (Home)", variant: "game" },
          { day: 23, title: "Alumni Game", variant: "game" },
          { day: 25, title: "Community 5K Fundraiser", variant: "community" },
          { day: 27, title: "Team Banquet", variant: "community" },
        ];
        const COLORS = {
          training: "bg-org-secondary text-org-secondary-foreground",
          game: "bg-org-primary text-org-primary-foreground",
          community: "bg-blue-500 text-white",
        };

        // The month grid is the 7-col grid with the full 42 day cells (not the
        // 7-cell weekday header).
        const grid = Array.from(document.querySelectorAll(".grid.grid-cols-7")).find(
          (g) => g.children.length >= 28,
        );
        if (!grid) {
          console.warn("calendar: month grid not found");
          return;
        }

        // Map in-month day number → its chip container (cell's 2nd child div). A
        // cell is in-month when its date-number span isn't muted.
        const byDay = new Map();
        for (const cell of Array.from(grid.children)) {
          const span = cell.querySelector("span");
          if (!span) continue;
          const inMonth = !span.className.includes("text-muted-foreground/35");
          const container = cell.children[1];
          if (container) container.innerHTML = ""; // clear concert + clutter + dots
          if (inMonth && container) {
            const n = parseInt(span.textContent.trim(), 10);
            if (!Number.isNaN(n)) byDay.set(n, container);
          }
        }

        for (const ev of EVENTS) {
          const container = byDay.get(ev.day);
          if (!container) continue;
          const el = document.createElement("div");
          el.className = `hidden sm:block text-xs font-medium px-1.5 py-0.5 rounded truncate leading-tight border border-foreground/10 ${COLORS[ev.variant]}`;
          el.textContent = ev.title;
          container.appendChild(el);
        }
      });
    });
    // The seeded replies on this thread are pre-game-meal advice that doesn't
    // answer the finance-mentor question. Overwrite the reply bodies (cosmetic,
    // capture-time only — the DB is untouched) with copy that actually answers it
    // and reinforces the directory → assistant → mentorship story. We target the
    // last N `p.whitespace-pre-wrap` (the reply bubbles, in ascending order; the
    // first such paragraph is the thread's question body).
    await still("messages", `/${ORG}/discussions/${DISCUSSION_ID}`, async () => {
      await page.evaluate(() => {
        const replies = [
          "Start with Priya Nair '14 — she's a VP at Goldman Sachs and mentors every year. Great first call.",
          "Marcus Bell at Citadel ran mock interviews with me last spring. Tell him I sent you.",
          "Filter the alumni directory by Finance, then ask the assistant to rank the best mentors for you.",
        ];
        const ps = Array.from(document.querySelectorAll("p.whitespace-pre-wrap"));
        const targets = ps.slice(-replies.length);
        if (targets.length !== replies.length) {
          console.warn(`messages: expected ${replies.length} reply paragraphs, found ${targets.length}`);
        }
        targets.forEach((p, i) => {
          p.textContent = replies[i];
        });
      });
    });
    await still("jobs", `/${ORG}/jobs`);

    // assistant poster: open Logan's thread
    await still("assistant", `/${ORG}/assistant`, async () => {
      await clean(page);
      await page.getByText(THREAD_SNIPPET, { exact: false }).first().click();
      await page.waitForTimeout(2000);
    });

    // matching poster: select Maya → wait for live candidate cards to rank in
    await still("matching", `/${ORG}/mentorship/admin/pairing`, async () => {
      await page.selectOption("#mentee-select", MAYA_ID);
      await page
        .getByText("Match score", { exact: false })
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
    });
  }

  await ctx.close();

  // STILL_ONLY runs skip the (slow, API-hitting) video captures entirely.
  const SKIP_VIDEOS = !!process.env.STILL_ONLY;

  // ── Videos (separate contexts, reuse session) ────────────────────────────
  const recordCtx = async () =>
    browser.newContext({
      viewport: { width: 1440, height: 810 },
      storageState: state,
      recordVideo: { dir: OUT, size: { width: 1440, height: 810 } },
    });

  const gentleScroll = async (p, x, y, downSteps) => {
    await p.mouse.move(x, y);
    for (let i = 0; i < downSteps; i++) {
      await p.mouse.wheel(0, 90);
      await p.waitForTimeout(360);
    }
    await p.waitForTimeout(700);
    for (let i = 0; i < downSteps; i++) {
      await p.mouse.wheel(0, -90);
      await p.waitForTimeout(300);
    }
  };

  // assistant video — open Logan's thread, wait for the answer, then scroll it.
  if (!SKIP_VIDEOS) {
    const vctx = await recordCtx();
    vctx.setDefaultNavigationTimeout(90000);
    const p = await vctx.newPage();
    await p.goto(BASE + `/${ORG}/assistant`, { waitUntil: "networkidle" });
    await p.waitForTimeout(2500);
    await clean(p);
    const respP = p
      .waitForResponse((r) => /\/api\/ai\/.+\/threads\/.+\/messages/.test(r.url()), { timeout: 25000 })
      .catch(() => null);
    await p.getByText(THREAD_SNIPPET, { exact: false }).first().click();
    await respP;
    await p.getByText("Top mentors for Brooke", { exact: false }).first().waitFor({ timeout: 15000 });
    await p.waitForTimeout(1400);
    await clean(p);
    await gentleScroll(p, 950, 430, 11);
    await p.waitForTimeout(800);
    const v = p.video();
    await vctx.close();
    fs.renameSync(await v.path(), path.join(OUT, "assistant.raw.webm"));
    console.log("video assistant");
  }

  // matching video — select Maya, wait for candidates API + cards, then scroll.
  if (!SKIP_VIDEOS) {
    const vctx = await recordCtx();
    vctx.setDefaultNavigationTimeout(90000);
    const p = await vctx.newPage();
    await p.goto(BASE + `/${ORG}/mentorship/admin/pairing`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1800);
    await clean(p);
    const respP = p
      .waitForResponse((r) => r.url().includes("/mentorship/admin/candidates"), { timeout: 30000 })
      .catch(() => null);
    await p.selectOption("#mentee-select", MAYA_ID);
    await respP;
    await p.getByText("Match score", { exact: false }).first().waitFor({ timeout: 15000 });
    await p.waitForTimeout(1400);
    await clean(p);
    await gentleScroll(p, 950, 470, 9);
    await p.waitForTimeout(800);
    const v = p.video();
    await vctx.close();
    fs.renameSync(await v.path(), path.join(OUT, "matching.raw.webm"));
    console.log("video matching");
  }
} finally {
  await browser.close();
}
console.log("DONE");
