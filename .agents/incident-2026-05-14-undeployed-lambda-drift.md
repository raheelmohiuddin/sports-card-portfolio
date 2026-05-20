# INCIDENT 2026-05-14 — Undeployed Lambda drift (9cbf9cc → 52b4fe7)

> Retroactive incident write-up per [.agents/p0-hardening-session-a-plan.md §8 OQ-11](./p0-hardening-session-a-plan.md). Authored after Session A completed. Per [ENGINEERING_STANDARDS.md §4](./ENGINEERING_STANDARDS.md)'s hot-fix carve-out, this doc captures what shipped and the post-mortem; it is not a forward-looking plan.
>
> This is the first incident write-up on Collector's Reserve. As [INCIDENT_RESPONSE.md §4](./INCIDENT_RESPONSE.md) is currently TODO (its trigger fires on the first incident OR before the first non-Raheel user, whichever first), the 8-section structure here is intended to serve as the de facto template for §4 when it gets populated.
>
> **Update rule.** Once an incident doc lands, it freezes. Amend only to correct factual errors or to backfill cross-references to docs that didn't exist yet at the time of writing. Substantive changes (new lessons, additional action items) go in new commits with rationale.

This doc covers a Sev-3 advisory: a ~13-hour silent contract drift between the deployed backend Lambdas and the auto-deployed frontend, caused by a backend-touching commit that was committed to git but never `cdk deploy`'d. Discovered during P0 Hardening Session A's `cdk diff` gate; resolved via catchup-deploy. The originating write-up lives at [.agents/p0-hardening-session-a-plan.md §3.5](./p0-hardening-session-a-plan.md); this doc is the deliberate post-mortem.

---

## 1. Summary

Commit `9cbf9cc` (2026-05-13 21:24 UTC) renamed the JSON field `targetPrice` → `sellTargetPrice` across 5 backend Lambdas and 4 frontend files. The frontend was auto-deployed by Amplify on push within minutes. The backend `cdk deploy` was overlooked. For ~13 hours the deployed backend returned the old field name while the deployed frontend expected the new one. Drift was silent — no SQL error, no 5xx, no alarm, no user report — because the column-rename layer (`21ecab0`, see §4) had been correctly atomic, the frontend's permissive rendering hid the missing field, and traffic during the window was low.

Discovered 2026-05-14 ~10:00 UTC when `cdk diff` run before Session A's RDS backup retention deploy returned 5 unexpected Lambda S3Key updates alongside the expected RDS property change. Resolved within hours by deploying the already-committed code (anchored in git via `52b4fe7`, the empty catchup-deploy commit).

**Blast radius.** 55 invocations (53 + 2 reads, 0 writes) across 13 hours. Zero errors. Zero data loss. User-visible impact: missing `sellTargetPrice` field on card objects in the get-cards response → empty target-price displays in the Portfolio page until catchup-deploy landed.

**Follow-ups.** Catchup-deploy committed at `52b4fe7`. Drift-detection tooling parked in [ROADMAP.md](./ROADMAP.md) Tech debt (entry landed in `b6bd0a7`, P0 Hardening Session A Commit 6, Size M, ~3–4h). Anti-pattern entry for [ENGINEERING_STANDARDS.md §5](./ENGINEERING_STANDARDS.md) and verification-discipline reinforcement to §3 are pending in a follow-on commit (deliberately separated from this doc — see §7).

---

## 2. Severity

**Sev-3 advisory** per [INCIDENT_RESPONSE.md §1](./INCIDENT_RESPONSE.md)'s tier definitions.

IR §1 defines Sev-3 as "Anomalous pattern worth investigating but no operational urgency. Investigate during normal work cadence." This incident matches:

- No active service outage. Affected Lambdas continued returning 200 OK responses.
- No imminent data risk. The SQL column rename (handled atomically at `21ecab0`) ensured the underlying data layer was consistent; only the JSON alias layer carried the gap.
- No user-impacting capacity exhaustion.
- User-visible degradation was bounded: a single field's worth of UI elements rendered empty for ~55 invocations during a low-traffic window.

The classification would shift to Sev-2 (warning) if the missing field had blocked a user action, or to Sev-1 (critical) if it had caused write-path corruption. Neither occurred. The contributing factors that contained the blast radius (§5) were specific and not durable — under different circumstances (write-Lambda affected, higher traffic, frontend strict-mode rendering) the same root cause would produce a higher-severity incident. The severity reflects what happened, not what could have.

