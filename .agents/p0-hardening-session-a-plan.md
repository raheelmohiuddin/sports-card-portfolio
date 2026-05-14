# P0 Hardening — Session A — Implementation Plan

> Drafted 2026-05-14. Recon completed in same session; findings drive
> §3 / §5 / §8. **OQs in §8 are surfaced but UNLOCKED** pending user
> review — no implementation commit lands until every §8 OQ carries a
> `**Locked: (X)**` marker per §4. Companion to
> [mark-as-sold-plan.md](./mark-as-sold-plan.md) and
> [potential-acquisitions-plan.md](./potential-acquisitions-plan.md) —
> same shape, same conventions.

---

## 1. Overview

The infrastructure currently runs with **1-day RDS backup retention**
(AWS default, never explicitly set in CDK) and **zero CloudWatch
alarms** — `aws cloudwatch describe-alarms` returns empty. Both are
P0-class gaps for a system approaching its first non-Raheel user.
Session A closes both, ships an SNS notification path so alarms reach
a human, and lands the operational documentation that §11 forces to
ship alongside the documented surfaces.

Concretely, Session A ships:

1. **RDS backup retention bumped 1 → 7 days** via a single new prop on
   the existing `rds.DatabaseCluster` construct in
   `infrastructure/lib/database-stack.ts`. Aurora always provides
   point-in-time recovery within the retention window, so the bump
   widens PITR coverage automatically — no separate toggle.
2. **CloudWatch alarms** across three surfaces: Lambda (Errors,
   Throttles), RDS Aurora Serverless v2 (CPUUtilization,
   DatabaseConnections, FreeableMemory, ACUUtilization), and API
   Gateway HttpApi v2 (5xx, 4xx, Latency). Target count **8–12
   alarms**; concrete list locked in OQ-2. Aggregate-Lambda vs
   per-Lambda alarming locked in OQ-1.
3. **SNS topic + email subscription** as the alarm notification path.
   Subscription target locked in OQ-4.
4. **New file `infrastructure/lib/monitoring-stack.ts`** as the home
   for alarms + SNS topic. Mirrors the existing
   `Construct`-nested-under-`MainStack` pattern (the other "stacks"
   are also Constructs — see Recon §D).
5. **Skeleton `.agents/OPERATIONS.md` and `.agents/INCIDENT_RESPONSE.md`**
   with only the sections this rollout's code surfaces actually
   populate (Backup + Monitoring for OPERATIONS, alarm-driven severity
   classification for INCIDENT_RESPONSE). Other sections (deploy
   procedures, on-call rotation, post-incident review) are stubbed
   with `TODO before first non-Raheel user lands`. Scope discipline
   locked in OQ-7 / OQ-8.
6. **`CONTEXT.md` + `ROADMAP.md` updates** in the same commit chain
   per §11 (any change to a documented surface updates the doc in the
   same chain).

**Session A explicitly does NOT do:**

- **Enable RDS storage encryption.** Aurora supports `StorageEncrypted`
  only at cluster creation; the live cluster was created with the
  default (false) and flipping it requires snapshot → restore-to-new-
  encrypted-cluster → cutover. This is multi-hour migration work,
  parked separately (see OQ-9).
- **Adopt a custom RDS parameter group.** Cluster currently uses
  `default.aurora-postgresql16`. No current need; parked (OQ-9).
- **Populate the full operational doc set.** Deploy procedures,
  on-call rotation, post-incident review template, full sev-matrix
  rollback runbooks — all stubbed but not populated. Trigger to fill
  them: per §12, before the first non-Raheel user lands. Session A is
  ahead of that trigger by design (the alarm code change is what
  forces both docs to exist *at all*, per §11) but does not get used
  as an excuse to write the whole doc speculatively.
- **Add per-Lambda dead-letter queue alarms.** Lambdas don't currently
  have DLQs configured. DLQ rollout is a separate change; parking
  noted in §5 to consider in a future hardening session.

The rollout produces **5 commits, 2 separate `cdk deploy` invocations**
(commits 1 and 2 deploy infrastructure; commits 3/4/5 are doc-only).
See §6 for the full sequence.

---

## 2. Schema changes

