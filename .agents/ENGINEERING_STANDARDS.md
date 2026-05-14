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

This is the project-history-grounded catalog of patterns that have
caused real bugs or wasted real time in this codebase. Each entry
names the pattern, cites the evidence, and states the rule going
forward. Not a comprehensive list of bad ideas — only the ones the
codebase has explicitly taught us to reject.

### 1. Cross-Lambda drift

**What it is.** Admin Lambdas mirror user Lambdas (e.g.
`admin/get-card.js` mirrors `cards/get-card.js`); when only one is
updated, the response shape silently diverges and admin views break.

**Evidence.** Commit `3c7b0f8` ("cards/admin: return sold_* fields +
join card_shows; fix admin drift") fixed exactly this drift after the
mark-as-sold rollout updated user-side `get-card.js` but left the
admin Lambda unchanged.

**Rule.** When updating a Lambda that has an admin twin, update both
in the same commit. The plan doc's §3 (Backend changes) must list both
files when relevant.

### 2. Sweeping cosmetic changes across many files

**What it is.** Design-token sweeps that touch 10+ files without an
anchoring decision (a MASTER.md update or a locked OQ) get reverted
because the change spreads ambiguously and the rollback is
indistinguishable from drift.

**Evidence.** Three-commit revert chain `23e364f` / `8169f5d` /
`b80ae9e` reverted the antique-gold sweep across 15 files. The
eventual fix was formalizing a two-gold system in `MASTER.md` §1.3 —
not the sweep.

**Rule.** Cosmetic sweeps require an anchor commit first
(design-system doc update, locked decision in MASTER.md). The sweep
then cites the anchor in its commit message. No anchor → no sweep.

### 3. Direct production database changes without a migration file

**What it is.** Schema changes applied via Console / `psql` / ad-hoc
Lambda without a numbered migration file in `backend/db/migrations/`.
The live schema and the committed schema diverge silently.

**Evidence.** `CONTEXT.md` §10 records `backend/db/schema.sql` was
bootstrapped at project start and never updated; the live schema is
now authoritatively documented in CONTEXT.md §8 instead. Earlier
in-Lambda migrations under `backend/functions/_migrations/` are also
deprecated for the same reason.

**Rule.** Every schema change is a numbered migration file (per §7).
No exceptions — even one-line `ALTER TABLE` statements get a
migration file. The Data API and Query Editor are convenient for
*applying* migrations, not for replacing them.

### 4. Cross-table aggregations without explicit precedence

**What it is.** Aggregations that pick a value from multiple sources
(e.g. `manual_price ?? estimate_price ?? sold_price`) without a
written precedence rule end up double-counting, missing branches, or
choosing the wrong source.

**Evidence.** `994d0e3` ("portfolio: fix get-value totalValue
double-count for sold + traded cards") and `12e207c` ("get-value: fix
totalValue precedence to use estimate_price") were both same-class
bugs caught after deploy. Both were fixes to the same totalValue
calculation.

**Rule.** When an aggregation pulls from multiple sources, the
precedence is written down — in the code (with comment) and in the
plan doc's §3 (Backend changes). Test the aggregation on a row from
each source category before claiming the change is done.

### 5. ON CONFLICT without matching partial-index predicate

**What it is.** When a partial unique index exists
(e.g. `WHERE cert_number IS NOT NULL`), `INSERT ... ON CONFLICT`
clauses must include the same predicate. Postgres rejects the INSERT
otherwise — the conflict target is unmatchable.

**Evidence.** Caught during PA commit 2 recon: the plan-doc draft of
`add-pa.js` had `ON CONFLICT (user_id, cert_number) DO NOTHING`
without the matching `WHERE cert_number IS NOT NULL` from migration
0005's partial index. Would have been a deploy-time failure.

**Rule.** When recon for a Lambda touches a table with partial
indexes, list every partial-index predicate in the plan and verify
each `ON CONFLICT` clause matches.

### 6. State declared below the effect that depends on it

**What it is.** React `useState` declared *after* the `useEffect` that
references it produces a temporal-dead-zone error and a blank-page
render — not a stack trace, just a white page.

**Evidence.** `58a00da` ("Fix /shows blank page: hoist nearMe state
above the fetch effect") fixed exactly this. The page rendered blank
in production with no obvious console output.

**Rule.** All `useState` declarations come before any `useEffect`.
Order in the component: hooks first (state, refs, computed memos),
then effects, then handlers, then render. When debugging a blank
page, this is the first thing to check.

### 7. Convention drift across sessions

**What it is.** Locked conventions (e.g. no Co-Authored-By trailers
on commits) decay silently between sessions when there's no
enforcement mechanism. Documentation alone doesn't hold a convention.

**Evidence.** 8 of the 50 commits before `dca6fc0` (2026-05-12)
included `Co-Authored-By: Claude ...` trailers despite the convention
being recorded in `CONTEXT.md`. Trailers stopped only when saved
memory `feedback_git_identity.md` was added — the saved memory loads
on every session; the doc only loads when read.

**Rule.** When a convention is decided, the enforcement is a saved
memory in `~/.claude/.../memory/` (not just doc text). Saved memories
load every session; doc text only loads when consulted. If a
convention isn't worth a saved memory, it isn't actually locked.

---

This list is not exhaustive — it codifies anti-patterns the codebase
has explicitly taught us to reject. When new lessons surface, add them
here in the same commit as the fix.

---

## 6. Commit standards

Every commit follows the same structural rules: an `area: subject`
header, a body that explains the why, and atomic scope. Commits are
the project's audit trail — each one should be independently
revertible and independently understandable months later.

### Subject format

`area: short imperative description`. Lowercase area, colon-space,
short imperative subject (≤70 chars total).

Area prefixes observed in this repo fall into four shapes:

- **Domain-named.** `db:`, `frontend:`, `cards:`, `shows:`, `chore:`,
  `docs:`. The default — pick the broadest area that scopes the
  change.
- **File-named.** `get-value:`, `MarkSoldBlock:`. Use when one file
  dominates the diff.
- **Concept-named.** `category:`, `iam:`. Use when the change crosses
  multiple files unified by one concept.
- **Feature-named.** `potential-acquisitions:`. Use for multi-commit
  rollouts where every commit shares a feature label.

All four are acceptable. Pick the one that makes the commit most
discoverable later via `git log --grep=<area>`.

**We do not use Conventional Commits** (`feat:`, `fix:`, `refactor:`).
Domain / file / concept / feature prefixes are more useful for this
codebase than change-type prefixes.

### Body

Required for non-trivial commits. Empty body is acceptable only when
the commit's artifact IS the documentation:

- Plan-doc additions (e.g. `dd60507 docs: add potential-acquisitions
  implementation plan` — the plan doc itself is the body).
- One-line README fixes.

A non-trivial commit body:

- Explains the **why**, not the what (the diff shows what changed).
- Cites the plan doc and locked OQs that drove the work
  (`Per .agents/<feature>-plan.md §3`, `Per OQ-N locked`).
- References commit SHAs of related work when the commit is part of
  an atomic chain.

### Trailers and identity

**No `Co-Authored-By` trailers.** Period. Enforced by saved memory
`feedback_git_identity.md` (see §5 pattern 7).

Canonical commit identity: `Raheel Mohiuddin
<raheelmohiuddin@users.noreply.github.com>`. Set via inline `-c`
flags on every commit:

```
git -c user.name="Raheel Mohiuddin" -c user.email="raheelmohiuddin@users.noreply.github.com" commit -m "..."
```

**Never modify `.git/config`.** Inline flags only — they leave no
local state that could drift.

### Atomic boundaries

One commit per logical unit of work. Apply these split tests:

- Could this commit be reverted without breaking unrelated work? If
  no → split.
- Could this commit have a single-line accurate summary? If forced
  to use "and" → split.
- Schema + code that depend on each other → must be atomic
  (see §7).
- Cross-Lambda drift fixes (admin twin + user Lambda) → must be
  atomic (see §5 pattern 1).

### The diff-gate rule

Show every diff before committing. No exceptions. This is the rule
§3 (Execute phase) references; this is where it's codified.

- Multi-file commit: show the diff of every modified file, plus
  snippets of any new code that introduces non-obvious logic.
- Single-file commit: show the diff.
- The diff is approved before the commit runs.

The diff-gate failed three times during the mark-as-sold rollout —
plan commit `a2ba2bd`, migration commit `da44021`, and Lambda commit
`6e7265c` all had the diff shown only after the commit had landed on
origin. Saved memory `feedback_diff_review_gate.md` is the
resolution.

### Pre-commit verification

Before the commit runs:

- Run any tests that exist for changed files (`npm test --workspace
  backend` or `--workspace frontend`).
- `git status` shows only intended changes.
- Working tree is clean of accidental files (`node_modules/`, `.env`,
  scratch logs, IDE state).

### Push cadence

Push after every commit on master. The current convention is
master-only with no feature branches — revisit if multiple
contributors join (see §13). No accumulating commits locally; each
commit is visible on origin within seconds of landing.

This works because the cycle (Recon → Plan → Execute → Verify) gates
every commit. Verification fails before push, not after.

### Examples

**Good (substantive commit)** — `d98d948`:

```
potential-acquisitions: add 4 Lambdas + register in api-stack + OQ-6 PA-detection branch

Per .agents/potential-acquisitions-plan.md §3.

New Lambdas:
- add-pa.js: POST /potential-acquisitions. Includes OQ-8 optional
  front+back image upload (mirrors add-card pattern). ON CONFLICT
  clause includes WHERE cert_number IS NOT NULL to match the
  partial unique index from migration 0005.
- list-pas.js, delete-pa.js, move-to-collection.js: ...
```

Area-prefix subject. Body cites plan section, every locked OQ that
shaped the work, and the recon flag that informed the return shape.

**Good (terse, doc-only)** — `dd60507`:

```
docs: add potential-acquisitions implementation plan
```

No body. The plan doc itself is the artifact.

**Bad (would be rejected).**

```
fix stuff
```

No area prefix. Vague subject. No body. Cannot be discovered later
via `git log --grep`. Cannot be reverted with confidence (what is
"stuff"?). Cannot be cited from a future commit body.

---

## 7. Schema changes

Every schema change is a numbered migration file applied via the RDS
Data API. The file is the source of truth; the live database is the
target. This section codifies the file convention, the apply
workflow, and the verification step. See §5 pattern 3 for why
direct-to-DB changes are rejected.

### Migration file convention

**Location.** `backend/db/migrations/`.

**Naming.** `000N_descriptive_name.sql`. Four-digit zero-padded
sequence number, underscore, lowercase descriptive name, `.sql`
extension. Examples in repo: `0005_potential_acquisitions.sql`,
`0006_rename_target_price.sql`, `0007_pa_image_columns.sql`.

**Header comment block.** Every migration opens with:

- File name on line 1.
- One-line intent statement.
- Multi-line rationale citing the locked OQ (or recon flag) that
  drove the change.
- Idempotency note (every migration uses `IF NOT EXISTS` / `IF
  EXISTS` / `ADD COLUMN IF NOT EXISTS` etc. — re-running must be
  safe).
- Type-alignment notes if the migration mirrors columns from another
  table (e.g. 0007 explicitly notes `varchar(500)` vs `text`
  alignment with `cards`).

**Idempotency.** Every statement guarded so re-application is a no-op:

- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- `ALTER TABLE ... DROP COLUMN IF EXISTS`

`ALTER TABLE ... RENAME COLUMN` doesn't have an `IF EXISTS` form —
it errors on a second run. That's acceptable; the rename either
already happened (live state agrees with code) or it didn't (apply
again).

### Coordinated SQL + code deploy workflow

The canonical workflow, used for migration 0006 (commit `21ecab0`,
the `target_price` → `sell_target_price` rename):

1. **Capture start time** so the misalignment window is measurable:
   `echo "=== START: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="`.
2. **Apply SQL** via the RDS Data API using cluster + secret + DB
   identifiers from `CONTEXT.md` §2:
   ```
   aws rds-data execute-statement \
     --resource-arn "$CLUSTER_ARN" \
     --secret-arn "$SECRET_ARN" \
     --database "$DB_NAME" \
     --region us-east-1 \
     --sql "$(cat backend/db/migrations/0NNN_*.sql)"
   ```
3. **Deploy code** that depends on the new schema: `cd infrastructure
   && cdk deploy --require-approval never`.
4. **Verify** the schema landed: `information_schema.columns` query
   confirming column names + types.
5. **Smoke test** affected Lambda logs: `aws logs tail
   /aws/lambda/scp-<function-name> --since 5m --filter-pattern ERROR`.

The misalignment window (between SQL apply and code deploy
completing) was **2m 33s** for migration 0006. Acceptable in this
case because no live traffic hit affected Lambdas during the window
(verified by checking unfiltered logs in addition to the ERROR
filter).

### Backward-incompatible renames under traffic

The single-step rename above works for a low-traffic prototype. With
live traffic on the affected surface, a column rename requires
two deploys:

1. Add the new column. Code dual-writes (writes both old and new),
   reads from the new column. Deploy.
2. Drop the old column once you've confirmed the new column has full
   coverage. Deploy.

This codebase doesn't yet have surfaces where the single-step is
unsafe — current convention is single-step rename with measured
misalignment window. Revisit when any Lambda affected by a rename
receives traffic during deploy (see §13). When traffic justifies the
two-step, write the sequence into the plan doc's §6 (Commit
sequence).

### Applying migrations

- **Always** via `aws rds-data execute-statement` (or the AWS Console
  Query Editor for one-off investigative queries).
- **Never** via direct `psql` or ad-hoc Lambda for substantive
  changes. The `_migrations/` Lambdas under `backend/functions/`
  are deprecated for the same reason — see §5 pattern 3.

The Console Query Editor is acceptable for non-mutating queries
(`SELECT`, `EXPLAIN`, `\d table_name`) where you want fast feedback
without copying ARNs.

### Verifying migrations

Verification is the Verify-phase step (§3) for schema work. Two
queries cover the common cases:

- **New columns / tables:**
  ```sql
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'cards'
  ORDER BY ordinal_position;
  ```
- **Renames:** confirm old name absent, new name present, type
  preserved:
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'cards'
    AND column_name IN ('<old_name>', '<new_name>');
  ```

Expected: zero rows for `<old_name>`, one row for `<new_name>`.

### Rollback

- Schema rollbacks are **forward-only** — write a new migration
  (`0NNN_rollback_of_0XXX.sql`) that undoes the change.
- **Never delete** a migration file once committed. The numbered
  sequence is the audit trail.
- Rollback migrations are themselves idempotent (`IF EXISTS` guards).

For most changes, code revert + redeploy is sufficient — the schema
change is additive (`ADD COLUMN IF NOT EXISTS`) and the column simply
goes unused. A schema rollback is only needed when the column itself
is the problem (wrong type, wrong constraint, fundamentally wrong
shape).

---

## 8. Verification discipline

The authoritative reference for verification discipline is
`methodology/verification-before-completion.md` — read it once. The
Iron Law in one sentence: **no completion claims without fresh
verification evidence**. If you haven't run the verification command
in this session, you can't claim it passes.

This section captures the project-specific shapes of "the
verification command":

- **Schema changes** — `information_schema.columns` query confirming
  the change landed (templates in §7).
- **Backend deploy** — `aws lambda get-function-configuration` for
  every new or modified Lambda, plus `aws logs tail /aws/lambda/scp-*
  --filter-pattern ERROR` over the deploy window.
- **Frontend deploy** — exercise the affected UI in a browser; watch
  the network tab for 4xx / 5xx responses.
- **Cross-Lambda changes** — verify both the user-side and admin-side
  Lambdas if applicable (see §5 pattern 1 — admin twins drift
  silently).
- **Helper changes** — run the existing test suite for the affected
  helper (`npm test --workspace backend` or `--workspace frontend`).

**Language to avoid.** "Should work" / "looks fine" / "probably
passes" — none of these are verification. Either the command was run
in this session and produced expected output (verified) or it wasn't
(unverified). "Tests pass" without a fresh test run is a lie. "Deploy
succeeded" without a log check confuses *the deploy didn't error*
with *the deployed code works*.

**Real example.** After `cdk deploy` completed for PA commit 2
(`d98d948`), "commit 2 deployed" was claimed only once three
independent verifications returned clean: `aws lambda
get-function-configuration` confirmed all 4 new Lambdas existed with
the expected runtime + handler; `aws apigatewayv2 get-routes`
confirmed the 4 routes registered with the API; an
`information_schema.columns` query confirmed the new columns landed
with the right types. No verification was skipped. No verification
was inferred from another verification.

---

## 9. Debugging discipline

Treat `methodology/systematic-debugging.md` as authoritative for any
non-trivial debugging session. The four-phase frame in one sentence:
**Root cause → Pattern analysis → Hypothesis → Implementation**, with
the fix landing only after Phase 1 produces a verified root cause.

This-project adaptations:

- **Phase 1 — Recent-changes check first.** This codebase ships fast;
  the prime suspect for any new bug is the most recent commit that
  touched the relevant surface. `git log --oneline -10
  <affected-file>` before anything else.
- **Phase 1 — Multi-component evidence in serverless land.** Lambdas
  can't be stepped through locally (see §2). Instrument with
  `console.log` before and after suspect operations, deploy, and read
  CloudWatch logs across every Lambda in the call chain (e.g.
  `add-card` → `fetchValuation` → CardHedger client).
- **Phase 2 — Helpers are the reference.** When a Lambda misbehaves
  while a sibling Lambda doesn't, compare them. `_db.js`,
  `_validate.js`, `_response.js` are the shared baseline; deviation
  from them is often the bug.
- **Phase 3 — Test hypotheses via minimal-diff deploys.** Without a
  local emulator, hypothesis tests are deploy-and-observe cycles.
  Make the smallest possible change, deploy, read logs. One variable
  per cycle.
- **Phase 4 — The 3+ fixes escape valve.** Three failed fixes means
  architectural problem, not bug. In this codebase, that triggers a
  return to Plan phase (§3) — open a plan-doc-level discussion before
  attempting a fourth fix.

**Language to avoid.** "Try this and see" — that's a guess, not a
hypothesis. "It's probably X" — Phase 1 isn't done. "I know what this
is" without checking — Phase 2 skip.

**Real example.** Commit `e4156d0` ("shows: fix attendedOnly
Parse-phase type-inference error") fixed a Postgres `42P18` raised
when the `attendedOnly` query path collapsed all cast sites for `$2`
in `list-shows.js`. Phase 1 identified the error as missing parameter
type inference; Phase 2 diffed against the pre-`attendedOnly` SQL and
spotted the dropped `::date` cast; Phase 3 hypothesized "Postgres
needs at least one cast site for the parameter type"; Phase 4 added
the no-op `($2::date IS NULL OR TRUE)` clause to restore inference.

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
