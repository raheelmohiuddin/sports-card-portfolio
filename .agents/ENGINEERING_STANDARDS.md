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

(to be drafted — recon → plan → execute → verify pattern, with the
PA rollout 2026-05-13 timeline as the canonical demonstration:
plan doc at 15:21, first commit at 16:21, four implementation commits
ending at 17:24)

---

## 4. Plan documents

(to be drafted — 8-section template verified across mark-as-sold,
potential-acquisitions, valuation-rebuild plans; OQ-locking pattern
with the option-block + "Locked: (X)" + rationale shape; when to write
a plan doc vs. when to just commit)

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