**N/A.** No database migration is involved in Session A. Backup
retention is an RDS cluster *property* (the `BackupRetentionPeriod`
field on the cluster, set via CDK's `backup.retention`), not a schema
change. The §7 process — numbered migration files under
`backend/db/migrations/` — does not apply here. The retention bump
deploys via `cdk deploy` like any other CloudFormation property change,
not via `psql` against a migration file.

---

## 3. Backend changes (file-by-file)

Four CDK files. No application-layer Lambdas are touched.

### 3.1 `infrastructure/lib/database-stack.ts`

Single additive change inside the existing
`new rds.DatabaseCluster(this, "Cluster", { ... })` constructor (lines
37–52 today): add a `backup` prop.

```ts
this.cluster = new rds.DatabaseCluster(this, "Cluster", {
  engine: rds.DatabaseClusterEngine.auroraPostgres({
    version: rds.AuroraPostgresEngineVersion.VER_16_4,
  }),
  serverlessV2MinCapacity: 0.5,
  serverlessV2MaxCapacity: 4,
  writer: rds.ClusterInstance.serverlessV2("writer"),
  vpc: this.vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  securityGroups: [this.dbSecurityGroup],
  defaultDatabaseName: "cardportfolio",
  credentials: rds.Credentials.fromGeneratedSecret("dbadmin"),
  enableDataApi: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  deletionProtection: true,
  // ─── NEW ───────────────────────────────────────────────────────
  backup: {
    retention: cdk.Duration.days(7),
    preferredWindow: "<per OQ-5>",   // e.g. "06:00-06:30"
  },
});
```

`preferredWindow` value is locked in OQ-5. No other property in the
constructor is touched; this is the smallest possible diff for the
backup change.

**Deploy behavior.** CloudFormation will update the existing cluster
in-place — `BackupRetentionPeriod` is mutable on a live Aurora cluster
(no replacement). Misalignment window is the duration of the
CloudFormation API call (~30s). PITR recovery for points *before* the
deploy is bounded by the old 1-day window until 7 days have elapsed,
then the full new window is available.

### 3.2 `infrastructure/lib/monitoring-stack.ts` (NEW FILE)

New `Construct` nested under `MainStack`, mirroring the existing
pattern used by `AuthStack`, `StorageStack`, etc. Outline:

```ts
import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubs from "aws-cdk-lib/aws-sns-subscriptions";
import * as rds from "aws-cdk-lib/aws-rds";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";

interface MonitoringStackProps {
  cluster: rds.DatabaseCluster;
  httpApi: apigwv2.HttpApi;
  // Optional, populated only if OQ-1 locks (B) or (C):
  criticalLambdas?: readonly { name: string; fn: lambda.IFunction }[];
  alertEmail: string;
}

export class MonitoringStack extends Construct {
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id);

    // ─── SNS notification path ──────────────────────────────────
    this.alertTopic = new sns.Topic(this, "AlertTopic", {
      displayName: "Collector's Reserve alerts",
    });
    this.alertTopic.addSubscription(
      new snsSubs.EmailSubscription(props.alertEmail)
    );
    const alarmAction = new cwActions.SnsAction(this.alertTopic);

    // ─── Lambda layer alarms (per OQ-1 locked answer) ───────────
    // ─── RDS layer alarms ───────────────────────────────────────
    // ─── API Gateway HttpApi v2 layer alarms ────────────────────
    // — Concrete metric / threshold / evaluation period per OQ-2 —
  }
}
```

**Alarm definitions deferred to OQ-2 lock.** The structure is fixed
(three metric "layers", one `alarmAction` shared across all alarms);
the specific alarm constructor calls land after OQ-1 and OQ-2 lock.

**HttpApi v2 metric names (Recon §F.5).** Lock the v2 names —
`5xx`, `4xx`, `Latency`, `IntegrationLatency`, `Count` — namespace
`AWS/ApiGateway`, dimension `ApiId`. **Not** the v1 REST API names
(`5XXError` etc.); using those silently yields no data.

**Aurora Serverless v2 capacity signal.** `FreeStorageSpace` is not
the relevant low-headroom signal for Aurora Serverless v2 (storage
auto-scales). The actionable capacity signal is **`ACUUtilization`**
nearing the configured `serverlessV2MaxCapacity` (currently 4) — the
trigger to bump the max. OQ-2 includes this alarm; thresholds are
locked there.

### 3.3 `infrastructure/lib/main-stack.ts`

Wire the new MonitoringStack into the construct tree. Order:
instantiate AFTER `api` so we can pass the HttpApi reference in.

```ts
const api = new ApiStack(this, "Api", { /* existing props */ });
new SecurityStack(this, "Security", { apiHostname: api.apiHostname });

// ─── NEW ─────────────────────────────────────────────────────
new MonitoringStack(this, "Monitoring", {
  cluster: database.cluster,
  httpApi: api.httpApi,                  // requires §3.4 change
  criticalLambdas: api.criticalLambdas,  // only if OQ-1 locks (B)/(C)
  alertEmail: "<per OQ-4>",
});
```

### 3.4 `infrastructure/lib/api-stack.ts`

Two minimal exposure changes on the existing `ApiStack` class:

1. Add `public readonly httpApi: apigwv2.HttpApi;` to the class field
   list, and assign at the existing creation site (currently
   `api-stack.ts:623`, where the local `const api` is created — promote
   to `this.httpApi`).
2. **Conditional on OQ-1 / OQ-3.** If OQ-1 locks aggregate-only
   (option A), no Lambda exposure is needed — aggregate Lambda metrics
   have no `FunctionName` dimension and span all functions. If OQ-1
   locks the critical-subset variant (B or C), expose `public readonly
   criticalLambdas: readonly { name: string; fn: lambda.IFunction }[];`
   populated from the existing local Lambda references.

No other change to `api-stack.ts` — every Lambda definition, route,
authorizer, and CORS setting stays intact. Diff is bounded.

---

## 4. Frontend changes (file-by-file)

**N/A.** No frontend code is touched in Session A. The alarm
notifications are email, not in-app; the operational docs are in
`.agents/` (developer-facing, not user-facing); the backup retention
bump is invisible to users.

---

## 5. Operational documentation (flex slot)

§11 requires that every commit changing a documented surface updates
the documenting surface in the same commit chain. Session A changes
two surfaces — RDS backup retention (a fact about the live system)
and the alarm inventory (a fact + an operational procedure). Both are
in `OPERATIONS.md`'s declared scope per §12. Therefore both docs
exist after Session A ships, even though §12's natural triggers
("before first non-Raheel user", "after first incident") have not
strictly fired yet. **This is not speculative writing** — the surfaces
the docs describe are landing in the same chain. Sections beyond what
the chain populates are stubbed, not pre-written.

### 5.1 `.agents/OPERATIONS.md` (NEW)

Skeleton structure with shipping sections populated:

```markdown
# OPERATIONS — Collector's Reserve

> Operational reference for deploys, monitoring, backup, and
> alerting. Per §12, this doc was created during P0 Hardening
> Session A (commit chain landing 2026-05-14ish) to ship alongside
> the alarm and backup-retention surfaces it describes.
>
> Sections marked TODO are stubbed until their trigger fires
> (first non-Raheel user). Do not fill speculatively.

## 1. Backup and recovery       ← POPULATED in commit 3
## 2. Monitoring and alerting    ← POPULATED in commit 3
## 3. Deploy procedures          ← TODO before first non-Raheel user
## 4. On-call basics             ← TODO before first non-Raheel user
## 5. Routine maintenance        ← TODO before first non-Raheel user
```

**§1 Backup and recovery — content:**
- RDS cluster ID + region.
- Backup retention value (7 days) + preferred window (from OQ-5).
- PITR procedure (one-liner: `aws rds restore-db-cluster-to-point-in-time`
  with example timestamp).
- Snapshot listing command.
- Recovery RTO/RPO informal expectations (RPO ≤ 5min from PITR
  granularity; RTO subject to restore time — empirically TBD).
- Cross-reference: "encryption-at-rest currently OFF — see ROADMAP
  parked item; recovery procedures change once encryption ships
  because restored snapshots inherit encryption from the source".

**§2 Monitoring and alerting — content:**
- Alarm inventory table: each alarm name, metric, threshold,
  evaluation period, severity classification, link to §3 of
  INCIDENT_RESPONSE.md for response procedure.
- SNS topic ARN + how to add/remove subscribers.
- How to silence an alarm temporarily (set state to OK via CLI; how
  to find the alarm name).
- Cross-reference to CONTEXT.md alarm inventory (CONTEXT.md is
  authoritative for "what alarms exist"; OPERATIONS.md describes
  "what to do about them").

### 5.2 `.agents/INCIDENT_RESPONSE.md` (NEW)

Skeleton structure with shipping sections populated:

```markdown
# INCIDENT_RESPONSE — Collector's Reserve

> Per §12 / §11, created during P0 Hardening Session A so the
> alarms shipping in the same chain map to documented response
> procedures. Sections marked TODO are stubbed until trigger fires
> (first incident, or first non-Raheel user — whichever first).

## 1. Severity classification     ← POPULATED in commit 4
## 2. First-response actions      ← TODO
## 3. Communication               ← TODO before first non-Raheel user
## 4. Post-incident review        ← TODO after first incident
```

**§1 Severity classification — content:**
- Three-tier sev table (Sev-1 critical, Sev-2 warning, Sev-3 advisory)
  with the concrete alarms from this rollout mapped into each tier.
- Each alarm cited by its CloudWatch alarm name (matching commit 2's
  deployed names) so there is zero translation friction between an
  alarm email landing in the inbox and looking it up in this doc.
- One-line "first-glance interpretation" per alarm — what the
  threshold actually means and the first hypothesis before
  investigation.

### 5.3 `.agents/CONTEXT.md` updates

CONTEXT.md is the authoritative descriptive doc per §11. Updates in
commit 5:
- §8 (or wherever schema / infrastructure facts live) records the new
  7-day backup retention and the SNS topic ARN.
- New subsection: **Alarm inventory** — same table as OPERATIONS.md
  §2 but in CONTEXT.md it's the "what exists" reference; OPERATIONS.md
  is the "what to do" reference. Cross-link both ways.
- Reference to the parked StorageEncrypted gap.

### 5.4 `.agents/ROADMAP.md` updates

Three edits in commit 5:
- **Add to "Completed audits / one-time work":** "2026-05-14: P0
  hardening Session A — backup retention 1→7d, 8–12 CloudWatch alarms
  on Lambda/RDS/HttpApi, SNS notification path, OPERATIONS.md +
  INCIDENT_RESPONSE.md skeletons." Pattern matches the existing
  2026-05-13 API key audit entry.
- **Add to "Tech debt":** "RDS storage encryption migration —
  cluster currently `StorageEncrypted: false`. Aurora supports
  `StorageEncrypted` only at cluster creation; flipping requires
  snapshot → restore-to-new-encrypted-cluster → cutover. Trigger: any
  PII/PHI scope expansion OR compliance requirement OR before first
  non-Raheel user. Size: M (multi-hour, downtime window required)."
- **Add to "Tech debt":** "Custom RDS parameter group — cluster
  currently on `default.aurora-postgresql16`. No immediate trigger;
  revisit when a parameter change is needed (logging tuning, slow
  query log, etc). Size: S."

---

## 6. Commit sequence

Five commits, in deploy order. Two `cdk deploy` invocations gate
commits 1 and 2; commits 3/4/5 are doc-only and don't deploy.

### Commit 1 — `db: bump RDS backup retention 1d → 7d`

- **Scope.** Single file: `infrastructure/lib/database-stack.ts`. Adds
  the `backup` prop per §3.1.
- **Verify.**
  1. `npm run cdk -- diff` shows only `BackupRetentionPeriod 1 → 7`
     and `PreferredBackupWindow` change on the cluster — no other
     resource is touched.
  2. `npm run cdk -- deploy` succeeds in one pass.
  3. `aws rds describe-db-clusters --query 'DBClusters[*].[BackupRetentionPeriod,PreferredBackupWindow]' --output table`
     returns `7` and the OQ-5-locked window.

### Commit 2 — `monitoring: add CloudWatch alarms + SNS topic + monitoring-stack`

- **Scope.** Three files:
  - `infrastructure/lib/monitoring-stack.ts` (new).
  - `infrastructure/lib/main-stack.ts` (wires new construct in).
  - `infrastructure/lib/api-stack.ts` (exposes `httpApi`, and
    `criticalLambdas` only if OQ-1 locks B/C).
- **Atomic boundary justification.** These three changes share a
  single logical unit — the alarm infrastructure cannot land without
  the wiring or the exposure. §6 atomic-boundary test #2 (single-line
  summary): "add CloudWatch alarms" — no "and" needed. ✓
