# TeamMeet Integration Engine Ramp Strategy

## Thesis

Teamworks' breadth is a strength, but its likely weakness is integration quality across products assembled over time. TeamMeet should not win by cloning every module. It should win by making the highest-frequency sports workflows feel native, connected, and obvious from day one.

The product promise:

> One source of truth, one task stream, and workflows that complete themselves across calendar, roster, forms, documents, payments, messages, and reporting.

## Strategic Wedge

Start with workflows where integration quality is the product, not a back-office detail:

1. Travel operations
2. Unified task center
3. Forms, documents, approvals, and audit trail
4. Event check-ins and attendance
5. Expenses, per diem, and wallet/payment status

These are already adjacent to TeamMeet's current surface area: members, calendar, schedules, events, forms, documents, notifications, expenses, wallet, parents, and admin approvals.

## The Core Engine

Build a shared workflow substrate instead of isolated features.

### Canonical Objects

Every future module should compose a small set of shared objects:

- `person`: athlete, staff, parent, alumni, prospect, tutor, vendor contact
- `group`: team, travel party, class cohort, staff group, parent group
- `event`: practice, game, trip segment, study hall, appointment, camp session
- `task`: assigned action with owner, due date, source object, status, reminders
- `form`: structured data capture, signatures, conditional fields, assignments
- `document`: file, generated letter, itinerary, receipt, waiver, policy
- `approval`: review state, actor, decision, notes, escalation, audit event
- `payment`: expense, per diem, reimbursement, donation, camp registration, payout
- `notification`: generated from state changes, not manually duplicated per module

The win is that new product areas do not invent new versions of these concepts.

### Workflow Contract

Every workflow should expose the same contract:

- trigger: what starts it
- participants: who is involved
- tasks: what each participant must do
- timeline: dates, reminders, escalation
- state: draft, active, blocked, complete, cancelled
- dependencies: forms before check-in, approval before payout, roster before travel party
- audit: who changed what and when
- surfaces: mobile, web admin, parent view, notification feed, calendar

If a feature cannot express itself through this contract, either the contract is incomplete or the feature is not a near-term priority.

## Ramp Plan

### Phase 1: Task Center Foundation

Goal: make TeamMeet feel less like separate modules.

Ship:

- `tasks` table with source object references
- task inbox on mobile and web
- due dates, assignees, status, completion
- notification hooks
- adapters from existing forms, mentorship tasks, event RSVPs/check-ins, approvals, workouts, and document requests

Success metric:

- An athlete can open TeamMeet and know exactly what needs attention without checking five tabs.

### Phase 2: Travel Workflow MVP

Goal: prove native integration against Teamworks' travel/Hub workflow.

Ship:

- create trip from calendar event
- travel party from roster groups
- itinerary segments: bus, flight, hotel, meal, meeting, game
- assigned forms/documents
- athlete RSVP/check-in
- parent-safe itinerary view
- per diem/expense/payment status placeholders
- admin dashboard for missing tasks

Success metric:

- A coach or ops staffer can run one away game without spreadsheets, group texts, or duplicate data entry.

### Phase 3: Approvals And Audit Layer

Goal: make compliance-lite native before building a full compliance product.

Ship:

- reusable approval routes
- audit timeline on workflow objects
- policy checks for missing forms, age/parent consent, roster membership, payment readiness
- exportable reports

Success metric:

- Staff can answer "who approved this, what was missing, and what changed?" from inside the workflow.

### Phase 4: Payments Connected To Operations

Goal: connect money to the operational thing it belongs to.

Ship:

- per diem requests from travel party
- expense submissions tied to trips/events
- payment status visible on trip dashboard
- Stripe/wallet status hooks
- reports by event, team, person, and category

Success metric:

- Ops staff can see travel readiness and payment readiness in one place.

### Phase 5: Expand Into Adjacent Verticals

Only after the engine works, add verticals that reuse it:

- academics: study hall, appointments, travel letters, faculty progress checks
- equipment: issue/return tasks, size profiles, inventory audit
- camps: registration, waivers, payments, attendance, recruiting pipeline
- recruiting: prospect tasks, boards, communication log, compliance checks
- performance: readiness tasks, workout completion, return-to-play visibility

## Product Principles

1. No standalone modules without task-center integration.
2. No duplicate person, group, event, or approval models.
3. Every workflow must have mobile-first participant views and admin-first command views.
4. Notifications should be generated from workflow state, not manually bolted on.
5. Parents and external participants get scoped views, not separate workflows.
6. Reporting should fall out of workflow state, not require a parallel reporting product.
7. Integrations should map into canonical objects, not leak third-party data models into the app.

## Positioning

Teamworks message:

> We have every product your department needs.

TeamMeet message:

> Your daily operations run in one connected workflow, from roster to calendar to task to form to approval to payment.

This is a quality-of-integration wedge. It is credible only if the first workflow feels dramatically cleaner than the incumbent process.

## First Demo Story

The first flagship demo should be:

> Run an away game from start to finish.

Demo sequence:

1. Create away game.
2. Generate travel party from varsity roster.
3. Add itinerary: bus, hotel, meal, game, return.
4. Assign waiver, meal choice, emergency contact confirmation.
5. Athlete sees three tasks in mobile inbox.
6. Parent sees approved itinerary details.
7. Coach sees who is missing forms and who checked in.
8. Ops marks per diem requested or paid.
9. Admin exports audit/report.

This story uses existing TeamMeet strengths and exposes the integration quality gap directly.
