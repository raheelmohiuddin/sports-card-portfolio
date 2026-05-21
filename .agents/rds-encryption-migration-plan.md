# RDS Storage Encryption Migration — Plan

> Drafted 2026-05-20 after Phase 1 recon (the recon-only run captured during the same session). Locked at all 10 open questions per prior conversation. Companion to [.agents/p0-hardening-session-a-plan.md](./p0-hardening-session-a-plan.md) and [.agents/valuation-rebuild-plan.md](./valuation-rebuild-plan.md) — same shape, same conventions.
>
> Closes the **RDS storage encryption migration** Tech debt entry from [ROADMAP.md](./ROADMAP.md), originally surfaced as OQ-9 of [p0-hardening-session-a-plan.md §8](./p0-hardening-session-a-plan.md) and elaborated in [OPERATIONS.md §1 Known gaps](./OPERATIONS.md).

---

## 1. Goal

Flip the live Aurora Serverless v2 PostgreSQL cluster from `StorageEncrypted: false` to `StorageEncrypted: true` using the AWS-managed `alias/aws/rds` KMS key. Approach: manual snapshot-restore into a new encrypted cluster, manual secret-value cutover, end-to-end verification. **Tonight ships:** encrypted cluster + cutover + verification + doc updates + ROADMAP-tracked deferrals. **Tonight defers:** CDK takeover of the new cluster (see §3 two-session structure and §8 deferred items). Target window: ~115 min nominal (90–150 min with variance), with ~10–15 min of operator-controlled downtime during the secret-cutover step.

**Session A explicitly does NOT do:**

- **AWS RDS Blue/Green Deployment.** Explicitly prohibited by AWS docs for the unencrypted→encrypted transition (see §3).
- **CDK takeover of new cluster — deferred to a follow-on session.** CDK source describes the OLD cluster temporarily; explicit guardrail commit message + ROADMAP entry capture the deferral. The `cdk import` flow that adopts the new cluster into CDK management ships in a separate, fresh-headed session. Empirical verification that `AWS::RDS::DBCluster` supports CFN resource import was completed 2026-05-20 (see §3).
- **Custom RDS parameter group.** Separate Tech debt entry in [ROADMAP.md](./ROADMAP.md); not bundled — see OQ-9 lock in §4.
- **Major engine version upgrade.** New cluster inherits PostgreSQL `16.11` from the snapshot. CDK source `VER_16_4` drift fix deferred to the same session as the CDK takeover (see OQ-11 lock revision in §4).
- **Customer-managed KMS key.** Account has zero CMKs; creating one is its own work-stream with compliance implications. AWS-managed `alias/aws/rds` is the simplest default at our scale. OQ-1 lock.
- **Decommission of the old (unencrypted) cluster.** New ROADMAP entry parks this with a 7+ day fallback window — see OQ-10 lock in §4 and §8.

---

## 2. Current state (from 2026-05-20 recon)

Empirical findings from the Phase 1 recon run earlier this same session. Full report (with every tool-call output) preserved in conversation transcript.

| Field | Value |
|---|---|
| Cluster identifier | `sportscardportfolio-databasecluster5b53a178-asr01cwjobbs` |
| Cluster ARN | `arn:aws:rds:us-east-1:501789774892:cluster:sportscardportfolio-databasecluster5b53a178-asr01cwjobbs` |
| CFN logical ID | `DatabaseCluster5B53A178` |
| `StorageEncrypted` | **`false`** |
| `EngineVersion` | **`16.11`** (live), CDK source says `VER_16_4` — drift to fix in same commit |
| Engine mode | `provisioned` with `ServerlessV2ScalingConfiguration: MinCapacity=0.5, MaxCapacity=4.0` |
| `DBClusterParameterGroup` | `default.aurora-postgresql16` (deferred custom group — OQ-9) |
| `PreferredBackupWindow` | `07:00-07:30` |
| `PreferredMaintenanceWindow` | `sat:06:18-sat:06:48` |
| `BackupRetentionPeriod` | `7` |
| `DeletionProtection` | `true` |
| `HttpEndpointEnabled` | `true` (Data API on; new cluster must preserve) |
| `AssociatedRoles` | `[]` |
| `IAMDatabaseAuthenticationEnabled` | `false` |
| `RemovalPolicy` (CDK) | `RETAIN` |
| Secret ARN | `arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM` |
| Secret rotation | `RotationEnabled: null` (disabled) |
| Snapshots | 2 automated (both `StorageEncrypted: false`), 0 manual |
| KMS landscape | `alias/aws/rds` exists but no `TargetKeyId` yet — AWS auto-provisions on first encrypted-RDS operation. Zero customer-managed keys. |
| Data scale | 13 cards (per `cards` row count earlier this session) |
| Other dependencies | None — recon confirmed no cross-account refs, no IAM roles on cluster, no secret rotation Lambda, no scripts/code reading cluster ARN at runtime (Lambdas pull host from secret value via `DB_SECRET_ARN` env var) |