- **Verify.**
  1. `npm run cdk -- diff` shows: 1 SNS topic, 1 SNS email
     subscription, OQ-2-count alarms, IAM permissions for CloudWatch
     → SNS Publish.
  2. `npm run cdk -- deploy` succeeds.
  3. Email subscription confirmation arrives at OQ-4-locked address;
     confirm via the link in the email (manual step — SNS requires
     subscriber confirmation before delivery).
  4. `aws cloudwatch describe-alarms --query 'length(MetricAlarms)' --output text`
     returns the OQ-2-locked count.
  5. End-to-end notification test: pick one alarm (suggest
     `Lambda-Errors-Aggregate` since it's safe to flip), run
     `aws cloudwatch set-alarm-state --alarm-name <name>
     --state-value ALARM --state-reason "smoke test"`; confirm email
     lands; reset state to OK.

### Commit 3 — `docs: OPERATIONS.md skeleton + backup + monitoring sections`

- **Scope.** Single file: `.agents/OPERATIONS.md` (new). Skeleton per
  §5.1; §1 and §2 populated; §3–§5 stubbed as TODO.
- **Verify.** File exists. Backup retention value cited matches the
  live cluster post-commit-1 deploy (7 days). Alarm inventory table
  matches the alarms actually deployed in commit 2 — every row in
  the doc table has a corresponding `aws cloudwatch describe-alarms`
  entry; every deployed alarm has a row.

### Commit 4 — `docs: INCIDENT_RESPONSE.md skeleton + alarm-driven severity`

- **Scope.** Single file: `.agents/INCIDENT_RESPONSE.md` (new).
  Skeleton per §5.2; §1 populated with severity table; §2–§4 stubbed.
- **Verify.** Every alarm name in the severity table matches a
  deployed alarm name (zero translation between alarm email and doc
  lookup). Severity tiering is internally consistent (no alarm
  assigned to multiple sevs).

### Commit 5 — `docs: CONTEXT.md + ROADMAP — record P0-hardening-A outcomes`

- **Scope.** Two files: `.agents/CONTEXT.md`, `.agents/ROADMAP.md`.
  Edits per §5.3 / §5.4.
- **Verify.** CONTEXT.md alarm-inventory subsection matches
  OPERATIONS.md §2 and the live `describe-alarms` output. ROADMAP has
  one new "Completed audits" entry and two new "Tech debt" entries
  (StorageEncrypted, custom parameter group). No deletion of existing
  ROADMAP entries.

---

## 7. Rollback story

Per-commit. Each entry is the one-line undo path.

- **Commit 1.** `git revert <SHA> && npm run cdk -- deploy`. CloudFormation
  reverts `BackupRetentionPeriod` to 1. PITR window narrows back to
  1 day from the moment the revert deploys. Existing automated
  snapshots already retained for 7 days are not deleted by the
  revert — they age out on their original 7-day schedule.
- **Commit 2.** `git revert <SHA> && npm run cdk -- deploy`. CDK tears
  down MonitoringStack: every alarm deleted, SNS topic deleted, email
  subscription deleted (subscriber will need to re-confirm if/when we
  redeploy — there's no way around this). No effect on application
  Lambdas or the cluster.
- **Commit 3.** `git revert <SHA>`. Doc-only; no deploy. Deletes the
  `.agents/OPERATIONS.md` file. Note that alarms remain deployed but
  undocumented operationally until re-landed — this is *worse* than
  the pre-Session-A state for incident response, so reverting commit 3
  in isolation is rarely the right move. Prefer to revert commits 2 +
  3 together.
- **Commit 4.** `git revert <SHA>`. Doc-only; no deploy. Same
  "deployed-but-undocumented" caveat as commit 3.
- **Commit 5.** `git revert <SHA>`. Doc-only; no deploy. CONTEXT.md
  and ROADMAP.md edits revert; the ROADMAP "Completed audits" entry
  is removed, the two parked Tech-debt entries are removed.

**Compound rollback** (whole session). `git revert` commits 5 → 4 → 3 →
2 → 1 in reverse order, with `cdk deploy` after commits 2 and 1's
reverts land. Returns the system to pre-Session-A state.

---

## 8. Open questions

> **Status:** all 9 OQs LOCKED 2026-05-14 (same session as draft and
> recon). Each OQ closes with a **Locked: (X).** marker and rationale
> per §4. Reversal triggers recorded inline where applicable.

### OQ-1 — Aggregate vs per-Lambda alarms

Lambda Errors/Throttles metrics are available with or without a
`FunctionName` dimension. With the dimension, you get per-function
alarms (one per Lambda × per metric). Without, you get one
account/region-wide alarm covering every Lambda. The choice drives
total alarm count, alarm-fatigue risk, and signal granularity.

- (A) **Aggregate (no `FunctionName` dimension).** One Lambda-Errors
  alarm + one Lambda-Throttles alarm covering all Lambdas in the
  account/region. ~2 alarms total at this layer. Pros: simple, low
  count, near-zero alarm fatigue. Cons: when it fires, you don't know
  *which* Lambda from the alarm alone — you go to CloudWatch logs to
  identify the offender.
- (B) **Per-Lambda for a hand-picked "critical" subset.** Define a
  small set of user-facing handlers (suggest: `get-portfolio`,
  `list-pas`, `get-value`, `mark-sold`, `get-cards`, `add-card`) and
  alarm each individually on Errors + Throttles. Aggregate alarm
  covers the rest. ~6 critical × 2 metrics + 2 aggregate = ~14 alarms
  at the Lambda layer alone — pushes total over 12.
- (C) **Per-Lambda for all.** ~40+ alarms. Over budget and high
  alarm-fatigue risk.

**Recon recommendation:** (A). Rationale: the system is single-operator,
CloudWatch logs are immediately accessible for fault isolation, and
alarm-fatigue prevention matters more at this stage than per-function
granularity. Reversal trigger: first non-Raheel-user incident where
the aggregate alarm fires but log investigation takes >15min to
identify the failing Lambda.

**Locked: (A).** Aggregate Lambda alarms only — one
`Lambda-Errors-Aggregate` + one `Lambda-Throttles-Aggregate`, no
`FunctionName` dimension. System is single-operator; CloudWatch logs
are immediately accessible for fault isolation; alarm-fatigue
prevention matters more at this stage than per-function granularity.
Reversal trigger: first non-Raheel-user incident where the aggregate
alarm fires but log investigation takes >15min to identify the
failing Lambda.

### OQ-2 — Final alarm list with concrete thresholds

Depends on OQ-1. Below is the **default list contingent on OQ-1 = (A)**.
If OQ-1 locks (B), add 6 × 2 = 12 per-Lambda alarms on top.

| # | Alarm name | Namespace | Metric | Statistic | Threshold | Period × Eval | Severity |
|---|---|---|---|---|---|---|---|
| 1 | `Lambda-Errors-Aggregate` | AWS/Lambda | Errors | Sum | > 5 | 5min × 1 | Sev-1 critical |
| 2 | `Lambda-Throttles-Aggregate` | AWS/Lambda | Throttles | Sum | > 0 | 5min × 1 | Sev-1 critical |
| 3 | `RDS-CPU-High` | AWS/RDS | CPUUtilization | Average | > 80% | 5min × 2 | Sev-2 warning |
| 4 | `RDS-Connections-High` | AWS/RDS | DatabaseConnections | Average | > 80 | 5min × 1 | Sev-2 warning |
| 5 | `RDS-FreeableMemory-Low` | AWS/RDS | FreeableMemory | Average | < 100MB | 5min × 2 | Sev-1 critical |
| 6 | `RDS-ACU-NearMax` | AWS/RDS | ACUUtilization | Average | > 87.5% (~3.5 of 4) | 5min × 2 | Sev-2 warning |
| 7 | `HttpApi-5xx-High` | AWS/ApiGateway | 5xx | Sum | > 5 | 5min × 1 | Sev-1 critical |
| 8 | `HttpApi-4xx-High` | AWS/ApiGateway | 4xx | Sum | > 50 | 5min × 1 | Sev-3 advisory |
| 9 | `HttpApi-Latency-High` | AWS/ApiGateway | Latency | p99 | > 3000ms | 10min × 1 | Sev-2 warning |

Total: **9 alarms** under OQ-1 = (A). Within the 8–12 target.

Notes:
- All RDS alarms have `DBClusterIdentifier` dimension set to the live
  cluster's ID (Recon §E).
- HttpApi alarms have `ApiId` dimension set to the `api.httpApiId`
  output.
- `RDS-ACU-NearMax` is the "low headroom" signal for Aurora Serverless
  v2 — the actionable trigger is "bump `serverlessV2MaxCapacity`". Not
  `FreeStorageSpace` (storage auto-scales on Aurora; the metric is
  not actionable here).
- `RDS-FreeableMemory-Low` on Aurora Serverless v2 fires only when
  the cluster has scaled to `serverlessV2MaxCapacity` AND physical
  memory is near-exhausted. It is **not** redundant with
  `RDS-ACU-NearMax`: per AWS docs, the FreeableMemory metric is
  inflated by ~2 GiB per ACU of unused headroom below max, so it
  stays high until max ACU is reached. The two alarms fire in
  sequence (ACU-NearMax first as warning; FreeableMemory-Low after,
  only if max ACU was insufficient), not in parallel. Future readers:
  do not mistake this for a duplicate of `RDS-ACU-NearMax`.
- Threshold values are conservative defaults. Tune after first week
  of real traffic data — record any tuning as a separate "monitoring:
  tune <alarm> threshold" commit per §6 atomicity.

- (A) **Accept the table above as locked.**
- (B) **Modify specific rows.** Specify which.
- (C) **Defer locking until after the first cdk diff** to ground
  thresholds in real metric history. Not recommended — locking now
  with explicit reversal triggers is the §4 pattern.

**Recon recommendation:** (A) if OQ-1 locks (A); the table contingent
on (B)/(C) needs to be expanded per OQ-1's locked answer.

**Locked: (A).** Accept the 9-alarm table as drafted, with the
Serverless v2 clarifying note added to the Notes block above.
9 alarms is within the 8–12 budget; all metric names verified for
HttpApi v2 (`5xx`/`4xx`/`Latency`, not v1's `5XXError`);
`RDS-FreeableMemory-Low` is a meaningful independent terminal-state
signal — not redundant with `RDS-ACU-NearMax` because on Aurora
Serverless v2 the metric is inflated by ~2 GiB per spare ACU and only
approaches actual physical free when the cluster has scaled to max.
Thresholds are conservative defaults — tune after first week of real
traffic via separate `monitoring: tune <alarm> threshold` commits per
§6 atomicity.

### OQ-3 — ApiStack → MonitoringStack interface

What does `ApiStack` expose for MonitoringStack to alarm on?

- (A) **`public readonly httpApi` only.** Sufficient if OQ-1 = (A) —
  aggregate Lambda metrics need no Lambda references.
- (B) **`public readonly httpApi` + `public readonly lambdas: Record<string, IFunction>`.**
  Full map. Future-proof; lets future hardening sessions add per-Lambda
  alarms without further ApiStack changes.
- (C) **`public readonly httpApi` + `public readonly criticalLambdas: readonly { name: string; fn: IFunction }[]`.**
  Hand-picked subset, defined per OQ-1 = (B).

**Recon recommendation:** matches OQ-1's lock. If OQ-1 = (A) → choose
(A) here. If OQ-1 = (B) → choose (C). (B) is acceptable as
forward-looking but exposes more surface than Session A uses.

**Locked: (A).** Expose `httpApi` only. With OQ-1 = (A), no per-Lambda
exposure is needed for Session A. Forward-investment in (B) is
tempting but violates the "don't write speculatively" discipline —
expose what we use, expose more when we need it. When per-Lambda
alarms ship (post-reversal-trigger of OQ-1), add the exposure in that
commit chain. Reversal trigger: OQ-1 reversal fires, which would also
trigger this.

### OQ-4 — SNS subscription target

Where do alarm emails land?

- (A) **`raheel4293@gmail.com` directly.** One subscription.
- (B) **`noreply@<collectors-reserve-domain>` once domain is
  registered** (Recon §F.6 references ROADMAP entry "Swap personal
  email in scp-create-consignment env vars"). Deferred until domain
  exists.
- (C) **Multiple subscriptions** (Raheel + someone else, e.g. a paging
  service). Not relevant pre-team.

**Recon recommendation:** (A). Reversal trigger: domain registration
ships (then move to dedicated alerts inbox); or second contributor
joins (then add their subscription, keeping Raheel's).

**Locked: (A).** `raheel4293@gmail.com` direct subscription. Single
operator, alerts need to reach me, this is the lowest-friction path.
Reversal trigger: domain registration ships (then move to a dedicated
alerts inbox on the domain); or second contributor joins (then add
their subscription, keeping mine).

### OQ-5 — `preferredBackupWindow`

The current live cluster has an AWS-auto-assigned window of
03:44–04:14 UTC. When we explicitly set the `backup` prop, we can
lock the window or leave AWS-auto.

- (A) **Lock to 06:00–06:30 UTC** (= 01:00–01:30 US Central). Low-
  traffic for this app's user base; well clear of the maintenance
  window (sat:06:18–sat:06:48 UTC — overlap on Saturdays but only
  once a week, and Aurora backup/maintenance coexist fine).
- (B) **Lock to 07:00–07:30 UTC** to stagger from the maintenance
  window entirely.
- (C) **Accept AWS auto-assignment.** Cluster keeps 03:44–04:14 UTC.
  Simpler diff but the window is undocumented in IaC.

**Recon recommendation:** (A) or (B). (C) is acceptable but trades a
two-line diff for forever-undocumented timing — operationally
unclean for OPERATIONS.md §1 which wants to record "snapshots are
taken at <X>".

**Locked: (A).** `06:00–06:30 UTC` (= 01:00–01:30 US Central).
Genuinely low-traffic for this app's user base. Documented in IaC
means OPERATIONS.md §1 can cite a concrete window rather than
"AWS-auto." The minor Saturday overlap with the maintenance window
(`sat:06:18-sat:06:48` UTC) is fine — Aurora handles backup and
maintenance simultaneously. No reversal trigger needed unless usage
patterns change significantly.

### OQ-6 — Commit chain ordering

User has indicated preference for 5-commit chain (per the user brief
this plan is responding to). Recon initially flagged a one-big-atomic
alternative.

- (A) **5-commit chain as specified in §6.** Backup (1) → monitoring
  infrastructure (2) → ops docs (3, 4) → context/roadmap (5).
- (B) **3-commit chain.** Combine commits 3+4+5 into one doc-only
  commit ("docs: P0 hardening Session A docs"). Loses per-doc
  revertability.
- (C) **2-commit chain.** Bundle 1+2 into one infrastructure commit,
  3+4+5 into one doc commit. Loses the ability to deploy + verify
  backup retention before alarms are added.

**Recon recommendation:** (A). Per §6's atomic boundary rules, each
of the five commits has a distinct single-line summary, each is
independently revertible, and the deploy granularity matters (commit
1 deploys + verifies independently of commit 2's much larger CDK
diff). User's framing confirmed during planning.

**Locked: (A).** 5-commit chain as specified in §6. Each commit has a
distinct single-line summary, each is independently revertible (with
the §7 partial-revert caveat noted for commits 3 and 4), and deploy
granularity matters between commits 1 and 2 — backup retention
verifies independently of the much larger monitoring-stack diff. The
§6 atomic-boundary tests favor splitting here. No reversal trigger.

### OQ-7 — `OPERATIONS.md` scope discipline

- (A) **Skeleton with shipping sections (Backup, Monitoring) populated;
  others stubbed with TODO and trigger.** Reader sees the doc's full
  intended shape and what's missing.
- (B) **Only the shipping sections exist; other sections are not
  present at all.** Truly minimal; reader doesn't see the gaps.
- (C) **Full doc populated speculatively.** Violates §12 "don't write
  these docs speculatively".

**Recon recommendation:** (A). Discloses what's missing without
writing it.

**Locked: (A).** Skeleton with shipping sections (Backup, Monitoring)
populated; other sections stubbed with TODO and the trigger that fires
them. Honest disclosure of what's missing — reader sees the doc's
full intended shape, and populating the stubs at the
first-non-Raheel-user trigger is a known known. Option (B) hides the
gaps; option (C) violates §12. No reversal trigger; the §12 trigger
drives the next iteration.

### OQ-8 — `INCIDENT_RESPONSE.md` scope discipline

Same shape as OQ-7. Options (A) / (B) / (C) — recon recommendation
(A) for the same reasons.

**Locked: (A).** Same shape as OQ-7 — skeleton with the alarm-driven
severity section populated; first-response, communication, and
post-incident-review sections stubbed with their respective triggers.
Same rationale as OQ-7. No reversal trigger; the §12 triggers drive
the next iteration.

### OQ-9 — Plan-doc parking for side findings

Recon §F surfaced two side findings out-of-scope for Session A.
Confirm both go to ROADMAP under Tech debt (not piled onto Session A).

- (A) **Both go to ROADMAP under Tech debt** per §5.4. StorageEncrypted
  with explicit triggers; custom parameter group as lower-priority.
- (B) **Only StorageEncrypted parks; custom parameter group stays
  undocumented** (revisit only when a parameter change is needed in
  practice).
- (C) **Neither parks** — surface them somewhere else (e.g. a separate
  audit doc).

**Recon recommendation:** (A). The ROADMAP "Tech debt" section is the
project's standing register of parked infrastructure work; both
findings fit cleanly there.

**Locked: (A).** Both side findings park to `ROADMAP.md` under Tech
debt per §5.4. ROADMAP is the project's standing register of parked
infrastructure work; both findings fit cleanly there. The
StorageEncrypted entry includes the multi-hour-migration framing and
explicit triggers (PII/PHI scope expansion OR compliance requirement
OR before first non-Raheel user); the parameter group entry is lower
priority since there's no immediate pressure. No reversal trigger.
