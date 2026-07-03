# Incident Response Runbook

**Version:** 1.2
**Last Updated:** July 2, 2026
**Related tables:** `breach_incidents`, `data_access_log`, `compliance_audit_log`, `error_groups`, `error_events`
**Related docs:** `FERPA_COMPLIANCE.md` (STEP 7–8), `COPPA_COMPLIANCE.md` (DSR section), `legal_templates/K12_Data_Sharing_Agreement.md` (Section 9)

---

## 1. Detection Triggers

An incident investigation is triggered when any of the following occur:

- Supabase or Vercel alert for anomalous access patterns
- Dependabot/npm audit flags a critical vulnerability in a deployed dependency
- User reports unauthorized access or data exposure
- Audit log review reveals unexpected data access patterns
- Third-party notification (e.g., HaveIBeenPwned, security researcher)
- Failed authentication spike detected in error monitoring

---

## 2. Severity Classification

### Tier 1 — Critical
- Confirmed unauthorized access to education records
- Data exfiltration (any volume)
- Exposed credentials (API keys, database connection strings)
- Ransomware or destructive attack

### Tier 2 — High
- Vulnerability actively exploitable but no evidence of exploitation
- Unauthorized access to non-education PII (emails, names)
- Privilege escalation (user gained admin access)
- RLS policy bypass

### Tier 3 — Low
- Vulnerability discovered but not yet exploitable (requires additional conditions)
- Failed attack attempts (blocked by rate limiting, WAF)
- Misconfiguration with no data exposure

---

## 3. Notification Timelines

Per K-12 Data Sharing Agreement (Section 9) and NY Education Law 2-d:

| Notification | Deadline | Required By |
|---|---|---|
| Vendor → School District | **72 hours** from discovery | K-12 Agreement Section 9.1 |
| Vendor → NYS Education Department | **10 business days** from discovery | NY Education Law 2-d |
| Vendor → Affected Parents | **14 calendar days** from discovery | NY Education Law 2-d |

**Important:** Timelines begin at **discovery**, not at confirmation. When in doubt, start the clock.

---

## 4. Response Steps

### Step 1: Contain (0-4 hours)
1. Identify the attack vector and affected systems
2. Revoke compromised credentials immediately
3. If RLS bypass: add emergency deny-all policy on affected tables
4. If credential exposure: rotate all exposed keys in Vercel/Supabase dashboard
5. Document containment actions in `breach_incidents` table

### Step 2: Assess (4-24 hours)
1. Query affected tables to estimate record count:
   ```sql
   -- Example: check data_access_log for unusual patterns
   SELECT resource_type, COUNT(*) 
   FROM data_access_log 
   WHERE accessed_at > '[incident_start]' 
   GROUP BY resource_type;
   ```
2. Identify affected organizations and user counts
3. Classify severity tier (see Section 2)
4. Update `breach_incidents` row with assessment details

### Step 3: Notify (per timelines above)
1. **72 hours:** Email affected school district IT contacts
   - Include: nature of breach, data elements affected, containment status
   - Template: see Section 6
2. **10 business days:** File with NYSED
3. **14 calendar days:** Notify affected parents
   - Use Resend to send templated notification
   - Include: what happened, what data was involved, what we're doing about it
4. Update `breach_incidents` notification timestamps

### Step 4: Remediate
1. Deploy fix for the root cause
2. Verify fix with security review
3. Run `npm audit` to confirm no remaining critical vulnerabilities
4. Review and harden related code paths

### Step 5: Document
1. Update `breach_incidents.resolution_notes` with:
   - Root cause analysis
   - Timeline of events
   - Remediation actions taken
   - Preventive measures implemented
2. Set `resolved_at` timestamp
3. Conduct post-incident review within 7 days

---

## 5. Error-Tracking Pipeline (application errors)

The app runs a home-built error-tracking pipeline (`apps/web/src/lib/errors/`) that
fingerprints, groups, counts, and alert-emails on application errors. It is separate
from the breach/compliance tables above — use it to diagnose *operational* incidents
(500s, failing crons, AI-pipeline failures) by query rather than by scraping Vercel logs.

### 5.1 Where errors come from (coverage map)

Wired into the pipeline today:

- **API 5xx response helpers** — `internalError(err)` / `databaseError(err)` in
  `lib/api/response.ts` capture through the sanitization boundary when passed the caught error.
- **AI pipeline** — `aiLog("error", …)` in `lib/ai/logger.ts` forwards through the boundary.
- **Client React boundaries** — `app/error.tsx`, `app/[orgSlug]/error.tsx`, and the
  root `app/global-error.tsx` (via `lib/errors/client.ts`).
- **Bounded non-org routes** — account deletion (`api/user/delete-account`, all three
  handlers), the account-deletion cron (`api/cron/account-deletion`), and the org/enterprise
  Stripe checkout-creation routes (`api/stripe/create-org-checkout`,
  `create-org-v2-checkout`, `create-enterprise-checkout`) capture their unhandled
  failures. Response bodies and status codes are unchanged — capture is fire-and-forget.

Not yet wired (pending later workstreams):

- **Organizations routes** (`api/organizations/**`) — adopt the instrumented response
  helpers as they migrate onto the `lib/organizations` service layer (F1-orgs phases).
  Until then, their catch blocks log to Vercel only.
- The remaining ~150 non-org routes not in the bounded list above.

### 5.2 Querying error_groups / error_events

