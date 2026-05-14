# Collector's Reserve — Engineering Standards

> The "how we work" spine. Conventions for workflow, commits, schema
> changes, verification, debugging, review — the things that have already
> been decided so they don't need to be re-decided per task.

---

## 0. Preamble

This doc captures Collector's Reserve's engineering standards. Read it
once on day one. Reread the relevant section when a task feels off — a
commit message looks wrong, a schema change needs coordination, a
debugging session is dragging. The point is to remove decisions that
have already been made.

**Audience.** Both future Claude Code sessions and future human
contributors. Where a rule applies to one and not the other, the rule
says so.

**Scope boundaries.** Not architecture (that's `CONTEXT.md`). Not
abstract methodology (that's `methodology/`). Not feature scope (that's
the plan docs in `.agents/*-plan.md`). This doc is the "how we work"
spine — workflow, commits, schema-change protocol, verification
discipline. Surface-specific conventions (backend, frontend,
infrastructure, testing, operations, incident response) live in their
own docs and are listed in §12; some don't exist yet.

**What it isn't.** Not a checklist for every commit. Not a substitute
for thinking. Not exhaustive. If a situation isn't covered, follow the
spirit and flag the gap for §13 (Standards evolution).

**Update rule (one line).** Amend this doc in the same commit as any
change that breaks one of its rules, or that establishes a new
convention worth codifying. See §13 for the full procedure.

---

## 1. Project context

This doc deliberately does not describe the architecture, file layout,
schema, or current code surface. Those facts live in `CONTEXT.md`:

- **§2 Architecture Overview** — stack, services, AWS resource IDs
- **§3 Frontend File Inventory** — every `frontend/src/` file with purpose
- **§4 Backend File Inventory** — every Lambda + helper module
- **§5 Helper API Surface** — exported signatures from `_db.js`, `_validate.js`, etc.
- **§8 Database Schema (live)** — table definitions and column meanings

**The split.** `CONTEXT.md` answers "what exists." This doc answers
"how we work." If you're searching for a Lambda's response shape, that's
`CONTEXT.md`. If you're searching for the convention on commit messages,
that's here.

**When in doubt.** Ask: "would this fact change if a file was renamed
or a column added?" Yes → it belongs in `CONTEXT.md`. No → it belongs
in this doc.

---

## 2. Development environment

**Prerequisites.** Node 20.x, npm, AWS CLI v2 (configured with
`us-east-1` as default region), git. Windows / macOS / Linux all
work — see "Windows quirks" below.

**Bootstrap.** Clone, then `npm ci` from the root. The repo is an npm
workspace; one install bootstraps `frontend/`, `backend/`, and
`infrastructure/`. Do not `npm install` inside sub-directories — it
splits the lockfile and breaks workspace resolution.

**AWS access.** All commands assume credentials for AWS account
`501789774892` (us-east-1). Verify with `aws sts get-caller-identity`.
Resource inventory (cluster ARN, secret ARN, API endpoint, Cognito
pool, etc.) is in `CONTEXT.md` §2.

**Commands from the root.** `npm run dev` (Vite at
`http://localhost:5173`, pointed at the deployed AWS backend),
`npm run build`, `npm run synth`, `npm run deploy:infra`. Tests:
`npm test --workspace backend` (Jest), `npm test --workspace frontend`
(Vitest).

**No local backend.** Lambdas don't run locally — there's no emulator
configured. Backend changes require `cdk deploy` to exercise (see §7
for the coordinated SQL + code deploy workflow).

**No staging environment.** Master is the only environment. Frontend
auto-deploys to Amplify on push; backend deploys via explicit
`cdk deploy`. This is a known P0 gap — flagged for `OPERATIONS.md`
when that doc gets written (see §12).

**Database access.** Aurora lives in `PRIVATE_ISOLATED` subnets;
direct connection from your laptop is impossible. Use the RDS Data
API (`aws rds-data execute-statement ...`) or the AWS Console Query
Editor — both authenticate via IAM. ARNs in `CONTEXT.md` §2.

**CDK workflow.** `cd infrastructure` first. `cdk diff` before every
`cdk deploy` to see the resource delta. `cdk synth` is safe to run
anytime — it doesn't touch AWS.

**Windows quirks.**
- Git Bash's `claude` shim resolves to a non-existent path. Workaround:
  invoke the binary directly from PowerShell —
  `& 'C:\Users\Raheel\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe' <args>`.
- `aws logs tail /aws/lambda/...` paths get mangled by MSYS path
  translation in Git Bash. Workaround: prefix with `MSYS_NO_PATHCONV=1`.
- PowerShell 5.1 doesn't support `&&` between commands. Use
  `; if ($?) { ... }` to chain on success, or run separately.

**`.agents/` scope.** This directory holds human/agent-facing docs
only. It must never be bundled into Lambda packages, the frontend
build, or CDK output. Verify with `git ls-files .agents/` — every file
should be markdown or a directory of markdown.

---

## 3. The development workflow

Every non-trivial change goes through four phases: **Recon → Plan →
Execute → Verify**. The cycle exists to surface decisions early
(Recon), lock them deliberately (Plan), apply them mechanically
(Execute), and confirm they hold (Verify). Skipping a phase usually
means redoing the work later.

### Recon (Phase 1)

Read existing code before changing it. Inventory the surface area —
every file, function, and call site the change will touch, with exact
`file:line` references. Identify the patterns the change extends and
the gaps it fills. Flag every discrepancy between assumed and actual
behavior.

**Done when:** factual basis is in hand; no "I think X does Y"
speculation remains in the working notes.

**Skip for:** typo fixes, single-line CSS adjustments, doc-only
commits.

**Real example.** Recon for the PA rollout's commit 2 (Lambda creation)
caught three real bugs before any code shipped:

- The partial unique index from migration 0005
  (`WHERE cert_number IS NOT NULL`) requires the same predicate in
  `INSERT ... ON CONFLICT` clauses; the plan-doc draft was missing it.
- The plan's `add-pa.js` referenced image columns that 0005 had never
  added — surfaced a real schema gap, fixed by migration 0007.
- The image columns the plan implied as `text` actually existed on
  `cards` as `varchar(500)`. Type mismatch caught against
  `information_schema` before 0007 shipped.

All three would have been deploy-time errors. None reached deploy.

### Plan (Phase 2)

Write or update a plan doc in `.agents/<feature>-plan.md` for any work
touching multiple files or surfaces. Plan docs follow the 8-section
template (see §4). Lock every decision via the OQ process before
implementation begins.

**Done when:** every open question is locked (`**Locked:**` marker),
every commit in the sequence has a rollback story, every dependency on
existing code is verified during recon.

**Skip the formal plan doc for:** single-file changes, doc-only
commits, hot-fixes (post-mortem the hot-fix into a retroactive plan
update once the bleeding stops).

**Real example.** PA rollout: plan doc committed at `dd60507`
(2026-05-13 15:21); first implementation commit at `94f7fc8` (16:21).
The 60-minute plan-commit to first-implementation-commit gap is the
sign the cycle was followed — recon found enough surprises to be worth
a plan, the plan locked them, then execution was mechanical.

### Execute (Phase 3)

Follow the plan's commit sequence in order. One commit per logical
unit of work (see §6 for commit boundaries). Show the diff before
committing — every time, no exceptions (this is the diff-gate rule
codified in §6). If reality diverges from the plan during execution,
stop and return to Plan rather than forcing the change through.

**Done when:** every commit from the plan sequence is pushed and
deployed.

**Real example.** PA rollout commit 2 (`d98d948`) staged 8 files
(4 new Lambdas + 1 new migration + 3 modifications). Diffs of all
modified files plus snippets of the highest-risk new code
(`add-pa.js`, the `add-card.js` PA-detection branch) were shown for
review before the commit ran. No surprises landed in the commit
because the diff was reviewed first.

### Verify (Phase 4)

Run the verification commands and read the output before claiming the
work is complete. This is the discipline codified in
`methodology/verification-before-completion.md` — see §8 for the full
treatment. The form of verification depends on what changed:

- Code change → run the tests that exist; read the output.
- Schema change → query `information_schema` to confirm the columns
  exist with the expected types.
- Backend deploy → smoke test the affected Lambdas; check CloudWatch
  for new errors in the deploy window.
- Frontend deploy → exercise the affected UI in a browser; watch the
  network tab for 4xx / 5xx responses.

**Done when:** the deploy succeeded, the verification commands
returned expected results, and no new errors appeared in logs over a
reasonable observation window.

**Real example.** After PA commit 2 (`d98d948`) deployed, verification
ran three commands:
`aws lambda get-function-configuration` confirmed the 4 new Lambdas
existed with the expected runtime + handler;
`aws apigatewayv2 get-routes` confirmed the 4 routes registered;
an `information_schema.columns` query confirmed the new columns landed
with the right types. Only after all three came back clean was
"commit 2 deployed" claimed.

### Loop discipline

- **Reality diverges from plan during Execute** → stop, return to
  Plan, update the plan doc with what changed and why.
- **Verification fails** → stop, return to Execute. If the failure
  surfaces a misunderstanding of the system, return to Recon.
- **Three or more failed fixes** → this is an architecture problem,
  not a bug. See `methodology/systematic-debugging.md` (§9) for the
  escape valve.

### When to skip the full cycle

- **Trivial change** (typo, README correction, single CSS value):
  Execute + Verify only.
- **Hot-fix on broken production**: Verify-the-fix-then-Recon
  (post-mortem); document the fix in a retroactive plan update once
  the bleeding stops.
- **Pure exploration / spike**: no commits, scratch work only; delete
  the spike and start fresh under the cycle.

### Anti-patterns this cycle prevents

See §5 for the full catalog. The cycle specifically addresses:

- "I'll just make this small change" without recon → catches the
  partial-index ON CONFLICT class of bug before it reaches deploy.
- "I'll skip the plan, it's just a refactor" → ends up touching 15
  files with no rollback story.
- "Tests probably pass" → no; run them and read the output.

---

## 4. Plan documents

A plan doc is the locked specification for a multi-file or
multi-surface change. It exists to surface every decision before
implementation begins so the Execute phase can be mechanical. Three
plan docs are in `.agents/` as reference: `mark-as-sold-plan.md`,
`potential-acquisitions-plan.md`, `valuation-rebuild-plan.md`.

### When to write a plan doc

Write one when the change touches:

- **Multiple files** (more than two source files, or anything that
  crosses a Lambda + frontend boundary), OR
- **Multiple surfaces** (DB schema + backend code, or backend +
  frontend, or frontend + IaC), OR
- **A breaking change to an established contract** (column rename,
  API field rename, response shape change).

### When not to write a plan doc

- **Single-file change** — typo fix, single CSS value, isolated bug
  fix in one Lambda. Just commit it.
- **Doc-only commit** — README edit, plan-doc revision itself,
  `ROADMAP.md` entry. The doc is the artifact.
- **Hot-fix on broken production** — fix first; once the bleeding
  stops, write a retroactive `<feature>-plan.md` capturing what
  shipped and the post-mortem.

### Naming

`.agents/<feature>-plan.md`. Lowercase, hyphenated, descriptive
(`mark-as-sold-plan.md`, not `marksoldplan.md`). Lives alongside the
other working docs in `.agents/` (see §1).

### The 8-section template

Every plan doc has these eight sections in this order:

| § | Title | Contents |
|---|---|---|
| 1 | Overview | One paragraph: what this builds, why now, what it explicitly does NOT do |
| 2 | Schema changes | Migration files in full (per §7), column types, index decisions |
| 3 | Backend changes (file-by-file) | Every Lambda touched, with code snippets and call-site references |
| 4 | Frontend changes (file-by-file) | Every component touched, every API contract change |
| 5 | *Flex slot* | See "The §5 flex slot" below |
| 6 | Commit sequence | Ordered list of commits, each with scope and verification step |
| 7 | Rollback story | Per-commit: how to undo if deploy fails |
| 8 | Open questions | OQ list — see "OQ structure and the Locked pattern" below |

### The §5 flex slot

Section 5 is intentionally flexible. Its purpose: capture
rollout-specific work that doesn't fit cleanly in §3 / §4 / §6 but
must be documented before implementation. Past examples:

- `mark-as-sold-plan.md` §5 — **Helper unification** (consolidating
  `isSold` across frontend + backend).
- `potential-acquisitions-plan.md` §5 — **UI label rename inventory**
  (every site where "Target Price" became "Sell Target").
- `valuation-rebuild-plan.md` §5 — **MASTER.md addition**
  (design-system doc updates the rebuild required).

Use §5 when the work has a clear rollout-specific deliverable that
doesn't fit in backend or frontend alone. Leave it as a stub
(`§5 — N/A`) when there's nothing rollout-specific to capture.

### OQ structure and the Locked pattern

Every plan doc closes with an Open Questions section (§8). Each OQ
captures a decision that must be made before implementation begins.

**OQ format.** A short title naming the decision; a setup paragraph
of context; an A/B/C list of options with trade-offs; a single
`**Locked: (X)**` paragraph naming the chosen option and the
rationale.

**Verbatim example** (from `potential-acquisitions-plan.md` §8):

```
### OQ-1 — Soft-delete vs hard-delete for `delete-pa`

Spec uses hard DELETE. Alternatives:

- (A) **Hard delete** — `DELETE FROM potential_acquisitions WHERE ...`. **Spec'd.** Row gone, no recovery from UI.
- (B) **Soft delete** — add `deleted_at timestamptz`, set on "delete". Allows undo, audit, and analytics ("things I changed my mind about").
- (C) **Hard delete + audit log table** — separate `pa_history` table receives a row on every delete/move. Heavier but separates concerns.

**Locked: (A).** Hard delete. Users curate their PA list freely;
soft-delete clutter isn't useful. Trigger for soft-delete
reconsideration: first user complaint about an accidental delete.
```

**The "Locked:" rule.** Every OQ must end with a `**Locked: (X)**`
marker before implementation begins. No `Recommendation:`, no "likely
(A) but TBD" — those are unfinished decisions and indicate the plan
isn't ready. If a locked answer turns out wrong during execution,
return to Plan phase, update the OQ with what changed, and re-lock.

**Reversal triggers.** When a locked decision specifies a reversal
trigger (e.g. "first user complaint about accidental delete"), record
it in the rationale. Revisits are then explicit and warranted, not
silent drift.

### Commit sequence and rollback stories

§6 of every plan doc is the ordered commit sequence the rollout will
produce. Each entry:

1. A short identifier (`Commit 1: schema migration 0007`).
2. The scope (files touched, surfaces affected).
3. The verification step (what to check after this commit deploys).

§7 is the rollback story, paired commit-by-commit with §6. Each entry
is one line on how to undo the commit if the deploy fails. For schema
commits this often involves a separate rollback migration; for code
commits it's `git revert` + redeploy.

The rollback story exists not because rollback is common, but because
writing it forces clarity about what the commit actually changes.

### Plan doc lifecycle

- **Created** during the Plan phase (see §3); committed before any
  implementation commit.
- **Updated** when reality diverges from plan during execution. Two
  cases:
  - The plan was right, the implementation was wrong → return to
    Execute, fix the code, plan stays as-is.
  - The plan turned out to be wrong (recon missed something, or the
    locked decision proved unworkable) → amend the plan in the same
    commit as the deviating change. The plan-vs-code state must
    always agree once a commit lands.
- **Preserved** indefinitely. Plan docs are the audit trail for past
  decisions. Don't delete them after a rollout completes — future
  work often retrieves "why did we do it this way?" from a plan doc
  that shipped months ago.

---

## 5. Anti-patterns we reject

(to be drafted — project-history-grounded catalog. Sources include
git log fix/revert patterns, CONTEXT.md §10 recorded incidents, the
Co-Authored-By trailer drift caught during recon, sweeping cosmetic
changes that triggered three-commit revert chains, cross-Lambda drift
between user and admin handlers)

---

## 6. Commit standards

(to be drafted — `area: short imperative` subject format with observed
prefix vocabulary, body-text expectation with the plan-doc carve-out,
no Co-Authored-By trailers per saved memory `feedback_git_identity.md`,
diff-before-commit gate per saved memory `feedback_diff_review_gate.md`,
canonical git identity)

---

## 7. Schema changes

(to be drafted — migration file naming + comment-block header
convention from migrations 0005/0006/0007, Data API workflow with
exact `aws rds-data execute-statement` invocation, coordinated SQL +
`cdk deploy` sequence with timing capture, idempotency rule
`IF NOT EXISTS` / `IF EXISTS`, type-alignment verification step)

---

## 8. Verification discipline

(to be drafted — cites `methodology/verification-before-completion.md`
as the discipline reference. Adapts the Iron Law to our context:
no completion claims without running the verification command in this
session. Examples drawn from our pattern of post-deploy log smoke tests,
verification SQL queries after migrations, build-then-deploy ordering)

---

## 9. Debugging discipline

(to be drafted — cites `methodology/systematic-debugging.md` as the
discipline reference. Adapts the four-phase framework to our context:
PostgreSQL parse-phase errors, Lambda cold-start vs warm-start,
CardHedger vs PSA API failure modes, the "3+ fixes = architectural
problem" escape valve)

---

## 10. Code review

(to be drafted — cites `methodology/code-reviewer-template.md` as the
template for dispatching a code-reviewer subagent. Project-specific
adaptations: when to invoke (after non-trivial commits, before
deployment of high-risk changes), what context to provide
(plan section + locked OQs + commit range))

---

## 11. Documentation requirements

(to be drafted — when each doc gets updated:
`CONTEXT.md` rarely-but-substantively for documented-surface changes
in the same commit; `ROADMAP.md` for parked items; plan docs for
multi-commit features; methodology docs only when discipline itself
changes; this doc per §13)

---

## 12. Other standards docs

(to be drafted — pointers to:
- `BACKEND_CONVENTIONS.md` — Lambda structure, helper modules, response
  shape, validation patterns. **Trigger to write:** when 5+ Lambdas
  diverge from the `_db` / `_response` / `_validate` pattern.
- `FRONTEND_CONVENTIONS.md` — component organization, state management,
  inline-style design system, services/api.js conventions.
  **Trigger to write:** when a second engineer joins, or when
  PortfolioPage.jsx (3,911 LOC) gets decomposed.
- `INFRASTRUCTURE_CONVENTIONS.md` — CDK stack split, IAM grant
  patterns, route registration. **Trigger to write:** when api-stack.ts
  (909 LOC) gets split into per-domain stacks.
- `TESTING.md` — what we test, what we don't, when to add a test.
  **Trigger to write:** when test count exceeds ~20 files or a test
  framework decision needs to be locked.
- `OPERATIONS.md` — deploy procedures, monitoring, backup/recovery,
  cost monitoring. **Trigger to write:** as part of P0 hardening
  work (currently paused at PA rollout commit 3a).
- `INCIDENT_RESPONSE.md` — severity classification, rollback
  procedures, communication templates, alarm playbooks.
  **Trigger to write:** alongside `OPERATIONS.md` when alarms ship.)

---

## 13. Standards evolution

(to be drafted — how this doc changes:
amend in the same commit as the change that breaks a rule or
establishes a new convention; commit message uses `docs:` prefix and
cites the §; if a rule turns out to be wrong, replace it rather than
adding an exception; lay down "we did X but it didn't work, now we do Y
because Z" rationale rather than just "now we do Y")

---

*Draft in progress. §0 and §1 written; §2–§13 are scaffolds. See git
history for incremental drafting.*
