# Node 22 LTS Upgrade — Implementation Plan

> Drafted 2026-05-19. Recon (Phase B) completed in same session;
> findings drive §3, §5, §8. OQs were pre-locked by the user during
> plan handoff — each closes with a `**Locked: (X)**` marker per §4.
> Companion to the ROADMAP "Node 22 LTS upgrade" entry (line 37),
> originally added at commit `887125d`, amended at `9bfe4c6`, and
> corrected at `5eb0850` (AWS extended-grace dates verified against
> live AWS docs).

---

## 1. Overview

This rollout migrates the project off AWS Lambda's `nodejs20.x`
runtime ahead of its hard block-update deadline (2027-03-03 per AWS
docs). Concretely it ships:

1. **AWS Lambda runtime swap** — `NODEJS_20_X` → `NODEJS_22_X`
   in both CDK stacks (`api-stack.ts` and `auth-stack.ts`), plus
   matching `esbuild` `target: "node20"` → `"node22"` so the bundle
   feature target tracks the runtime. Two-line diff per stack;
   `sharedNodejsProps` propagates the constants to **56 Lambdas
   (55 from api-stack + 1 from auth-stack — the PostConfirmation
   Cognito trigger)** (counts verified 2026-05-19 via `grep -c
   "new NodejsFunction" infrastructure/lib/{api,auth}-stack.ts`).
2. **GitHub Actions Node bump** — `node-version: 20` → `22` across
   3 steps in `ci.yml` and 1 step in `security.yml`. Step-name
   strings drop the version (`"Set up Node.js 20"` → `"Set up
   Node.js"`) per OQ-5 so future runtime bumps don't drag name
   edits.
3. **`.nvmrc` add at repo root** pinning `22` (per OQ-3), so nvm
   users auto-select the right version without per-machine
   coordination.