---

## 3. Timeline

All times in UTC. SHAs are short (7-char) per the doc-wide convention. The window of consequence — from `9cbf9cc`'s auto-deploy to catchup-deploy — was ~13 hours of live drift plus ~5 hours from discovery to formal anchoring.

| Time (UTC) | Event |
|---|---|
| **2026-05-13 20:32** | `21ecab0` lands: migration 0006 (`target_price` → `sell_target_price`) + backend SQL ref updates. Atomic per [ENGINEERING_STANDARDS.md §7](./ENGINEERING_STANDARDS.md) coordinated SQL + code deploy workflow. Deployed same day; live DB schema confirmed `sell_target_price` column only by 2026-05-14 discovery time. |
| **2026-05-13 21:24** | `9cbf9cc` lands: PA tab scaffolding + JSON field rename `targetPrice` → `sellTargetPrice` across 5 backend Lambdas (`cards/add-card.js`, `cards/get-card.js`, `cards/get-cards.js`, `cards/update-card.js`, `admin/get-card.js`) and 4 frontend files (`CardModal.jsx`, `Layout.jsx`, `PortfolioPage.jsx`, `services/api.js`). Stat: 9 files, 157 insertions, 59 deletions. Frontend auto-deploys via Amplify on push within minutes. **Backend `cdk deploy` not run.** |
| **2026-05-13 21:24 → 2026-05-14 ~10:00** | **Drift window** (~13 hours live). Deployed backend returns `targetPrice` (pre-`9cbf9cc` code); deployed frontend expects `sellTargetPrice`. Frontend's permissive missing-field rendering hides the gap from users. |
| **2026-05-14 ~10:00** | Drift discovered during P0 Hardening Session A's `cdk diff` gate (run before what was at that time Commit 1 — RDS backup retention). `cdk diff` returned 5 unexpected Lambda S3Key updates alongside the expected `BackupRetentionPeriod` property change. Operator traced the unexpected changes to `9cbf9cc` via `git log` of the affected Lambdas' directories. Live-state assessment via Data API confirmed DB schema had `sell_target_price` column only; CloudWatch `get-metric-statistics` confirmed 0 write-Lambda invocations and ~55 read-Lambda invocations during the window. |
| **2026-05-14 (~10:00 → 15:29)** | Catchup `cdk deploy` runs successfully. Smoke-test confirmed responses now include `sellTargetPrice` keys. Plan amendment (`64d45a9`) inserts the catchup-deploy as a new Commit 1 in Session A; existing commits renumbered 2–6. |
| **2026-05-14 15:29** | `52b4fe7` lands: empty git commit anchoring the already-completed catchup-deploy. No source changes; the deploy itself is the action being audit-trailed. |
| **2026-05-20** | P0 Hardening Session A Commit 6 (`b6bd0a7`) lands: ROADMAP.md gains "Git-vs-deployed Lambda source drift detection" Tech debt entry (Size M, ~3–4h) — this incident's evidence-base for parking the tooling. |
| (Pending) | ENGINEERING_STANDARDS.md §5 anti-pattern entry + §3 Verify-phase reinforcement (see §7). |

---

## 4. Root cause

**The split deploy paths.** This codebase has two production deploy paths:

- **Frontend** auto-deploys to Amplify on every push to `master`. No manual step.
- **Backend** deploys via explicit `cdk deploy`. Manual step. Documented in [ENGINEERING_STANDARDS.md §2](./ENGINEERING_STANDARDS.md) (Development environment) and [CONTEXT.md §11](./CONTEXT.md) (Workflow Notes — Deploy section).

Both paths share a single commit boundary — `master` is the only environment. A commit that touches both surfaces will, by default, deploy the frontend half automatically and leave the backend half waiting for someone to run `cdk deploy`. The two paths can desync indefinitely with no signal until the next `cdk deploy` runs against the stack.

**What actually happened at `9cbf9cc`.** The commit touched 5 backend Lambdas + 4 frontend files. Push landed on `master`; Amplify built and deployed the frontend within minutes. `cdk deploy` was not run. The backend Lambdas in S3 remained on the pre-`9cbf9cc` asset hash; the frontend was on the post-`9cbf9cc` bundle. The JSON field-name contract between the two layers diverged.