`error_groups` = one row per distinct error (deduped by `env` + `fingerprint`), carrying
rolling counters (`count_1h`, `count_24h`, `total_count`), `severity`, `status`
(`open` / `resolved` / `ignored` / `muted`), `first_seen_at` / `last_seen_at`, and a
`sample_event` jsonb. `error_events` = the individual occurrences (`message`, `stack`,
`route`, `api_path`, `user_id`, `session_id`, bounded `meta`) linked by `group_id`.

```sql
-- Top open error groups by last-hour volume (production)
SELECT id, title, severity, count_1h, count_24h, total_count, last_seen_at
FROM error_groups
WHERE env = 'production' AND status = 'open'
ORDER BY count_1h DESC, last_seen_at DESC
LIMIT 25;

-- Recent occurrences for a specific group (stack + sanitized meta)
SELECT created_at, route, api_path, user_id, message, meta
FROM error_events
WHERE group_id = '<group-uuid>'
ORDER BY created_at DESC
LIMIT 50;

-- Find a group by module (meta.module is set by the capture chokepoints,
-- e.g. 'api:stripe/create-org-checkout', 'api-response:internal_error')
SELECT g.title, g.count_1h, e.created_at, e.message
FROM error_events e
JOIN error_groups g ON g.id = e.group_id
WHERE e.meta->>'module' = 'api:cron/account-deletion'
  AND e.created_at > now() - interval '24 hours'
ORDER BY e.created_at DESC;

-- Silence a known/expected group so it stops alerting
UPDATE error_groups SET status = 'muted' WHERE id = '<group-uuid>';
```

Rolling counters (`count_1h` / `count_24h`) and per-group `baseline_rate_1h` /
`spike_threshold_1h` are maintained by the hourly `api/cron/error-baselines` cron —
if those columns look stale, check that cron first.

### 5.3 Alert semantics

Alerts email **`ADMIN_EMAIL`** (env var; defaults to `admin@myteamnetwork.com`) via Resend,
gated by `lib/errors/notify.ts`:

- **First occurrence** of a new group → one alert, then a **4-hour cooldown** before that
  group can alert again.
- **Spike** on an existing group → alert with a **2-hour cooldown**. A spike requires
  **both**: `count_1h` > **50** (the group's `spike_threshold_1h`, default 50) **and**
  `count_1h` > **2× baseline** (`baseline_rate_1h`), so a group with an established
  baseline does not alert on normal volume.
- No paging/SMS — email only. Absence of an email does **not** mean absence of errors;
  query `error_groups` directly when triaging.

### 5.4 Sanitization boundary — what does and does not reach rows + emails

All server-side captures pass through `lib/errors/sanitize.ts` before persistence, and the
alert email renders the `sample_event` — so the boundary bounds both the DB rows and the emails.

Guaranteed **bounded**:

- **Message** is collapsed to a single line and capped (~500 chars) — a payload embedded in
  an error message (JSON body, prompt, RAG chunk, LinkedIn/CSV import row) cannot flood the
  row or the alert email.
- **`meta`** is allowlisted to scalar identifiers only: `requestId`, `orgId`, `threadId`,
  `userId`, `module`, `errorName` (each string capped at 200 chars). A raw caught error, an
  arbitrary `aiLog` `extra` blob, request headers, or an auth token passed in context is
  **dropped**, never stored.
- **Recursion guard** — anything failing *inside* `lib/errors/*` or the error-ingest route
  logs to console only and never re-enters the pipeline.

**Not** redacted (be aware when handling rows during an incident):

- The full **stack trace** is stored on the `error_events` row (bounded for length, not
  content) and up to ~15 stack lines appear in the alert email. Treat stack contents as
  potentially sensitive; do not forward alert emails outside the incident team without review.
- `userId` (a UUID, not PII by itself) is stored when supplied.

### 5.5 Fast triage during an operational incident

1. Query 5.2's "top open error groups" for `env='production'` — the noisiest `count_1h`
   group is usually the incident.
2. Pull recent `error_events` for that group; read `meta->>'module'` to locate the code path
   and `stack` for the failing frame.
3. If it is a known/expected failure, `status='muted'` the group to stop alert noise.
4. If it is a real regression, follow Section 4 (Contain → Assess → …). If the error path
   involves education records or PII exposure, escalate to the breach workflow (Sections 2–4)
   — the error pipeline is diagnostic, not a substitute for breach handling.

## 6. Contact List Template

| Role | Name | Email | Phone |
|---|---|---|---|
| Incident Commander | [TBD] | | |
| Engineering Lead | [TBD] | | |
| Legal Counsel | [TBD] | | |
| District IT Contact | [Per agreement] | | |
| NYSED Contact | | privacy@nysed.gov | |
| Support Email | | mleonard@myteamnetwork.com | |

---

## 7. District Notification Template

Subject: Security Incident Notification — TeamNetwork

Dear [District IT Contact],

We are writing to notify you of a security incident affecting TeamNetwork, in accordance with our Data Sharing Agreement (Section 9) and NY Education Law 2-d.

**Discovery Date:** [DATE]
**Nature of Incident:** [DESCRIPTION]
**Data Elements Potentially Affected:** [LIST]
**Estimated Records Affected:** [COUNT]
**Current Status:** [Contained / Under Investigation / Resolved]

**Actions Taken:**
- [CONTAINMENT ACTIONS]
- [REMEDIATION STEPS]

A full incident report will follow within 10 business days.

If you have questions, please contact [INCIDENT COMMANDER] at [EMAIL].

Sincerely,
TeamNetwork Security Team