4. **Doc updates** in the same commit chain per §11:
   `ENGINEERING_STANDARDS.md` §2 line 63 (`Node 20.x` → `Node 22.x`)
   and `ROADMAP.md` (entry moves from "Tech debt" to "Completed
   audits / one-time work" with the 2026-05-19 completion date).

**Explicitly NOT in scope:**

- **Application code changes.** Recon §A.2 grepped for every
  Node-22-removed API in our `*.js` and `*.ts` files —
  `assert { type:`, `new Buffer(`, `url.parse(`, `require('punycode')`,
  `crypto.createCipher`, `crypto.createDecipher` — and returned
  **zero matches** in `backend/`, `frontend/`, or `infrastructure/`
  application code. No source edits required.
- **`node_modules` rebuild.** Recon §B confirmed zero native
  modules in the dependency tree (no `.node` binaries in direct
  deps; `pg-native` is the only optional native add-on and we use
  `pg`'s pure-JS fallback). No ABI-127 rebuild required.
- **Windows local toolchain bump.** Per OQ-2, we accept Node
  24.15.0 locally and let `esbuild`'s `target: "node22"` decouple
  the local Node version from emitted bundles. Reversal trigger
  recorded in OQ-2.
- **Amplify console Node-version override.** Per OQ-4, this is a
  manual verification step in Commit 1's verify list, not a
  source change.
- **CONTEXT.md edit.** Line 854 says "Node: required" without a
  version, so the doc is not version-pinned and needs no update.
  Version pinning lives in `ENGINEERING_STANDARDS.md` §2 only.

The rollout produces **3 commits, 1 `cdk deploy`**. Commit 1
deploys infrastructure; Commits 2 and 3 do not.

---

## 2. Schema changes

**N/A.** No database migration. The runtime swap is an AWS Lambda
configuration property change applied via `cdk deploy`, not via
the `aws rds-data execute-statement` migration workflow in
ENGINEERING_STANDARDS §7.

---

## 3. Backend changes (file-by-file)

Four source-file edits + one new root file. No application-layer
Lambda code is touched.

### 3.1 `infrastructure/lib/api-stack.ts`

Two single-line edits inside the existing `sharedNodejsProps`
object (lines 62–82 today):

```ts
// Line 63 (current):
runtime: lambda.Runtime.NODEJS_20_X,

// Line 63 (after):
runtime: lambda.Runtime.NODEJS_22_X,
```

```ts
// Line 74 (current):
target: "node20",

// Line 74 (after):
target: "node22",
```

The `sharedNodejsProps` constant is spread into every
`NodejsFunction` constructor downstream in this stack, so these two
lines flow to all 55 user-side Lambdas (cards, shows, trades, PAs,
admin, valuation, etc.). No per-Lambda edit required.

**Why both lines change together.** The `runtime` field controls
which Lambda runtime AWS provisions; the `target` field controls
which Node feature target `esbuild` emits to. Mismatching them
(e.g., `target: "node22"` with `runtime: NODEJS_20_X`) would emit
ES2024 syntax that Node 20 can't parse — deploy-time bundle failure
on cold start. Locked together per OQ-6.

### 3.2 `infrastructure/lib/auth-stack.ts`

Same pattern, two lines:

```ts
// Line 24 (current):
runtime: lambda.Runtime.NODEJS_20_X,

// Line 24 (after):
runtime: lambda.Runtime.NODEJS_22_X,
```

```ts
// Line 29 (current):
bundling: { minify: false, sourceMap: false, target: "node20" },

// Line 29 (after):
bundling: { minify: false, sourceMap: false, target: "node22" },
```

Affects the single auth Lambda in this stack:
`scp-post-confirmation` — the Cognito PostConfirmation trigger.
Recon §H estimate of "~5 auth Lambdas" was incorrect; verified
2026-05-19 via `grep -c "new NodejsFunction"
infrastructure/lib/auth-stack.ts` → 1.

**Cross-stack atomicity.** Per ENGINEERING_STANDARDS §5 pattern 1
(cross-Lambda drift), both stacks update in the same commit. A
partial upgrade where one stack lands and the other doesn't would
leave the system in a mixed-runtime state — drift class.

### 3.3 `.github/workflows/ci.yml`

Three job-level edits, all the same shape:

```yaml
# Lines 30-33, 49-52, 68-71 (current):
- name: Set up Node.js 20
  uses: actions/setup-node@v4
  with:
    node-version: 20

# After:
- name: Set up Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 22
```

Three affected jobs: `backend-tests` (line 33), `frontend-tests`
(line 52), `frontend-build` (line 71). The step `name:` drops the
version per OQ-5 so the next runtime bump (Node 24 in ~2 years) is
a one-line change per job rather than two.

### 3.4 `.github/workflows/security.yml`

One job, same edit:

```yaml
# Lines 27-30 (current):
- name: Set up Node.js 20
  uses: actions/setup-node@v4
  with:
    node-version: 20

# After:
- name: Set up Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 22
```

Affects the `npm-audit` job at `security.yml:30`.

### 3.5 Application code — N/A

Recon §A.2 confirmed via grep across `backend/`, `frontend/`, and
`infrastructure/`:

| Pattern (Node 22 removed/deprecated API) | Matches in our code |
|---|---|
| `assert { type:` (import assertions, removed v22.0.0) | 0 |
| `new Buffer(` (deprecated since v10) | 0 |
| `url.parse(` (DEP0169 runtime deprecated) | 0 |
| `require('punycode')` (DEP0040 app-level) | 0 |
| `crypto.createCipher(` / `createDecipher(` (EOL) | 0 |

**Zero application-code edits required.** Transitive dep usage
was not grepped — that surfaces as runtime deprecation warnings,
not deploy-time failures, and is monitored via the existing
backend-test smoke-test pattern (Mac test 4 already emitted the
`@aws-sdk` "upgrade to node >=22" warning — that warning *goes
away* after this upgrade).

### 3.6 Repo root — `.nvmrc` (NEW FILE)

Single-line file at repo root:

```
22
```

Per OQ-3, this auto-selects Node 22 for nvm users (Mac via `nvm
use`, Windows via `nvm-windows`'s `nvm use` if/when installed). No
effect on contributors who don't use nvm; no effect on CI (which
uses `actions/setup-node` instead).

---

## 4. Frontend changes (file-by-file)

**N/A.** Vite emits a browser bundle; the build's Node version
affects build tooling, not the emitted bundle's behavior. Amplify
auto-deploys the frontend on push; the Amplify build image's Node
version is verified in Commit 1's manual verification step (per
OQ-4).

---

## 5. Flex slot — Local toolchain + Amplify verification

§4 of ENGINEERING_STANDARDS specifies §5 of every plan doc as the
"rollout-specific work" slot. For this upgrade, §5 captures the
three local-environment / external-system surfaces that the
commit chain touches indirectly but doesn't directly edit.

### 5.1 Windows local toolchain

Per recon §H, the Windows machine (`raheel4293@gmail.com`) is
currently on **Node v24.15.0**, npm 11.12.1. Node 24 is itself
Active LTS as of 2025-10. Options were evaluated in OQ-2; lock is
(A) — accept Node 24 locally, deploy to `nodejs22.x` Lambda
runtime, rely on `esbuild`'s `target: "node22"` to bridge the gap.

**Why this is safe.** `esbuild` downlevels modern JS to the
declared target, so the bundle emitted on Node 24 runs identically
on Node 22. Local Jest runs (Node 24) will catch all bugs Node 22
runs would catch — Node 24 is a strict superset of Node 22's
behavior for the APIs we use.

**Reversal trigger** (per §4 OQ pattern): the first bug where
local Node 24 behavior diverges from deployed `nodejs22.x` Lambda
behavior. At that point install Node 22 via nvm-windows. Until
then, no toolchain change.

### 5.2 Mac local toolchain

Per recon §H, the Mac machine was on Node 20.20.2 via nvm as of
2026-05-14 (last Mac session). Action when the Mac is next used:

```bash
nvm install 22 --lts
nvm use 22
nvm alias default 22
```

The `.nvmrc` (per §3.6) means `nvm use` in the project directory
will auto-select 22 once the install is done. Not blocking
tonight; flagged as a Mac-session todo item.

### 5.3 Amplify console Node-version check

Per recon §G, `amplify.yml` at repo root does NOT pin a Node
version, so Amplify Hosting falls back to its build image default.
However, the Amplify console exposes a **Build settings → Node.js
version** override that is invisible to git. If a prior contributor
(or AWS default) set this to 20, the frontend build would still
run on Node 20 post-upgrade — a silent toolchain split.

**Manual verification step** (built into Commit 1's verify list):

1. Log into the Amplify Hosting console for this app.
2. App settings → Build settings → "Build image settings".
3. Confirm "Node.js version" is either unset (Amplify default,
   which is Node 22 LTS as of 2026 per AWS image release notes)
   or explicitly `22`. If pinned to `20`, update to `22`.
4. Trigger a fresh build to confirm the new Node version is used
   (Amplify build logs print the Node version at startup).

If the Amplify console value differs from `amplify.yml`'s
unstated default, document the resolved state in a follow-up
ROADMAP entry under "Operational state to monitor" so future
contributors know to check both places.

---

## 6. Commit sequence

Three commits, in deploy order. Only Commit 1 invokes `cdk
deploy`; Commits 2 and 3 do not.

### Commit 1 — `infra: bump Lambda runtime nodejs20.x → nodejs22.x`

- **Scope.** Two files:
  - `infrastructure/lib/api-stack.ts` (lines 63 + 74).
  - `infrastructure/lib/auth-stack.ts` (lines 24 + 29).
- **Atomic boundary justification.** Both stacks share one logical
  unit — the runtime upgrade. Per ENGINEERING_STANDARDS §5 pattern
  1 (cross-Lambda drift), splitting by stack would leave one stack
  on Node 20 and the other on Node 22 in the misalignment window,
  which is drift class. §6 atomic-boundary test #2 (single-line
  summary): "bump Lambda runtime nodejs20.x → nodejs22.x" — no
  "and" needed. ✓
- **Verify.** Tonight's deploy runs from Windows + PowerShell;
  every command below has a Bash and a PowerShell variant since
  PowerShell 5.1 doesn't support `&&` chaining (per CONTEXT.md
  §11.1).
  1. **cdk diff.** Expect only Lambda `Runtime` property updates
     (56 functions: `nodejs20.x` → `nodejs22.x`) and S3Key
     updates (56 asset-hash changes from the `target: "node22"`
     esbuild reconfig). No resource recreations. No unrelated
     property deltas.
     - Bash: `cd infrastructure && npx cdk diff`
     - PowerShell: `cd infrastructure; if ($?) { npx cdk diff }`
  2. **Expected cdk diff scale: 56 Lambdas × 2 property changes
     each ≈ 112 property-level deltas.** Per recon §I, this is
     normal. Do not panic.
  3. **cdk deploy** succeeds in one pass. Wall-clock estimate:
     5–10 minutes (vs the usual 2–3) because every Lambda
     re-bundles via `esbuild` and re-uploads its asset.
     - Bash: `cd infrastructure && npx cdk deploy --require-approval never`
     - PowerShell: `cd infrastructure; if ($?) { npx cdk deploy --require-approval never }`
  4. **Post-deploy nodejs22.x sweep.** Expect 56. (`scp-` prefix
     filters out any non-project Lambdas in the account.)
     - Bash:
       ```bash
       aws lambda list-functions --region us-east-1 \
         --query "Functions[?Runtime=='nodejs22.x'].FunctionName" \
         --output text | tr '\t' '\n' | grep -c scp-
       ```
     - PowerShell:
       ```powershell
       (aws lambda list-functions --region us-east-1 `
         --query "Functions[?Runtime=='nodejs22.x'].FunctionName" `
         --output text) -split "\s+" | Where-Object { $_ -like 'scp-*' } | Measure-Object | Select-Object -ExpandProperty Count
       ```
  5. **Companion nodejs20.x sweep — must return empty / zero.**
     Output is cross-shell (`aws` CLI prints a literal tab-
     delimited string regardless of host shell).
     - Bash / PowerShell (identical):
       ```
       aws lambda list-functions --region us-east-1 --query "Functions[?Runtime=='nodejs20.x'].FunctionName" --output text
       ```
  6. **Smoke test live API.** `GET /cards` (Raheel's portfolio)
     once; confirm response shape matches pre-upgrade. Same for
     `GET /shows`, `GET /potential-acquisitions`,
     `GET /portfolio/value`. Curl or browser; shell-agnostic.
  7. **CloudWatch logs over the next 15 minutes:** zero new
     `ERROR` entries across `scp-*` log groups. The 15-minute
     window is computed as a Unix-epoch-millis value passed to
     `--start-time`.
     - Bash:
       ```bash
       aws logs filter-log-events --region us-east-1 \
         --log-group-name-prefix /aws/lambda/scp- \
         --start-time $(($(date +%s) - 900))000 \
         --filter-pattern ERROR
       ```
     - PowerShell:
       ```powershell
       $startTime = [int64]((Get-Date).ToUniversalTime().AddMinutes(-15) - [datetime]'1970-01-01').TotalMilliseconds
       aws logs filter-log-events --region us-east-1 `
         --log-group-name-prefix /aws/lambda/scp- `
         --start-time $startTime `
         --filter-pattern ERROR
       ```
  8. **Manual: Amplify console Node-version check per §5.3.**
     Recorded as a verified state in the commit body or a
     follow-up comment if a console change was made. Browser-
     based; shell-agnostic.
- **Commit message:**

```
infra: bump Lambda runtime nodejs20.x → nodejs22.x

Migrates all 56 Lambdas (api-stack + auth-stack) off the
deprecated nodejs20.x runtime ahead of AWS's block-update deadline
(2027-03-03 per .agents/ROADMAP.md Node 22 LTS upgrade entry).

Per .agents/node22-lts-upgrade-plan.md §3.1 + §3.2 (file-by-file)
and §6 commit 1.

Four-line edit:
- api-stack.ts:63   runtime  NODEJS_20_X → NODEJS_22_X
- api-stack.ts:74   target   "node20" → "node22"
- auth-stack.ts:24  runtime  NODEJS_20_X → NODEJS_22_X
- auth-stack.ts:29  target   "node20" → "node22"

Both stacks flip atomically per ENGINEERING_STANDARDS §5 pattern 1
(cross-Lambda drift). The sharedNodejsProps pattern means the
four-line edit propagates to every Lambda in each stack.

Expected cdk diff: 56 Lambda Runtime property updates + 56
asset-hash (S3Key) updates from the esbuild target change. This
is normal — see plan-doc §6 commit 1 verify step + recon report
§I (bundle hash impact). No resource recreations, no unrelated
deltas.

Recon §A.2 confirmed zero application-code usages of Node-22-
removed APIs (assert {type:, new Buffer, url.parse,
require('punycode'), crypto.createCipher). Recon §B confirmed
zero native modules → no ABI rebuild needed.
```

### Commit 2 — `dev tooling: pin Node 22 for CI and nvm users`

- **Scope.** Three files:
  - `.github/workflows/ci.yml` (3 step edits — lines ~30–33, ~49–52,
    ~68–71).
  - `.github/workflows/security.yml` (1 step edit — lines ~27–30).
  - `.nvmrc` (new file at repo root, single line `22`).
- **Atomic boundary justification.** Single logical unit:
  "developer-facing Node version pinning." CI runners and local
  nvm users both pick up their Node version from version-pinning
  files; this commit updates all of them at once. §6 single-line
  test: "pin Node 22 for CI and nvm users" — no functional "and"
  (CI and nvm are both Node-pinning surfaces, not separate
  features).
- **Verify.**
  1. **Working tree clean check** — `git status` shows exactly
     2 modified files + 1 new untracked file (`.nvmrc`). Cross-
     shell.
  2. **Push triggers CI.** Verify under Actions tab (browser,
     shell-agnostic):
     - `backend-tests` runs on Node 22 (job log header shows
       `node-version: 22`).
     - `frontend-tests` runs on Node 22.
     - `frontend-build` runs on Node 22.
     - All three jobs succeed.
  3. **Security workflow check.** The next Monday cron OR a
     manual `workflow_dispatch` of `security.yml` runs
     `npm-audit` under Node 22 and completes without
     `NODE_OPTIONS`/engines errors. Browser, shell-agnostic.
  4. **Local nvm auto-select** (Mac session, next time it
     happens):
     - Bash: `cd sports-card-portfolio && nvm use`
     - (PowerShell N/A — nvm-windows uses different syntax and
       isn't installed locally per OQ-2 lock; revisit if/when
       Node 22 lands locally on Windows.)
     Expected: nvm picks `.nvmrc`'s `22` automatically.
- **Commit message:**

```
dev tooling: pin Node 22 for CI and nvm users

Aligns CI runners and local nvm-managed Node versions with the
Lambda runtime upgrade landed at <Commit 1 SHA>.

Per .agents/node22-lts-upgrade-plan.md §3.3 + §3.4 + §3.6 and §6
commit 2.

Files:
- .github/workflows/ci.yml — 3 jobs: node-version 20 → 22, step
  name "Set up Node.js 20" → "Set up Node.js" (drop version per
  plan OQ-5 so future bumps don't drag name edits)
- .github/workflows/security.yml — same pattern, 1 job
- .nvmrc — new file, single line "22" (per plan OQ-3)

No effect on contributors who don't use nvm. No effect on the
Lambda runtime (separate concern from Commit 1).
```

### Commit 3 — `docs: ENGINEERING_STANDARDS + ROADMAP — record Node 22 upgrade complete`

- **Scope.** Two files:
  - `.agents/ENGINEERING_STANDARDS.md` line 63 — `Node 20.x` →
    `Node 22.x` in the Prerequisites bullet.
  - `.agents/ROADMAP.md` — move the "Node 22 LTS upgrade" entry
    from "Tech debt" (line 37) to the bottom of "Completed audits
    / one-time work" with the format:
    `**2026-05-19: Node 22 LTS upgrade** — Lambda runtime
    nodejs20.x → nodejs22.x across api-stack + auth-stack (56
    Lambdas), esbuild target node20 → node22, CI/security
    workflows pinned to Node 22, .nvmrc added. Recon report and
    plan in .agents/node22-lts-upgrade-plan.md.`
- **Atomic boundary justification.** Doc-only sweep recording
  the same logical event ("Node 22 upgrade landed"). Splitting
  ROADMAP entry-move and ENGINEERING_STANDARDS line-edit into
  separate commits would fragment one doc-update event into two,
  which §6 atomic-boundary test #2 rules against.
- **Verify.**
  1. **No stale `Node 20.x` reference** in ENGINEERING_STANDARDS.
     - Bash: `grep -n "Node 20\.x" .agents/ENGINEERING_STANDARDS.md`
     - PowerShell: `Select-String -Pattern 'Node 20\.x' -Path .agents/ENGINEERING_STANDARDS.md`
     Both must return **zero matches**.
  2. **`Node 22.x` is present at line 63.**
     - Bash: `grep -n "Node 22\.x" .agents/ENGINEERING_STANDARDS.md`
     - PowerShell: `Select-String -Pattern 'Node 22\.x' -Path .agents/ENGINEERING_STANDARDS.md`
     Both must return the updated line at line 63.
  3. **ROADMAP entry lives under "Completed audits."** Visual
     inspection or:
     - Bash: `grep -n "Node 22 LTS upgrade" .agents/ROADMAP.md`
     - PowerShell: `Select-String -Pattern 'Node 22 LTS upgrade' -Path .agents/ROADMAP.md`
     Result must show a single line whose line-number sits below
     the `## Completed audits / one-time work` header (line 62
     pre-edit; new line number after the move).
  4. **"Tech debt" section no longer has a Node-22-upgrade
     entry.** Visual inspection of `.agents/ROADMAP.md` lines
     33–43 (the Tech debt block) confirms removal.
- **Commit message:**

```
docs: ENGINEERING_STANDARDS + ROADMAP — record Node 22 upgrade complete

Per .agents/node22-lts-upgrade-plan.md §3 closure step and
ENGINEERING_STANDARDS §11 (any change to a documented surface
updates the doc in the same commit chain).

- ENGINEERING_STANDARDS §2 line 63: Node 20.x → Node 22.x in
  Prerequisites bullet (CONTEXT.md doesn't pin a version, so no
  edit there)
- ROADMAP.md: "Node 22 LTS upgrade" entry moves from Tech debt to
  Completed audits / one-time work with 2026-05-19 completion
  date and a one-line summary of the upgrade outcome

Plan doc itself stays in .agents/ as the audit trail per §4
"preserved indefinitely" lifecycle rule. Recon report findings
are captured inline in the plan doc and need no separate doc.
```

---

## 7. Rollback story

Per-commit. Each entry is the one-line undo path.

- **Commit 1.** `git revert <SHA> && cd infrastructure && npx cdk
  deploy --require-approval never`. CloudFormation reverts each
  Lambda's `Runtime` property from `nodejs22.x` to `nodejs20.x`
  and re-uploads the prior asset hash (the `target: "node20"`
  bundle) under each `S3Key`. Misalignment window: ~5–10 minutes
  while CloudFormation iterates. No data impact; functions
  continue serving traffic on whichever runtime is currently
  active at each moment. Lambdas-in-flight at the time of revert
  finish on their started runtime version.
- **Commit 2.** `git revert <SHA>`. No deploy. CI workflows
  return to `node-version: 20` on the next workflow run; the
  `.nvmrc` file is deleted. nvm users would need to manually
  switch back to Node 20 with `nvm use 20` after pulling.
- **Commit 3.** `git revert <SHA>`. Doc-only; no deploy.
  ROADMAP entry moves back to "Tech debt"; ENGINEERING_STANDARDS
  line 63 reverts to `Node 20.x`.

**Compound rollback** (whole upgrade). `git revert` commits 3 →
2 → 1 in reverse order, with `cdk deploy` after Commit 1's revert
lands. Returns the system to pre-upgrade state with the AWS
`nodejs20.x` runtime live. **Note:** AWS Phase 1 deprecation is
still active for `nodejs20.x` (2026-04-30 onward) — reverting
puts the system back on a deprecated runtime that will not
receive security patches. Rollback is therefore an emergency-only
escape valve, not a real option for steady-state operation.
Surface this in the post-mortem if a rollback ever occurs.

---

## 8. Open questions

> **Status:** all 7 OQs LOCKED 2026-05-19 by the user during plan
> handoff. Each OQ closes with a `**Locked: (X)**` marker and
> rationale per §4. Reversal triggers recorded inline where
> applicable.

### OQ-1 — Single-commit infra change vs split by stack

Both `api-stack.ts` and `auth-stack.ts` contain
`Runtime.NODEJS_20_X` references. The infra change can land as
one commit (both files) or two (one per stack).

- (A) **One commit covering both stacks.** Single logical unit
  ("Lambda runtime upgrade"); cross-stack atomicity per
  ENGINEERING_STANDARDS §5 pattern 1; smaller commit chain.
- (B) **Two commits, one per stack.** More granular revertability
  per stack, but introduces a misalignment window where one stack
  is on Node 22 and the other is on Node 20 — exactly the
  cross-Lambda drift class that §5 pattern 1 codifies as an
  anti-pattern.

**Locked: (A).** One infra commit covering both stacks. Per §5
pattern 1, leaving the auth stack on Node 20 while the api stack
is on Node 22 (or vice versa) is drift class — not acceptable
even briefly. The atomic boundary is "Lambda runtime upgrade,"
not "one CDK file at a time." No reversal trigger; the principle
is durable.

### OQ-2 — Windows local toolchain

Windows is on Node v24.15.0 (recon §H). Lambda runtime is moving
to nodejs22.x. Options:

- (A) **Accept Node 24 locally, deploy to nodejs22.x.** esbuild's
  `target: "node22"` decouples local Node from emitted bundle.
  Tests on Node 24 catch the same bugs Node 22 tests catch in
  practice (Node 24 is a strict superset of Node 22 for the APIs
  we use). Zero setup friction tonight.
- (B) **Install Node 22 via nvm-windows** (~10 min, requires
  elevated PowerShell). Gives strict local-runtime parity and
  easy version-switching going forward. More upfront work.
- (C) **Direct Node 22 msi install over-top v24.15.0.** Loses
  v24 access; not recommended.

**Locked: (A).** Accept Node 24 locally. esbuild's target flag
bridges the version gap on the bundle side; Jest test parity
between Node 24 and Node 22 is high enough that the upgrade
doesn't justify ~10 minutes of toolchain churn tonight. Reversal
trigger: the first bug where local Node 24 behavior diverges from
deployed nodejs22.x Lambda behavior — at that point install
Node 22 via nvm-windows and add to the Phase-D follow-up list.

### OQ-3 — `.nvmrc` add

The repo currently has no `.nvmrc` at root (recon §E + §F). The
upgrade can either add one or skip.

- (A) **Add `.nvmrc` with `22`.** Single line, no
  dependencies-on-the-file from CI (CI uses `actions/setup-node`
  explicitly). nvm users on any machine get auto-version-select
  on `cd` into the project. Trivial to revert if it turns out to
  cause friction.
- (B) **Skip — let each contributor manage version.** Smaller
  diff. But puts coordination burden on every nvm user.

**Locked: (A).** Add `.nvmrc`. Cost is one file with one line;
benefit is "every nvm user is auto-on-the-right-version" forever.
The current single-contributor state means the benefit is small
today, but the file rides with the repo and pays off the first
time a second contributor pulls and uses nvm. No reversal
trigger.

### OQ-4 — Amplify console Node version

`amplify.yml` doesn't pin a Node version (recon §G), but the
Amplify console exposes a Build settings override invisible to
git. Three handling options:

- (A) **Verify post-deploy as a manual step.** Built into Commit
  1's verify list (per §5.3); if console value is set to 20,
  update to 22 manually with a screenshot or commit-body note.
- (B) **Document in OPERATIONS.md as known doc-state.** Defer to
  Session A's OPERATIONS.md skeleton (per the P0 hardening plan).
- (C) **Investigate now as part of recon.** Would extend tonight
  with a console-state audit that doesn't change source.

**Locked: (A).** Manual verification step in Commit 1's verify
list. The console state is the authoritative truth for what
Amplify uses; the right time to check it is when we're already in
the deploy-and-verify cycle, not as a separate audit. If a
mismatch surfaces, capture the state in the Commit 1 body and
file an OPERATIONS.md follow-up entry. Reversal trigger: a
second contributor's Amplify build runs on a different Node
version than the local nvm or `actions/setup-node` Node — at
that point the doc-state-tracking question (option B) re-opens
formally.

### OQ-5 — Step name strings in CI workflows

The GitHub Actions steps currently read `name: "Set up Node.js
20"`. Options:

- (A) **Update name to "Set up Node.js 22"** alongside the
  version change. Names match versions, but next bump (Node 24
  in ~2 years) requires two-line edits per job.
- (B) **Drop the version from the name: `"Set up Node.js"`.**
  More durable; the version-source-of-truth becomes the
  `node-version:` field alone. Next bump is a one-line edit per
  job.
- (C) **Leave name pinned to 20.** Will be silently misleading
  after this commit. Hard reject.

**Locked: (B).** Drop the version from the step name. The
`node-version: 22` field IS the version source of truth; the
step name is a human label that doesn't need to duplicate the
machine-readable value. Future runtime bumps become a one-line
edit per job, not two. No reversal trigger; this is a durable
shape for the workflow.

### OQ-6 — Backend Lambda bundle target matches runtime

esbuild's `target` field controls feature-downleveling. If
`target: "node22"` emits ES2024 syntax but the runtime is
nodejs20.x, the bundle would fail to parse on cold start.
Recon §A.3 confirmed Node 22 supports `target: "node22"`'s emitted
features.

- (A) **Lock target to match runtime: `target: "node22"`.**
  Bundle uses every Node 22 feature esbuild emits; no
  downleveling overhead; clean signal that target and runtime
  agree.
- (B) **Use a lower target like `target: "node20"` for "safety."**
  Defeats the purpose of upgrading — we lose access to v8 12.4's
  optimizations and ES2024-targeted output. Reject.

**Locked: (A).** Target and runtime locked together at "node22".
Per §3.1's "Why both lines change together" note: drifting
target above runtime fails at cold-start; drifting target below
runtime wastes the upgrade. They move in lockstep. No reversal
trigger; future Node 24 upgrade flips both fields together.

### OQ-7 — Bundle hash churn disclosure in Commit 1 message

Per recon §I, the upgrade triggers 56 Lambda S3Key updates in
`cdk diff` because every Lambda re-bundles under the new esbuild
target. A future reader looking at the commit blind might think
something exploded.

- (A) **Commit body explicitly states "56 Lambda S3Key updates
  expected, this is normal — see plan §6 commit 1 verify step
  and recon §I (bundle hash impact)."** Pre-empts confusion.
- (B) **Don't mention; let the diff speak.** Smaller commit body,
  but future readers might think the upgrade was buggy.

**Locked: (A).** Explicit disclosure in the commit body. The
56-Lambda churn is non-obvious to a reader who doesn't already
know the bundle hash incorporates the esbuild target. Calling it
out by name in the commit body removes a "wait, what?" moment for
anyone reading `git log` six months from now. No reversal trigger;
the disclosure is a one-time message attached to one commit.

---

*Plan complete. Ready for Phase D (execute) once user reviews
§3 / §6 / §7 / §8 verbatim per the Phase C brief.*