**Why the drift was silent.** The atomic SQL rename at `21ecab0` (column + backend SQL refs in one commit per [ENGINEERING_STANDARDS.md §7](./ENGINEERING_STANDARDS.md)) had correctly contained the schema layer — deployed Lambdas SELECT'd `sell_target_price` from the renamed column without error. The drift introduced at `9cbf9cc` was orthogonal: a follow-on JSON-alias-layer rename that didn't touch the schema, didn't break SQL, and only diverged the response field name. No SQL error path could fire. No 5xx could surface. Frontend's permissive missing-field rendering (a property of React, not of any explicit decision here) returned `undefined` for the missing field and rendered empty UI elements — visible only to a user who knew to look for the target-price display.

**The discipline that was followed, and the discipline that wasn't.**

- **Followed: atomic-flip discipline at `21ecab0` worked correctly.** SQL rename + backend SQL ref updates landed in the same commit and deployed together. This is not where the gap was. [ENGINEERING_STANDARDS.md §7](./ENGINEERING_STANDARDS.md)'s coordinated SQL + code deploy workflow was followed and held.
- **Not followed: deploy-on-every-backend-touching-commit discipline.** `9cbf9cc` was a follow-on backend change after the schema work landed cleanly. The commit landed and pushed; the implicit "now run `cdk deploy`" was missed. There is no written rule against this in [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) — the assumption was that every backend-touching commit triggers a manual `cdk deploy` automatically as a habit. That assumption proved wrong once.

The single-sentence root cause: **a backend-touching commit landed in `master` without an accompanying `cdk deploy`, and the codebase had no mechanism — procedural or automated — to surface the gap before the next unrelated `cdk diff` happened to expose it.**

---

## 5. Contributing factors

Factors that shaped how the drift surfaced, persisted, and was caught. Listed as factors, not as blame.

### 5.1 — Frontend's missing-field rendering hid the gap

React renders `undefined` props as empty rather than throwing. The target-price displays simply vanished from the UI; no exception, no console error, no error boundary trip. Strict-mode rendering or PropTypes warnings would have surfaced the discrepancy at runtime; neither was active on the affected components.

### 5.2 — The schema layer's atomic discipline contained the SQL surface

`21ecab0` shipped column rename + backend SQL refs together. Had it not — had the column been renamed without updating the Lambdas' SQL — every affected Lambda would have errored with `column "target_price" does not exist`, every CloudWatch log group would have shown errors, and the drift would have surfaced within the first invocation. The atomic SQL discipline that protected against the schema-level failure mode is the same discipline that made the JSON-alias-level drift silent: by removing every other failure mode, only the silent one remained. This is a feature, not a bug — the alternative was a noisier failure on a different surface. But it does mean that when atomic SQL discipline holds, the next-most-likely failure mode is whatever isn't covered by it.

### 5.3 — Low traffic during the window

Single-operator system, off-hours timing (21:24 UTC = 17:24 ET, a weekday evening), ~55 read invocations across 13 hours. A multi-user system with continuous traffic would have produced thousands of invocations against the bad field name within minutes. The current scale acted as natural rate-limiting on the blast radius; the contributing factor will weaken as the user base grows. This is the strongest argument for landing the drift-detection tooling parked in ROADMAP before the first non-Raheel user.

### 5.4 — No monitoring for git-vs-deployed drift

CloudWatch alarms (added in P0 Hardening Session A Commit 3) cover Lambda errors, throttles, RDS capacity, and API Gateway latency. None of them fire on the asymmetry between git master's source code and the deployed Lambda asset hash. Parked tech-debt in [ROADMAP.md](./ROADMAP.md) under "Git-vs-deployed Lambda source drift detection" (Size M, ~3–4h). Landed in commit `b6bd0a7`.

### 5.5 — What caught it: discipline applied to a tool, not the tool alone

The `cdk diff` command is always available; running it is a habit, not a forced gate. Catching this drift required (a) running `cdk diff` before deploy — a habit codified in [ENGINEERING_STANDARDS.md §3](./ENGINEERING_STANDARDS.md) (Execute phase), (b) recognizing unexpected scope in the diff output rather than treating non-target resources as noise, and (c) tracing the unexpected resources back via `git log` to identify what they belonged to. The tool is necessary but not sufficient; the recognition habit is what closed the loop.

