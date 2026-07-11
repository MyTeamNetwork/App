# Wearable Data Integration — Feasibility Memo

**Status:** Parked (feasibility confirmed, not prioritized)
**Date:** 2026-06-23
**Type:** Feasibility brief / Deep-product brainstorm
**Decision:** Green on engineering feasibility, red on near-term priority. Named wedge recorded for if/when it earns a slot.

---

## TL;DR

Pulling player health & performance metrics from Whoop, Garmin, and similar wearables into TeamNetwork is **technically straightforward**. The blocker is not engineering — it is that TeamNetwork has **no product surface where this data drives a decision**, and health data carries permanent compliance/carrying-cost. Recommendation: **do not build now**; if revisited, take the **athlete showcase/engagement wedge**, not coach performance monitoring.

---

## The question explored

"Is there a way we could integrate data from Whoop, Garmin, and other platforms to get player metrics into TeamNetwork?" Framed by the requester as a **feasibility exploration** — no committed user, persona, or decision yet.

## Context: where TeamNetwork stands today

TeamNetwork is a multi-tenant **networking / mentorship / membership** platform — alumni directories, communication, scheduling, payments, enterprise admin, mentorship matching. There is **no athletic-performance surface, no "active athlete in training" concept, and no coach-facing dashboard** anywhere in the product. (The only "biometric" code today is device Face ID lock — unrelated.) Wearable metrics would therefore be a **net-new product surface**, not an extension of an existing one.

---

## Feasibility verdict: GREEN (engineering)

Three viable access tiers. Recommended path is Tier 1 + Tier 2.

### Tier 1 — Aggregator API (recommended spine)
Do **not** integrate Whoop/Garmin directly. Use a unified aggregator that speaks to both (and Oura/Fitbit/Apple/Polar) behind one normalized schema, and crucially exposes Whoop's **proprietary Recovery/Strain scores** that raw device APIs and Apple Health do not. Sidesteps Garmin's partnership-approval gate entirely.

| Aggregator | Whoop | Garmin | Pricing | Notes |
|---|---|---|---|---|
| **Terra** (tryterra.co) | ✅ incl. proprietary scores | ✅ | ~$399–499/mo base; ~$0.80–1.00/active user at scale | Richest data, established track record |
| **Junction** (ex-Vital, tryvital.io) | ✅ | ✅ | ~$0.50/user/mo, ~$300/mo floor | Cheaper at low scale; verify rebrand before contracting |
| **Open Wearables** (OSS) | ✅ | ✅ | Free (self-host) / custom managed | Zero per-user cost if you own the ops/infra |

### Tier 2 — Apple Health / Health Connect via existing Expo app (free supplement)
TeamNetwork already ships a React Native mobile client. Whoop/Garmin both write raw signals (HR, HRV, sleep stages) into Apple Health / Health Connect; the app can read them with **no vendor approval**. Limits: mobile-only (no server/web read path), periodic not real-time sync, and **proprietary scores are not available** through this path. Good free fallback, not a primary spine.

### Tier 3 — Direct vendor APIs (defer)
- **Whoop:** self-serve to prototype; approval required past 10 users (opaque timeline). Free API; end user needs a Whoop membership.
- **Garmin Health API:** enterprise-gated, ~2-business-day approval. Standard HR/sleep/stress free; **HRV (beat-to-beat) carries an undisclosed commercial license fee**.
- Only worth it at roughly **10k+ connected users**, where aggregator per-user pricing crosses over.

---

## Why NOT now: priority verdict RED

1. **No home for the data.** A feature is data *plus a decision someone makes with it*. With no consuming surface, integrating wearables today is pure liability with no value.
2. **Opportunity cost.** The team is mid-flight on App Store review, mentorship matching, and donations — the actual core. Health data is one of the highest-overhead surfaces to add and shouldn't jump that queue.
3. **The obvious version is the wrong product.** Coach-facing performance monitoring (load/recovery/readiness) is a different company — the lane of Kitman Labs, Teamworks/Smartabase, Catapult, and Whoop's own team product. TeamNetwork has no sports-science credibility there. This is the "adjacent product we'd accidentally build instead, and it's the wrong one."

---

## The wedge for later: showcase/engagement, not monitoring

If/when this earns a slot, the aligned direction is **athlete showcase / engagement** — players opt in to surface their own metrics on their profile (streaks, highlights, recruiting/alumni showcase). Rationale:
- Leans on what TeamNetwork uniquely owns: the **org graph, profiles, alumni identity**.
- Opt-in and player-controlled = **lowest-liability shape** (no duty-of-care, no clinical interpretation).
- Reinforces the networking core instead of forking the product into sports-science.

Directions explicitly **out of scope / wrong identity** for TeamNetwork: coach performance-monitoring dashboards, injury-risk/readiness analytics, anything implying clinical or duty-of-care interpretation.

---

## Compliance baseline (applies whenever built)

- **HIPAA:** almost certainly **does not apply** — TeamNetwork is not a covered entity. (Revisit only if processing a healthcare provider's patient data on their behalf.)
- **FTC Health Breach Notification Rule (amended 2024):** **applies** to consumer health apps — 60-day breach notification to users + FTC. Build detection/notification in.
- **State health-privacy laws** (WA My Health My Data, CCPA/CPRA sensitive-data rules, growing 2024–25 wave): treat wearable health data as **sensitive in all states** — explicit consent, purpose limitation, revocation.
- **Illinois BIPA:** HR/HRV generally not biometric *identifiers*; relevant only if collecting face/fingerprint data.
- **Apple HealthKit App Store rules:** no advertising/data-broker use; Privacy Nutrition Label required; cannot request data types not actually used; server upload allowed if stated purpose matches actual use.

Minimum bar: per-user OAuth consent per source · privacy policy naming data types + processors (the aggregator) · breach-notification plan · no selling/ad use · CCPA deletion/opt-out flow.

---

## Open assumptions / unknowns

- No specific user, persona, or decision-maker has been identified — this memo deliberately does **not** invent one.
- Garmin HRV commercial license fee is undisclosed (negotiation required if HRV needed via direct API — avoided by using an aggregator).
- Aggregator pricing (Terra/Junction) verified as of mid-2026; re-confirm and re-check Junction rebrand before any contract.
- Whether wearable data meaningfully moves networking/engagement metrics is **unvalidated** — would need a real user signal before committing even to the showcase wedge.

---

## Recommended next step if revisited

Validate demand for the showcase wedge with a real org (e.g., the Villanova Football demo org has active players) before any build. If demand is real, run a full `/ce-brainstorm` on the showcase direction specifically, then `/ce-plan` with Terra/Junction + HealthKit as the settled integration layer.