Cluster age: 14 days (`ClusterCreateTime: 2026-05-06T02:49:02 UTC`). Single-operator usage. **Lowest-risk window we'll ever have to do this migration.**

---

## 3. Approach decision

**Locked: (A) Manual snapshot-restore + manual cutover + CDK takeover after.**

Rejected alternatives:

- **(B) AWS RDS Blue/Green Deployment.** Explicitly prohibited by AWS docs ("You can't change an unencrypted DB cluster into an encrypted DB cluster" per [blue-green-deployments-considerations.html](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/blue-green-deployments-considerations.html)). Web doc check completed 2026-05-20; verbatim quote preserved in conversation transcript. The Blue/Green mechanism clones storage volumes (which inherit encryption state), so the limitation is structural, not just policy.
- **(C) CDK-managed replacement with `snapshotIdentifier`.** CFN replacement of stateful resources has known edge cases for Aurora Serverless v2. Highest blast-radius failure mode if mid-replacement fails — CFN may leave the stack in an inconsistent state, recovery is manual.
- **(D) Manual + CDK `fromAttributes`.** Equivalent to (A) on the operator side but pays a permanent IaC concession (cluster lives outside CDK's lifecycle forever). No benefit over (A).

(A) gives operator-visible state at every transition, preserves the old cluster as fallback (via `RemovalPolicy: RETAIN` + `DeletionProtection: true`), and keeps the IaC story repairable post-cutover.

### Two-session structure

This work splits across two sessions (Path C from the plan-review discussion):

- **Tonight (Session 1, this plan):** Steps 1–11 below. Manual snapshot-restore, new encrypted cluster created, secret cutover, end-to-end verification, doc updates, commit. CDK source remains describing the OLD cluster; this drift is named explicitly in the commit message and parked in ROADMAP.
- **Tomorrow (Session 2, separate plan):** `cdk import` flow to adopt the new cluster into CDK management. Empirically verified 2026-05-20 via `aws cloudformation describe-type --type-name AWS::RDS::DBCluster` that the resource type carries `primaryIdentifier: /properties/DBClusterIdentifier`, `read` + `list` handlers, and `ProvisioningType: FULLY_MUTABLE` — all CFN's documented prerequisites for resource import. Multi-step flow (pre-condition secret retention, detach old cluster construct, add new construct with exact-state properties, `cdk import` change set with `--change-set-type IMPORT`, drift detection). Time budget ~1 hour fresh-headed. ROADMAP entry tracks the trigger.

The two-session split is a deliberate scope-cap: shipping the cutover tonight under controlled-step discipline avoids compounding a high-stakes data-resource migration with a complex IaC reconciliation flow whose secret-handling sub-steps need careful drafting.

---

## 4. Open question locks

All 10 OQs locked. Decision tree from recon resolved by web doc verification (OQ-2) and operator preference for low-risk, controlled-step approach.

| # | Decision | Lock | One-line rationale |
|---|---|---|---|
| **OQ-1** | KMS key | **`alias/aws/rds` (AWS-managed)** | Account has zero CMKs; AWS-managed is free, auto-rotated, and operator has no compliance requirement that would justify CMK overhead. |
| **OQ-3** | Downtime tolerance | **≤15 min acceptable** | Single-operator scale; no SLA. Larger windows would compound risk without offsetting benefit. |
| **OQ-4** | Rollback | **Secret-value revert + Lambda cold-start. Old cluster preserved.** | Old cluster's `RemovalPolicy: RETAIN` + `DeletionProtection: true` means it survives unchanged regardless of new-cluster state. Reverting the secret pointer is the minimum operation to fail back. |
| **OQ-5** | Verification | **Pre-cutover row-count baseline + post-cutover full check (counts, /admin UI, Allen Iverson badge, `pg_stat_activity`, `StorageEncrypted=true`, post-cdk-deploy diff zero)** | Multi-layer verification: data integrity (row counts), app functional (UI), connection model intact (pg_stat_activity), encryption verified (DescribeDBClusters), IaC drift zero (cdk diff). |
| **OQ-6** | Secret stability | **Update secret value in-place; same ARN preserved** | Keeps every Lambda's `DB_SECRET_ARN` env var valid without redeploy. Avoids cascade of CDK Lambda updates just to point at a new secret. |
| **OQ-7** | Snapshot age | **Fresh manual snapshot taken immediately pre-cutover** | Smallest data-loss window if rollback needed. Automated snapshots are time-of-day-bound; manual lets us pick the exact pre-cutover moment. |
| **OQ-8** | Cross-account / IAM | **Clean — no additional resources to migrate** | Recon-confirmed: `AssociatedRoles: []`, no rotation Lambda, no cross-account sharing, no IAM DB auth, no scripts read cluster ARN at runtime. |
| **OQ-9** | Custom parameter group bundling | **Defer** | Scope-creep on a high-risk migration. Existing ROADMAP entry survives unchanged; revisit when a specific parameter-tuning trigger fires. |
| **OQ-10** | Old cluster deletion timing | **Keep ≥7 days (until 2026-05-27 minimum). Park as new ROADMAP entry.** | Matches the 7-day backup retention window we set in Session A Commit 2. Provides empirical fallback period before incurring the deletion-protection-disable step. |
| **OQ-11** | Engine version alignment | **Deferred to tomorrow's CDK takeover commit. Same alignment, different timing.** | CDK source stays at `VER_16_4` tonight (no CDK source changes tonight per Path C scope cap). When tomorrow's `cdk import` lands, the imported new cluster's CDK definition specifies `VER_16_11` to match actual state. Same drift fix, deferred timing. |

OQ-2 (approach decision) is the locked subject of §3 above. OQ-2.5 (the web-doc verification gap that locked OQ-2) was resolved by the 2026-05-20 web check.

---

## 5. Execute sequence

11 numbered steps. Each carries: action, command/operation, verification, failure mode. The middle of the chain (Steps 6–8) is the cutover window; everything before is preparation, everything after is documentation + commit. No CDK source changes tonight per Path C scope cap.

### Step 1 — Pre-cutover baseline

**Action.** Capture row counts for cards, users, consignments tables from the live cluster via Data API. Record current timestamp.

**Command.**

```powershell
aws rds-data execute-statement `
  --resource-arn "arn:aws:rds:us-east-1:501789774892:cluster:sportscardportfolio-databasecluster5b53a178-asr01cwjobbs" `
  --secret-arn "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM" `
  --database cardportfolio `
  --region us-east-1 `
  --sql "SELECT (SELECT COUNT(*) FROM cards) AS cards, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM consignments) AS consignments, (SELECT COUNT(*) FROM trades) AS trades, (SELECT COUNT(*) FROM card_shows) AS card_shows;"
```

**Verify.** Counts captured. Record verbatim for Step 5 cross-check.

**Failure mode.** Data API unresponsive → abort. Investigate cluster availability before proceeding.

### Step 2 — Create manual snapshot of current cluster

**Action.** Generate fresh manual snapshot immediately before cutover (per OQ-7 lock).

**Command.**

```powershell
$ts = Get-Date -Format 'yyyyMMddHHmmss'
$snapshotId = "sportscardportfolio-pre-encryption-migration-$ts"
aws rds create-db-cluster-snapshot `
  --db-cluster-identifier sportscardportfolio-databasecluster5b53a178-asr01cwjobbs `
  --db-cluster-snapshot-identifier $snapshotId `
  --region us-east-1
Write-Output "Snapshot ID: $snapshotId"
```

Then wait for status = `available`:

```powershell
do {
  Start-Sleep -Seconds 30
  $status = aws rds describe-db-cluster-snapshots --db-cluster-snapshot-identifier $snapshotId --region us-east-1 --query 'DBClusterSnapshots[0].Status' --output text
  Write-Output "$(Get-Date -Format 'HH:mm:ss') Snapshot status: $status"
} while ($status -eq 'creating')
```

**Verify.** `aws rds describe-db-cluster-snapshots --db-cluster-snapshot-identifier $snapshotId` returns `Status: available`, `StorageEncrypted: false` (unencrypted source preserved), `PercentProgress: 100`.

**Failure mode.** Snapshot stuck in `creating` >10 min OR fails → abort. Old cluster unchanged; investigate before any other step.

### Step 3 — Restore snapshot into new encrypted cluster

**Action.** Create new encrypted cluster from the manual snapshot using AWS-managed RDS KMS key (per OQ-1 lock).

**Command.**

```powershell
$ts = Get-Date -Format 'yyyyMMddHHmmss'
$newClusterId = "sportscardportfolio-encrypted-$ts"
aws rds restore-db-cluster-from-snapshot `
  --db-cluster-identifier $newClusterId `
  --snapshot-identifier $snapshotId `
  --engine aurora-postgresql `
  --engine-version 16.11 `
  --kms-key-id alias/aws/rds `
  --vpc-security-group-ids sg-0b3d904bcbdd307ab `
  --db-subnet-group-name sportscardportfolio-databaseclustersubnets5540150d-1l9befqursoc `
  --enable-http-endpoint `
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4.0 `
  --backup-retention-period 7 `
  --preferred-backup-window "07:00-07:30" `
  --copy-tags-to-snapshot `
  --region us-east-1
Write-Output "New cluster ID: $newClusterId"
```

Then wait for cluster status = `available` (typically 5–15 min):

```powershell
do {
  Start-Sleep -Seconds 30
  $status = aws rds describe-db-clusters --db-cluster-identifier $newClusterId --region us-east-1 --query 'DBClusters[0].Status' --output text
  Write-Output "$(Get-Date -Format 'HH:mm:ss') Cluster status: $status"
} while ($status -ne 'available')
```

**Verify.** `aws rds describe-db-clusters --db-cluster-identifier $newClusterId` returns:
- `Status: available`
- `StorageEncrypted: true`
- `KmsKeyId` set (the auto-provisioned `alias/aws/rds` key ARN)
- `Engine: aurora-postgresql`, `EngineVersion: 16.11`
- `HttpEndpointEnabled: true`
- VPC + subnet group + security group all match the old cluster

**Failure mode.** Restore fails → no impact on old cluster (still serving traffic). Investigate parameters (most likely cause: KMS key permissions, VPC misconfig, or engine-version mismatch). Retry. If repeated failure, abort and document.

### Step 4 — Add writer instance to new cluster

**Action.** Provision the Serverless v2 writer instance for the new cluster. The restore-from-snapshot creates the cluster but not its instances.

**Command.**

```powershell
$writerInstanceId = "$newClusterId-writer"
aws rds create-db-instance `
  --db-instance-identifier $writerInstanceId `
  --db-cluster-identifier $newClusterId `
  --db-instance-class db.serverless `
  --engine aurora-postgresql `
  --region us-east-1
```

Wait for instance status = `available`:

```powershell
do {
  Start-Sleep -Seconds 30
  $status = aws rds describe-db-instances --db-instance-identifier $writerInstanceId --region us-east-1 --query 'DBInstances[0].DBInstanceStatus' --output text
  Write-Output "$(Get-Date -Format 'HH:mm:ss') Instance status: $status"
} while ($status -ne 'available')
```

**Verify.** `describe-db-instances` returns `DBInstanceStatus: available`, `DBClusterIdentifier: $newClusterId`, `Engine: aurora-postgresql`, `DBInstanceClass: db.serverless`.

**Failure mode.** Instance creation fails → no impact on old cluster. Investigate (capacity, configuration). Retry.

### Step 5 — Data integrity check on new cluster

**Action.** Verify row counts on new cluster match Step 1 baseline. Use Data API against the NEW cluster (its HTTP endpoint is enabled per Step 3).

**Command.** Same query as Step 1 but targeting the new cluster's ARN:

```powershell
$newClusterArn = "arn:aws:rds:us-east-1:501789774892:cluster:$newClusterId"
aws rds-data execute-statement `
  --resource-arn $newClusterArn `
  --secret-arn "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM" `
  --database cardportfolio `
  --region us-east-1 `
  --sql "SELECT (SELECT COUNT(*) FROM cards) AS cards, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM consignments) AS consignments, (SELECT COUNT(*) FROM trades) AS trades, (SELECT COUNT(*) FROM card_shows) AS card_shows;"
```

Note: this uses the OLD secret ARN because the secret still contains the OLD cluster's credentials. The username/password are the same (snapshot inherits credentials); only the `host` field is wrong. The Data API accepts the credentials and connects to the cluster specified by `--resource-arn` (not the host in the secret), so this works for the verification query.

**Verify.** Every count identical to Step 1 baseline.

**Failure mode.** Any count mismatch → **STOP immediately**. Do not proceed to cutover. New cluster's data is suspect; old cluster still serves traffic. Investigate snapshot integrity, restore parameters, or potential interim writes to old cluster between Step 1 and Step 2.

### Step 6 — Secret cutover (the actual cutover moment)

**Action.** Update the existing secret value to point at the new cluster's endpoint, preserving the secret ARN (per OQ-6 lock).

**Command.**

```powershell
# Retrieve current secret structure
$currentSecret = aws secretsmanager get-secret-value `
  --secret-id "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM" `
  --region us-east-1 `
  --query 'SecretString' --output text | ConvertFrom-Json

# Fetch new cluster endpoint
$newEndpoint = aws rds describe-db-clusters --db-cluster-identifier $newClusterId --region us-east-1 --query 'DBClusters[0].Endpoint' --output text

# Construct new secret JSON with new host, all other fields preserved
$newSecret = @{
  username = $currentSecret.username
  password = $currentSecret.password
  engine   = $currentSecret.engine
  host     = $newEndpoint
  port     = $currentSecret.port
  dbname   = $currentSecret.dbname
  dbClusterIdentifier = $newClusterId
} | ConvertTo-Json -Compress

# Update the secret in-place (same ARN preserved)
aws secretsmanager put-secret-value `
  --secret-id "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM" `
  --secret-string $newSecret `
  --region us-east-1
```

**Verify.** `aws secretsmanager get-secret-value` shows the new `host` value (new cluster endpoint).

**Failure mode.** `put-secret-value` fails → no impact on Lambdas (they continue using cached pool against old cluster). Retry. Old cluster still serves traffic.

### Step 7 — Force Lambda cold-starts

**Action.** Force every Lambda to re-fetch the secret on its next invocation. The Pool singleton (`backend/functions/_db.js`) is module-level-cached across warm containers; only cold-starts repick the new secret value.

**Command.** Bump a benign env var via CDK to force Lambda version updates and container recycling:

```powershell
# Easiest: cdk deploy with a no-op or comment change to force a version bump on every Lambda
Set-Location C:\Users\Raheel\Desktop\sports-card-portfolio\infrastructure
npx cdk deploy --require-approval never
```

Alternative if no CDK change is queued: directly update an env var on each Lambda via `aws lambda update-function-configuration`. Less clean — prefer the CDK route.

**Verify.** After deploy completes, query `pg_stat_activity` on the NEW cluster:

```powershell
aws rds-data execute-statement `
  --resource-arn $newClusterArn `
  --secret-arn "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM" `
  --database cardportfolio `
  --region us-east-1 `
  --sql "SELECT DISTINCT application_name FROM pg_stat_activity WHERE application_name LIKE 'scp-%' ORDER BY application_name;"
```

Expected: at least one `scp-*` Lambda function name appearing post-cold-start. If none appears, exercise the app (load `/admin`) to trigger an invocation, then re-query.

**Failure mode.** Lambdas still hitting old cluster → check whether containers truly cold-started (CloudWatch Lambda Last Update timestamps). May need to force harder via `update-function-configuration --environment` bump per Lambda.

### Step 8 — End-to-end verification

**Action.** Confirm app health against new cluster via four independent checks.

**Verify (all four must pass):**

1. **/admin Total Value tile** — Load `https://collectorsreserve.co/admin` (or `https://dfsp491q2ndfx.cloudfront.net/admin`). Confirm Total Value reads **$58,302.87** (the `fixed_total` from commit `0ae510a`).
2. **Allen Iverson card detail** — Load the Allen Iverson card (ID `6e4b97fc-1260-4f66-ac1a-add28ed24685`). Confirm the "target hit" badge appears (validated end-to-end in commit `7e0924f`).
3. **`pg_stat_activity` on new cluster** — Multiple `scp-*` Lambda function names visible in `application_name` column.
4. **DescribeDBClusters on new cluster** — Returns `StorageEncrypted: true`, `KmsKeyId` set, `Status: available`.

**Failure mode.** Any check fails → trigger rollback per §6. Do not proceed to Step 9.

### Step 9 — Documentation updates

**Action.** Update doc cross-references to the new cluster identifier/ARN. Per ENGINEERING_STANDARDS §11, same commit chain as the surface change. **CDK source is NOT modified tonight** — engine version + encryption props additions are deferred to tomorrow's CDK takeover session per Path C scope cap.

**Edits:**

| File:Line | Update |
|---|---|
| `.agents/CONTEXT.md:49` | DB cluster identifier → new cluster ID |
| `.agents/CONTEXT.md:50` | DB cluster ARN → new ARN |
| `.agents/CONTEXT.md:77` | `DBClusterIdentifier` dimension value → new ID |
| `.agents/CONTEXT.md:892` | Data API command example `--resource-arn` → new ARN |
| `.agents/OPERATIONS.md:41` | Cluster identifier cell in §1 cluster-reference table → new ID |
| `.agents/OPERATIONS.md:74,84,101,118` | Four `--db-cluster-identifier` shell-command snippets → new ID |
| `.agents/OPERATIONS.md §1 Known gaps` | Replace "Encryption at rest is OFF" entry with current state; note that PITR-restore commands now include `--kms-key-id` (since new automated snapshots are encrypted) |
| `.agents/ROADMAP.md` Tech debt | Remove "RDS storage encryption migration" entry |
| `.agents/ROADMAP.md` Completed audits / one-time work | Append `2026-05-20: RDS storage encryption migration` entry with old/new cluster IDs, snapshot ID used, KMS key alias, deploy timing, verification chain summary, **explicit note that CDK takeover deferred** |
| `.agents/ROADMAP.md` Tech debt | **Add new entry: "CDK takeover for encrypted cluster (cdk import)"** — Size S (~1 hour), trigger "next session," rationale citing tonight's empirical schema verification (`aws cloudformation describe-type` returned `primaryIdentifier: /properties/DBClusterIdentifier`, `read` + `list` handlers, `ProvisioningType: FULLY_MUTABLE`), secret-handling pre-condition (verify or set `RemovalPolicy.RETAIN` on cluster secret BEFORE removing old cluster construct), multi-step `cdk import` flow (detach old construct + deploy, add new construct with exact-state properties, run `cdk import` with `--change-set-type IMPORT`, drift detection follow-up) |
| `.agents/ROADMAP.md` Tech debt | **Add new entry: "RDS encryption migration cleanup — decommission old (unencrypted) cluster"** — trigger 2026-05-27+ (7-day fallback window), Size S |
| `scripts/backfill-valuations.js:38` | Update `CLUSTER_ARN` constant to new ARN OR annotate as historical (operator preference at execute time) |

**Verify.** All cross-references updated. **No CDK source files modified.** Working tree shows only the docs files + optional script staged.

**Failure mode.** Skipped line / wrong file → operator review during diff-gate catches before commit.

### Step 10 — Single commit + push

**Action.** Stage docs + optional script changes (no CDK source files) into one commit with explicit IaC-drift naming.

**Files staged:**
- `.agents/CONTEXT.md`
- `.agents/OPERATIONS.md`
- `.agents/ROADMAP.md`
- `scripts/backfill-valuations.js` (if operator chose to update vs annotate)

**Subject:** `rds: migrate to encrypted storage via snapshot-restore — CDK takeover deferred`

**Body MUST include:**

1. **The IaC drift state explicitly named:**

   > CDK source describes the OLD cluster (`sportscardportfolio-databasecluster5b53a178-asr01cwjobbs`). The NEW cluster (`sportscardportfolio-encrypted-<timestamp>`) is serving traffic but is NOT in CDK management.

2. **Explicit guardrail:**

   > DO NOT run `cdk deploy` until CDK takeover ships per ROADMAP entry "CDK takeover for encrypted cluster (cdk import)". Doing so will trigger CFN to attempt creating a new cluster with the OLD cluster's identifier and fail — OR attempt to mutate the unencrypted-but-orphaned old cluster.

3. **Cross-references:**

   - This plan doc (`.agents/rds-encryption-migration-plan.md`)
   - The empirical import-support verification (CFN `describe-type` schema check, 2026-05-20)
   - The deferred-to-tomorrow ROADMAP entry "CDK takeover for encrypted cluster"
   - The 2026-05-27+ "RDS encryption migration cleanup — decommission old cluster" ROADMAP entry

4. **Standard items:**

   - Old cluster ID + ARN
   - New cluster ID + ARN
   - KMS key alias used (`alias/aws/rds`)
   - Snapshot ID used as the cutover source
   - Observed downtime window (Step 6 start → Step 8 verification pass)
   - Verification chain summary (the four Step 8 checks)
   - Reference to prior session commits (`b3fd8a0` backup retention, the §5.9 + §3 discipline commits from `9c3a3f6`, etc.)
   - Note that old cluster preserved per OQ-10 with separate ROADMAP entry for decommission

**Commit + push:**

```powershell
git add .agents/CONTEXT.md .agents/OPERATIONS.md .agents/ROADMAP.md
# Optionally also: git add scripts/backfill-valuations.js
git diff --cached --stat    # Diff-gate
git -c user.name="Raheel Mohiuddin" -c user.email="raheelmohiuddin@users.noreply.github.com" commit -m "<subject>" -m "<body>"
git push
```

**Verify.** Commit lands; push succeeds; `git status --short` returns clean.

### Step 11 — Final report

**Action.** Capture and report tonight's outcome.

**Report shape:**

- Commit SHA
- `git log --oneline -3`
- `git status --short` (must be clean)
- Explicit deliverable summary:
  - Tonight shipped: new encrypted cluster `<id>` serving traffic; old cluster `<id>` preserved as fallback; doc cross-references updated; CDK takeover deferred per ROADMAP
  - Tomorrow's bounded scope: `cdk import` flow per ROADMAP entry; ~1 hour fresh-headed
  - 7+ day fallback window before old-cluster decommission becomes eligible
- The success criteria from §7 confirmed

**Old cluster retention** (informational, no action tonight). Old cluster (`sportscardportfolio-databasecluster5b53a178-asr01cwjobbs`) stays running with `DeletionProtection: true` and `RemovalPolicy: RETAIN` as the fallback safety net. The new ROADMAP entry created in Step 9 carries the decommission trigger: **earliest 2026-05-27**. Decommission steps (separate future commit chain): (1) `aws rds modify-db-cluster --no-deletion-protection`, (2) `aws rds delete-db-instance` on the old writer, (3) `aws rds delete-db-cluster` with optional final snapshot. Cost-of-keeping-running: ~$1.50/day.

---

## 6. Rollback path

Triggers if Step 8 verification fails or any pre-cutover step surfaces unexpected state.

### 6.1 If failure occurs BEFORE Step 6 (secret cutover)

No rollback needed. New cluster, if created, can be deleted after disabling deletion protection (it has no protection by default since we didn't set it). Old cluster unchanged. Investigate and retry.

### 6.2 If failure occurs DURING or AFTER Step 6

Revert the secret pointer; force Lambda cold-starts back to old cluster.

**Sequence:**

1. **Revert secret value:**
   ```powershell
   $oldEndpoint = "sportscardportfolio-databasecluster5b53a178-asr01cwjobbs.cluster-c09wmeyucp38.us-east-1.rds.amazonaws.com"
   # Reconstruct secret JSON with old host (other fields unchanged):
   $rollbackSecret = @{
     username = $currentSecret.username
     password = $currentSecret.password
     engine = $currentSecret.engine
     host = $oldEndpoint
     port = $currentSecret.port
     dbname = $currentSecret.dbname
     dbClusterIdentifier = "sportscardportfolio-databasecluster5b53a178-asr01cwjobbs"
   } | ConvertTo-Json -Compress
   aws secretsmanager put-secret-value `
     --secret-id "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM" `
     --secret-string $rollbackSecret `
     --region us-east-1
   ```

2. **Force Lambda cold-starts** back to old cluster (same mechanism as Step 7 — bump env var or trivial cdk deploy).

3. **Verify rollback:**
   - `pg_stat_activity` against OLD cluster shows `scp-*` values returning.
   - /admin loads with expected Total Value.
   - Allen Iverson badge renders correctly.

4. **New cluster** stays running until investigation completes. Cost: ~$1.50/day. Decommission manually after root cause is identified.

---

## 7. Success criteria

All of the following must be true before the commit lands:

- `aws rds describe-db-clusters --db-cluster-identifier $newClusterId` returns `StorageEncrypted: true`, `KmsKeyId` set, `Status: available`.
- Row counts on new cluster match Step 1 baseline (cards, users, consignments, trades, card_shows).
- `https://collectorsreserve.co/admin` Total Value displays **$58,302.87**.
- Allen Iverson card (ID `6e4b97fc-1260-4f66-ac1a-add28ed24685`) shows "target hit" badge.
- `pg_stat_activity` on new cluster shows multiple `scp-*` Lambda function names in `application_name`.
- All doc cross-references (CONTEXT, OPERATIONS, ROADMAP, optionally scripts/backfill-valuations.js) updated in same commit.
- **Guardrail commit message explicitly names the CDK drift state and prohibits `cdk deploy` until takeover lands.**
- Single atomic commit landed, pushed, working tree clean.
- Old cluster preserved (not deleted), with new ROADMAP entry parking the decommission trigger at 2026-05-27+.
- ROADMAP entry "CDK takeover for encrypted cluster (cdk import)" added with Size S + trigger "next session" + linked context (empirical import verification, secret-handling pre-condition, multi-step flow).

---

## 8. Open items deferred

- **CDK takeover for encrypted cluster** — Tomorrow's session. `cdk import` flow per the multi-step sequence drafted during the plan-review discussion (preserved in conversation transcript): pre-condition secret retention, detach old cluster construct + deploy, add new construct with exact-state properties matching the new encrypted cluster, run `cdk import` (creates CFN change set with `--change-set-type IMPORT`), drift detection follow-up. Empirical verification of `AWS::RDS::DBCluster` import support completed 2026-05-20 (CFN type schema describe returned `primaryIdentifier: /properties/DBClusterIdentifier`, `read` + `list` handlers, `ProvisioningType: FULLY_MUTABLE`). **Secret-handling pre-condition:** verify or set `RemovalPolicy.RETAIN` on the cluster secret BEFORE removing the old cluster construct (otherwise the Lambda `DB_SECRET_ARN` env var's referent risks deletion). Time budget: ~1 hour fresh-headed. ROADMAP entry tracks the trigger.
- **Old cluster decommissioning** — New ROADMAP Tech debt entry created in Step 9. Trigger: 2026-05-27+ (7-day fallback window). Decommission sequence: (1) disable deletion protection on old cluster, (2) delete cluster instances, (3) delete cluster (with or without final snapshot). Cost-of-keeping-running: ~$1.50/day.
- **Custom RDS parameter group** — Existing ROADMAP Tech debt entry unchanged (per OQ-9 lock; not bundled with this migration). The new cluster inherits `default.aurora-postgresql16` just like the old one.
- **Engine version alignment** — Deferred to tomorrow's CDK takeover commit (OQ-11 revised lock). CDK source moves from `VER_16_4` to match actual `16.11` when the imported new cluster's CDK definition lands. No CDK source changes tonight.
- **Customer-managed KMS key migration** — Not relevant tonight or tomorrow. If compliance/PII/PHI requirements later require operator-controlled rotation, separate work-stream to create CMK + re-encrypt cluster (would require another snapshot-restore cycle).

---

## 9. Time budget

| Phase | Steps | Estimated time |
|---|---|---|
| Pre-cutover prep | 1, 2 | ~10 min |
| New cluster provision | 3, 4 | ~25 min (mostly AWS-side wait) |
| Pre-cutover verification | 5 | ~5 min |
| Cutover window (downtime) | 6, 7 | ~10 min |
| End-to-end verification | 8 | ~10 min |
| Docs (no CDK source changes) | 9 | ~20 min |
| Commit + push | 10 | ~10 min |
| Final report | 11 | ~5 min |
| **Steps 1-8 subtotal** | — | **~80 min** |
| **Nominal total (Steps 1-11)** | — | **~115 min** |
| **With variance budget** | — | **90–150 min** |

Wall-clock landing target: ~11:30 PM if started immediately, ~12:30 AM with variance.

The cutover window itself (Step 6 secret update → Step 8 verification pass) is the only operator-visible downtime. Realistic: 10–15 min during which warm Lambda containers may still hit the old cluster (no functional issue — both clusters are live and consistent at that instant) while new cold-starts hit the new cluster.

CDK takeover (~1 hour) lands in tomorrow's fresh-headed session per §8 deferral.

---

*Plan doc complete. Execute does not begin until this doc is committed.*