The codebase already codifies one slice of this recognition habit at [ENGINEERING_STANDARDS.md §5 pattern 8](./ENGINEERING_STANDARDS.md) — distrusting `cdk diff`'s display layer enough to verify scope via `aws cloudformation describe-change-set`. Pattern 8 was added during the Node 22 LTS upgrade after a related-but-distinct slip (`cdk diff` under-reporting an intended deploy). This incident reinforces the same habit category at a different layer: **the diff output is a starting point for investigation, not a conclusion.** Whether the question is "is the displayed scope complete?" (§5 pattern 8) or "is the displayed scope expected?" (this incident), the discipline is the same — read every line, trace every unexpected one, don't proceed with deploy until each line is accounted for.

### 5.6 — Future controls that would shorten the drift window for similar incidents

Forward-looking, not hindsight-shaped. Three independent layers:

| Layer | Control | Where it lives |
|---|---|---|
| Procedural | Codify "every backend-touching commit requires `cdk deploy` before the next commit lands" as an explicit rule in [ENGINEERING_STANDARDS.md §5](./ENGINEERING_STANDARDS.md) anti-patterns (proposed §5.9; see §7). | Doc-only; relies on operator habit. |
| Procedural | Reinforce [ENGINEERING_STANDARDS.md §3](./ENGINEERING_STANDARDS.md) (Verify phase) with a project-specific bullet: "After pushing a backend-touching commit, run `cdk diff` and confirm zero pending changes for production-affecting resources." | Doc-only; the gate is operator-run. |
| Tooling | The drift-detection tooling parked in ROADMAP — automated comparison of `git log` per Lambda directory against deployed S3Key asset hashes. | Automation; survives operator lapses. |

The three layers are complementary. Procedural controls are cheap and ship immediately; tooling is durable and ships when the trigger fires. Neither alone is sufficient — procedural controls erode in single-operator systems (no second pair of eyes to enforce the habit), tooling needs the procedural foundation to interpret what "drift" means in context.

---

## 6. Blast radius

Quantified per [§3.5 of the plan](./p0-hardening-session-a-plan.md); reproduced here verbatim and expanded.

### Quantitative

| Metric | Value |
|---|---|
| Drift window | ~13 hours (2026-05-13 21:24 UTC → 2026-05-14 ~10:00 UTC) |
| Affected Lambdas | 5 (`cards/add-card.js`, `cards/get-card.js`, `cards/get-cards.js`, `cards/update-card.js`, `admin/get-card.js`) |
| Write invocations during window | 0 (add-card 0, update-card 0, admin-card 0) |
| Read invocations during window | 55 (get-cards 53, get-card 2) |
| 5xx errors attributable to drift | 0 |
| 4xx errors attributable to drift | 0 |
| SQL errors | 0 |
| Data loss | 0 |
| Data corruption | 0 |
| Alarm fires | 0 |
| User reports | 0 |

Invocation counts sourced from `aws cloudwatch get-metric-statistics` during the 2026-05-14 discovery investigation, scoped to the affected function names.

### Qualitative — user impact

The 55 read invocations returned card objects without the `sellTargetPrice` field. UI elements depending on it — the target-price display in the card detail view, the target-reached badge, the sell-target value in the EditCostModal — rendered empty rather than failed. Users (operator only, given the single-operator scale) would have observed missing target-price values on cards. No interaction was blocked; no other UI state was corrupted.

### Qualitative — system impact

None. The DB schema was correct (`21ecab0` had landed atomically). No SQL queries failed. No Lambda invocations errored. No state was written to the DB during the window (0 write invocations). No CloudWatch logs surfaced relevant errors.

### Qualitative — recovery cost

Single `cdk deploy` invocation. No data backfill needed. No user notification needed (no user other than the operator was affected). No rollback. The recovery path was the path that should have run at 21:24 the previous evening.

---

## 7. Action items

Concrete, time-bound. Distinct from §8 (which is durable / categorical). Each item names a responsible artifact, a status, and a SHA where applicable. Action items are how blameless review captures responsibility for fixes — the blameless framing applies to root-cause analysis (§4) and contributing-factor analysis (§5), not to the closing of action items.

### Immediate (done)

| # | Action | Status | SHA |
|---|---|---|---|
| AI-1 | Catchup-deploy the pre-`9cbf9cc` → `9cbf9cc` Lambda code via explicit `cdk deploy`. Smoke-test affected Lambdas to confirm `sellTargetPrice` field present in responses. | ✅ Done 2026-05-14 | `52b4fe7` (empty commit anchoring the deploy) |
| AI-2 | Park drift-detection tooling in [ROADMAP.md](./ROADMAP.md) Tech debt with trigger conditions and sizing. | ✅ Done 2026-05-20 | `b6bd0a7` (P0 Hardening Session A Commit 6) |
| AI-3 | Write this incident doc per [.agents/p0-hardening-session-a-plan.md §8 OQ-11](./p0-hardening-session-a-plan.md). | ✅ Lands with this commit | — |

### Follow-on (separate commit, not bundled with this doc)

| # | Action | Status | Notes |
|---|---|---|---|
| AI-4 | Add anti-pattern entry to [ENGINEERING_STANDARDS.md §5](./ENGINEERING_STANDARDS.md) — working title "Frontend auto-deploys; backend doesn't" — citing this incident as evidence. | Pending | Deliberately separated from this doc per the evidence-ships-first discipline. The anti-pattern is the generalization; the incident doc is the evidence base. Bundling them obscures the evidence-vs-rule distinction. |
| AI-5 | Reinforce [ENGINEERING_STANDARDS.md §3](./ENGINEERING_STANDARDS.md) (Verify phase) project-specific list with a bullet: "After pushing a backend-touching commit, run `cdk diff` and confirm zero pending changes for production-affecting resources." | Pending | Same evidence base as AI-4; bundled with AI-4 in the same commit. |

### Parked (long-running)

| # | Action | Status | Where parked |
|---|---|---|---|
| AI-6 | Build automated git-vs-deployed Lambda source drift detection. | Parked | [ROADMAP.md](./ROADMAP.md) Tech debt — landed in `b6bd0a7`. Trigger: earliest of (a) CI/CD pipeline build, (b) first non-Raheel user. Size: M (~3–4 hours). |

---

## 8. Pattern recognition

Durable, categorical. Distinct from §7 (which is concrete and time-bound). What does this incident teach about the system that survives beyond the specific fix?

### What category of incident this represents

This is the codebase's first **deploy-hygiene drift** incident. The existing anti-patterns catalogued in [ENGINEERING_STANDARDS.md §5](./ENGINEERING_STANDARDS.md) cover code-correctness drift (§5.1 cross-Lambda divergence, §5.4 precedence in cross-table aggregations, §5.5 ON CONFLICT predicates), schema discipline (§5.3 direct-to-DB changes), and convention compliance (§5.7 cross-session decay, §5.8 `cdk diff` display under-reporting). None of them name the specific failure mode here: **code committed to git but not deployed**. That's a new category. Adding it to §5 (AI-4) extends the catalog along a dimension it didn't previously cover.

### Why "blameless" doesn't mean "no one is responsible for the fix"

The blameless framing applies to root-cause analysis. §4's analysis names the system gap (split deploy paths with no automated drift detection); it does not name the operator who missed the `cdk deploy`. That's the discipline.

§7 captures responsibility for fixes. Action items name artifacts, owners, and SHAs. There is nothing soft about action-item ownership; the blamelessness sits one level up from the work itself, in the framing of WHY the gap was possible in the first place.

The two halves are complementary. A blameless analysis that doesn't close action items is incomplete (the lesson is documented but the system remains unchanged). An action-item list that doesn't sit on a blameless analysis tends to over-index on individual diligence and under-index on durable system changes (the operator commits to "be more careful next time," which doesn't survive the next single-operator slip). Doing both keeps the analysis honest and the fixes concrete.

### The tool-vs-discipline distinction

The drift was caught by `cdk diff`. But `cdk diff` is always available; it is the discipline of (a) running it before every deploy, (b) reading the unexpected lines rather than treating them as noise, and (c) tracing each unexpected resource back to its originating commit that closed the loop. Without that discipline, `cdk diff` would have run, displayed 5 unexpected Lambda updates next to the intended `BackupRetentionPeriod` change, and the operator would have proceeded with deploy — the unexpected updates absorbed into the deploy as collateral, undocumented, with no triage. The same drift would have been "fixed" silently, the contributing causes never surfaced, and the post-mortem this doc represents would never have been written.

This generalizes. Every diff-shaped tool in the workflow (`git diff`, `cdk diff`, `aws cloudformation describe-change-set`, `terraform plan` if it existed) is a tool whose value is conditional on the operator reading every line and accounting for every unexpected one. The tool can be improved (Pattern 8 added `describe-change-set` as a more authoritative source than `cdk diff`'s display layer); the discipline of reading-and-accounting cannot be replaced by a better tool, only supplemented.

### What this means for the path to the first non-Raheel user

Three of the contributing factors in §5 weaken as the user base grows. Low traffic (5.3) becomes high traffic; single-operator habit (5.5) becomes shared-team coordination; the natural rate-limiting that bounded blast radius this time disappears. Two of the contributing factors are durable — the silent failure mode (5.1, 5.2) doesn't change with scale. The combination means: the same root cause, at higher scale, produces a higher-severity incident. The drift-detection tooling (AI-6) sits in ROADMAP with explicit "before first non-Raheel user" as one of its triggers; this is the categorical reason why.

### The retroactive-plan pattern, exercised

[ENGINEERING_STANDARDS.md §4](./ENGINEERING_STANDARDS.md) (Plan documents) carves out hot-fix retroactive plan docs as a distinct category: "fix first; once the bleeding stops, write a retroactive `<feature>-plan.md` capturing what shipped and the post-mortem." [.agents/p0-hardening-session-a-plan.md §8 OQ-11](./p0-hardening-session-a-plan.md) chose this carve-out (option B) rather than expanding [INCIDENT_RESPONSE.md §1](./INCIDENT_RESPONSE.md) with a case-study (option A), keeping IR §1 scoped to severity classification + alarm-to-response wiring only. This doc is the first exercise of that retroactive-plan pattern on the codebase.

The structure here — severity → timeline → root cause → contributing factors → blast radius → action items → pattern recognition — is intended to serve as the de facto template for [INCIDENT_RESPONSE.md §4](./INCIDENT_RESPONSE.md) (Post-incident review) when that section's trigger fires. The §4 stub's anticipated content (post-mortem template, blameless review conventions, action-item tracking, pattern recognition) maps cleanly onto §§3–8 of this doc. Future incidents that warrant a similar write-up can copy this file's structure; the IR §4 commit will codify the structure once written.

---

## Cross-references

- **Origin write-up.** [.agents/p0-hardening-session-a-plan.md §3.5](./p0-hardening-session-a-plan.md) — the in-plan record of the discovery.
- **OQ-11 lock.** [.agents/p0-hardening-session-a-plan.md §8 OQ-11](./p0-hardening-session-a-plan.md) — the decision to write this doc retroactively after Session A completed.
- **Severity tier source.** [INCIDENT_RESPONSE.md §1](./INCIDENT_RESPONSE.md) — Sev-3 classification rationale.
- **Architectural context for affected Lambdas.** [CONTEXT.md §1](./CONTEXT.md) (Purpose) and [§2](./CONTEXT.md) (Architecture Overview). File inventory at [§4](./CONTEXT.md) (Backend File Inventory).
- **Retroactive-plan carve-out.** [ENGINEERING_STANDARDS.md §4](./ENGINEERING_STANDARDS.md) — hot-fix retroactive plan-doc pattern.
- **Anti-pattern catalog.** [ENGINEERING_STANDARDS.md §5](./ENGINEERING_STANDARDS.md) — pending entry for split-deploy-path drift (AI-4).
- **Verify-phase discipline.** [ENGINEERING_STANDARDS.md §3](./ENGINEERING_STANDARDS.md) — pending reinforcement bullet (AI-5).
- **Coordinated SQL + code deploy workflow.** [ENGINEERING_STANDARDS.md §7](./ENGINEERING_STANDARDS.md) — the discipline that held at `21ecab0`.
- **Parked drift-detection tooling.** [ROADMAP.md](./ROADMAP.md) Tech debt — "Git-vs-deployed Lambda source drift detection" (landed in `b6bd0a7`).
- **Commits cited.** `21ecab0` (atomic SQL rename, deployed same day), `9cbf9cc` (JSON field rename + PA scaffolding, frontend-only deploy), `52b4fe7` (empty commit anchoring catchup-deploy), `64d45a9` (plan amendment inserting catchup-deploy commit), `b6bd0a7` (ROADMAP Tech debt entry + CONTEXT.md alarm inventory).

---

*Doc complete — see [ENGINEERING_STANDARDS.md §13](./ENGINEERING_STANDARDS.md) for the evolution rules that govern amendments.*
