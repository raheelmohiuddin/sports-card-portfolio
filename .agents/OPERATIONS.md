# OPERATIONS — Collector's Reserve

> Operational reference for backup, recovery, monitoring, and
> alerting. Created during P0 Hardening Session A (commit chain
> landing 2026-05-20) to ship alongside the alarm and
> backup-retention surfaces it describes, per
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §11
> (documenting surface lands in the same commit chain as the
> documented surface).
>
> §§1–2 are populated. §§3–5 are skeleton stubs with a
> "Known gaps to cover here" pointer; their full content is parked
> until [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §12's
> trigger fires (first non-Raheel user). Do not fill speculatively.

This doc is the "what to do" reference for operational tasks on
this codebase. The companion doc
[INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md) (created in Session
A Commit 5) handles "what to do *during an incident*."
Architectural facts live in [CONTEXT.md](./CONTEXT.md); workflow
conventions live in
[ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md).

**Update rule.** Amend this doc in the same commit as any change
that breaks one of its procedures or establishes a new procedure
worth codifying. Follows
[ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §11.

---

## 1. Backup and recovery

Aurora Serverless v2 PostgreSQL cluster, single writer instance,
RDS automated backups + point-in-time recovery (PITR). No manual
snapshots, no cross-region replication, no read replicas.

### Cluster reference

| Field | Value |
|---|---|
| Cluster identifier | `sportscardportfolio-databasecluster5b53a178-asr01cwjobbs` |
| Region | `us-east-1` |
| AWS account | `501789774892` |
| Engine | Aurora PostgreSQL 16.4 |
| Capacity range | 0.5 – 4 ACU (Serverless v2) |
| Encryption at rest | **OFF** — see Known gaps below |

Full architectural detail in [CONTEXT.md](./CONTEXT.md) §2.

### Automated backups

| Setting | Value |
|---|---|
| Retention | 7 days |
| Preferred backup window | 07:00–07:30 UTC (= 02:00–02:30 US Central / 03:00–03:30 ET) |
| Maintenance window | `sat:06:18-sat:06:48` UTC (AWS auto-assigned) |

Retention bumped from the AWS default (1 day) → 7 days in commit
`b3fd8a0` (Session A Commit 2, 2026-05-20). PITR coverage widens
automatically as the new retention accumulates: the full 7-day
window is available 7 days after the retention bump deployed.

**Warning — backup window and maintenance window must not
overlap.** RDS rejects ANY overlap between the two windows at the
configuration layer, regardless of Aurora's runtime ability to
coexist them. Discovered during Session A Commit 2's first deploy
attempt — see
[.agents/p0-hardening-session-a-plan.md](./p0-hardening-session-a-plan.md)
§3.6 for the full discovery. Before changing either window, verify
zero overlap:

```powershell
aws rds describe-db-clusters `
  --db-cluster-identifier sportscardportfolio-databasecluster5b53a178-asr01cwjobbs `
  --region us-east-1 `
  --query 'DBClusters[0].[PreferredBackupWindow,PreferredMaintenanceWindow]' `
  --output table
```

Verify current backup retention + window match this doc:

```powershell
aws rds describe-db-clusters `
  --db-cluster-identifier sportscardportfolio-databasecluster5b53a178-asr01cwjobbs `
  --region us-east-1 `
  --query 'DBClusters[0].[BackupRetentionPeriod,PreferredBackupWindow]' `
  --output table
```

Expected: `7` and `07:00-07:30`.

### Point-in-time recovery (PITR)

PITR restores the cluster to a specific timestamp within the
retention window. The restore produces a *new* cluster — the
original is untouched. This is the right tool for "I need the
data as it was at 14:32 today, before the bad migration ran."

```powershell
aws rds restore-db-cluster-to-point-in-time `
  --source-db-cluster-identifier sportscardportfolio-databasecluster5b53a178-asr01cwjobbs `
  --db-cluster-identifier sportscardportfolio-pitr-restore-<short-tag> `
  --restore-to-time 2026-05-20T14:32:00Z `
  --region us-east-1
```

Use `--use-latest-restorable-time` instead of `--restore-to-time`
for the most recent available point. Once the new cluster is
`available`, point the application at it (CDK update or manual
cutover); the application doesn't auto-switch.

### Snapshot listing

Automated snapshots (the ones that back PITR):

```powershell
aws rds describe-db-cluster-snapshots `
  --db-cluster-identifier sportscardportfolio-databasecluster5b53a178-asr01cwjobbs `
  --snapshot-type automated `
  --region us-east-1 `
  --query 'DBClusterSnapshots[].[DBClusterSnapshotIdentifier,SnapshotCreateTime,Status]' `
  --output table
```

No manual snapshots currently exist. Create one with
`aws rds create-db-cluster-snapshot` if you need a long-lived
snapshot beyond the 7-day automated retention (e.g. pre-migration
safety net).

### Recovery expectations

| Objective | Value |
|---|---|
| RPO (recovery point objective) | ≤ 5 minutes from PITR granularity |
| RTO (recovery time objective) | Empirically TBD — first real restore becomes the baseline |

RPO is bounded by Aurora's transaction-log shipping cadence (PITR
granularity ~5 minutes). RTO depends on snapshot size + restore
target cluster provisioning time; on this 0.5-4 ACU cluster with a
small data footprint, expect 5–15 minutes, but the first real
restore is the data point that locks the number.

### Known gaps

- **Encryption at rest is OFF.** Aurora supports `StorageEncrypted`
  only at cluster creation; the live cluster was created with the
  default (false). Flipping requires snapshot →
  restore-to-new-encrypted-cluster → cutover — multi-hour migration
  with a downtime window. Parked in [ROADMAP.md](./ROADMAP.md)
  under Tech debt (lands in Session A Commit 6). Trigger to act:
  any PII/PHI scope expansion OR compliance requirement OR before
  first non-Raheel user. **Recovery procedures change once
  encryption ships** because restored snapshots inherit encryption
  from the source; PITR-restore commands will need additional
  KMS flags.
- **No cross-region replication.** Single-region (us-east-1). If
  us-east-1 has an extended outage, the cluster is unreachable
  until AWS recovers. Acceptable at current scale; revisit at
  multi-user load.

---

## 2. Monitoring and alerting

Nine CloudWatch alarms cover Lambda, RDS Aurora Serverless v2, and
HttpApi v2 surfaces. A single SNS topic with one email subscription
routes alerts to the operator. Alarm thresholds are conservative
defaults — tune after the first week of real traffic via separate
`monitoring: tune <alarm> threshold` commits per
[ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §6
atomicity.

### Alarm inventory

| Alarm name | Metric | Threshold | Eval (period × N) | Severity | Response |
|---|---|---|---|---|---|
| `Lambda-Errors-Aggregate` | `Errors` (AWS/Lambda) Sum | > 5 | 5min × 1 | Sev-1 critical | [IR §1](./INCIDENT_RESPONSE.md) |
| `Lambda-Throttles-Aggregate` | `Throttles` (AWS/Lambda) Sum | > 0 | 5min × 1 | Sev-1 critical | [IR §1](./INCIDENT_RESPONSE.md) |
| `RDS-CPU-High` | `CPUUtilization` (AWS/RDS) Average | > 80% | 5min × 2 | Sev-2 warning | [IR §1](./INCIDENT_RESPONSE.md) |
| `RDS-Connections-High` | `DatabaseConnections` (AWS/RDS) Average | > 80 | 5min × 1 | Sev-2 warning | [IR §1](./INCIDENT_RESPONSE.md) |
| `RDS-FreeableMemory-Low` | `FreeableMemory` (AWS/RDS) Average | < 100 MiB | 5min × 2 | Sev-1 critical | [IR §1](./INCIDENT_RESPONSE.md) |
| `RDS-ACU-NearMax` | `ACUUtilization` (AWS/RDS) Average | > 87.5% | 5min × 2 | Sev-2 warning | [IR §1](./INCIDENT_RESPONSE.md) |
| `HttpApi-5xx-High` | `5xx` (AWS/ApiGateway) Sum | > 5 | 5min × 1 | Sev-1 critical | [IR §1](./INCIDENT_RESPONSE.md) |
| `HttpApi-4xx-High` | `4xx` (AWS/ApiGateway) Sum | > 50 | 5min × 1 | Sev-3 advisory | [IR §1](./INCIDENT_RESPONSE.md) |
| `HttpApi-Latency-High` | `Latency` (AWS/ApiGateway) p99 | > 3000 ms | 10min × 1 | Sev-2 warning | [IR §1](./INCIDENT_RESPONSE.md) |

Lambda alarms are aggregate (no `FunctionName` dimension) per
[.agents/p0-hardening-session-a-plan.md](./p0-hardening-session-a-plan.md)
OQ-1. When one fires, identify the offending function via
CloudWatch Logs. Reversal trigger: first non-Raheel-user incident
where the aggregate alarm fires but log investigation takes >15
min to identify the failing Lambda.

`RDS-FreeableMemory-Low` and `RDS-ACU-NearMax` are *not* redundant.
On Serverless v2, `FreeableMemory` is inflated by ~2 GiB per spare
ACU below `serverlessV2MaxCapacity` (currently 4) — the metric only
approaches real physical free memory once the cluster has scaled
to max ACU. The two alarms fire in sequence (ACU-NearMax first as
warning; FreeableMemory-Low after, only if max ACU was
insufficient), not in parallel.

`HttpApi-*` alarms use the API Gateway HttpApi v2 metric names
(`5xx`, `4xx`, `Latency` — lowercase). Using v1 REST API names
(`5XXError`, etc.) against an HttpApi silently returns no data.

Source: alarm definitions in
[infrastructure/lib/monitoring-stack.ts](../infrastructure/lib/monitoring-stack.ts).
Authoritative inventory: [CONTEXT.md](./CONTEXT.md) alarm
inventory subsection (lands in Session A Commit 6).

### Treatment of missing data

All 9 alarms use `TreatMissingData.NOT_BREACHING`. Sparse counter
metrics (`Errors`, `Throttles`, `5xx`, `4xx`) only publish data
points when nonzero; treating missing as `MISSING` would leave
those alarms in `INSUFFICIENT_DATA` indefinitely during idle
periods, masking their signal. For continuous gauge metrics (the
RDS group + `Latency`), `NOT_BREACHING` is functionally equivalent
to `MISSING` during normal operation.

This is why an idle alarm can show `OK` (missing data treated as
not breaching) and a freshly-deployed alarm can show
`INSUFFICIENT_DATA` (no evaluation has run yet). Neither is a
fault.

Lock recorded in
[.agents/p0-hardening-session-a-plan.md](./p0-hardening-session-a-plan.md)
§8 OQ-2. Reversal trigger: first observed false-negative where a
real error condition coincided with missing-data treatment masking
the alarm.

### SNS notification path

A single SNS topic publishes alarm state transitions to email
subscribers. Same `SnsAction` reused across all 9 alarms.

#### Finding the topic ARN

The CloudFormation output key is hash-suffixed by CDK — do **not**
look up `MonitoringAlertTopicArn` (no match). Use a `contains()`
filter:

```powershell
aws cloudformation describe-stacks `
  --stack-name SportsCardPortfolio `
  --region us-east-1 `
  --query 'Stacks[0].Outputs[?contains(OutputKey, `AlertTopic`)].OutputValue' `
  --output text
```

Current ARN (verify via the command above if the stack has been
recreated):

```
arn:aws:sns:us-east-1:501789774892:SportsCardPortfolio-MonitoringAlertTopicB48B06C2-pnXUQDHo1pmd
```

#### Current subscribers

| Endpoint | Protocol | Source |
|---|---|---|
| `raheel4293@gmail.com` | email | Session A Commit 3 (OQ-4 lock) |

#### Adding a subscriber

```powershell
aws sns subscribe `
  --topic-arn <ARN from above> `
  --protocol email `
  --notification-endpoint <new-email> `
  --region us-east-1
```

**Critical sequencing.** The new subscriber receives an AWS SNS
confirmation email immediately. **No alarm notifications reach the
new endpoint until they click the confirmation link.** Any
`PendingConfirmation` subscription silently drops published alerts
— don't rely on a new subscriber until confirmation is verified:

```powershell
aws sns list-subscriptions-by-topic `
  --topic-arn <ARN> `
  --region us-east-1 `
  --query 'Subscriptions[].[Endpoint,SubscriptionArn]' `
  --output table
```

Expected for a confirmed subscriber: `SubscriptionArn` is a real
ARN, not the literal string `PendingConfirmation`.

#### Removing a subscriber

```powershell
aws sns unsubscribe `
  --subscription-arn <subscription ARN, NOT the topic ARN> `
  --region us-east-1
```

The subscription ARN comes from the `list-subscriptions-by-topic`
output above. Removal is immediate; no confirmation step.

### Silencing an alarm temporarily

`aws cloudwatch set-alarm-state` forces a state transition.
Useful for clearing a stuck `ALARM` state after a known-but-
resolved incident, or for muting an alarm during scheduled
maintenance.

```powershell
aws cloudwatch set-alarm-state `
  --alarm-name <name from inventory above> `
  --state-value OK `
  --state-reason "<why you're silencing — operator + date>" `
  --region us-east-1
```

**The reason text gets auto-overwritten** by CloudWatch's next
metric evaluation. Surfaced during Session A Commit 3 smoke-test:
the manually-set reason "smoke-test complete — return to OK" was
replaced by "Threshold Crossed: no datapoints were received for 1
period and 1 missing datapoint was treated as [NonBreaching]"
within 30 seconds. The state value (`OK` / `ALARM`) does persist;
only the reason text is ephemeral.

Audit trail of "who flipped this and why" lives in the commit
message or runbook entry that triggered the flip — not in the
alarm's `StateReason` field.

### Verifying the alarm path end-to-end

Reusable smoke-test for confirming alarm → SNS → email delivery
works after any change (new subscriber, IAM rework, region move,
post-disaster recovery, etc.). Use `Lambda-Errors-Aggregate` as
the test alarm — safe to flip and easy to interpret in the inbox.

```powershell
# 1. Confirm the target subscription is Confirmed (not Pending):
aws sns list-subscriptions-by-topic `
  --topic-arn <ARN> `
  --region us-east-1 `
  --query 'Subscriptions[].[Endpoint,SubscriptionArn]' `
  --output table

# 2. Flip the alarm to ALARM:
aws cloudwatch set-alarm-state `
  --alarm-name Lambda-Errors-Aggregate `
  --state-value ALARM `
  --state-reason "smoke-test YYYY-MM-DD <operator>" `
  --region us-east-1

# 3. Within ~30s, verify the alarm transitioned:
aws cloudwatch describe-alarms `
  --alarm-names Lambda-Errors-Aggregate `
  --region us-east-1 `
  --query 'MetricAlarms[0].[AlarmName,StateValue]' `
  --output table

# 4. Within 1-2 minutes, the SNS email arrives at the subscriber.
#    Subject: 'ALARM: "Lambda-Errors-Aggregate" in US East ...'

# 5. Return alarm to OK:
aws cloudwatch set-alarm-state `
  --alarm-name Lambda-Errors-Aggregate `
  --state-value OK `
  --state-reason "smoke-test reset" `
  --region us-east-1
```

The OK transition also publishes an SNS message — expected,
signals the alarm cycled fully.

Run the smoke-test after any change that could affect the
notification path. A quiet inbox after a real alarm fires is
harder to triage than catching a broken path during a smoke-test.

### Cost

$0/month at current scale. 9 alarms sit within the 10-alarm
CloudWatch free tier (us-east-1, standard resolution). SNS email
notifications cost ~$0.50 per million notifications + ~$2 per
100,000 emails — effectively zero at single-operator scale.
Crossing 10 total alarms in the account would shift to ~$0.10
per alarm per month for each additional standard-resolution
alarm. Review monthly via Cost Explorer if alarm count grows.
Pricing verified 2026-05-20.

### Cross-references

- **What exists** — [CONTEXT.md](./CONTEXT.md) alarm inventory
  subsection (lands in Session A Commit 6).
- **What to do during an incident** —
  [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md) (lands in Session
  A Commit 5). Severity classification + first-glance alarm
  interpretation live there.
- **Infrastructure source** —
  [infrastructure/lib/monitoring-stack.ts](../infrastructure/lib/monitoring-stack.ts).
- **Rollout history** —
  [.agents/p0-hardening-session-a-plan.md](./p0-hardening-session-a-plan.md)
  §6 Commit 3.

---

## 3. Deploy procedures

> **Status:** TODO before first non-Raheel user. Trigger from
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §12.

**Known gaps to cover here:**

- `cdk diff` is advisory only; for any non-trivial deploy, scope
  must be verified via `aws cloudformation describe-change-set` on
  a `--no-execute` change set. The rule and the evidence are
  codified in
  [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §5
  anti-pattern 8.
- The coordinated SQL + code deploy workflow (schema change +
  Lambda code touching that column) is codified in
  [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §7;
  reference and expand here when populating.
- Git-vs-deployed Lambda source drift detection is currently
  manual-only — no signal exists for "backend Lambda source has
  commits past the deployed asset hash." Manual `cdk deploy` +
  auto-Amplify-on-push can desync indefinitely. Parked tech-debt
  in [ROADMAP.md](./ROADMAP.md) (Session A Commit 6). Drift was
  discovered the hard way during Session A's cdk-diff gate — see
  [.agents/p0-hardening-session-a-plan.md](./p0-hardening-session-a-plan.md)
  §3.5.
- Frontend auto-deploys to Amplify on `git push` to master;
  backend deploys via explicit `cdk deploy`. The two paths can
  desync; the current operating convention is "frontend-first if
  the change is forward-compatible, backend-first otherwise" but
  needs written-down examples to lock.

---

## 4. On-call basics

> **Status:** TODO before first non-Raheel user. Trigger from
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §12.

**Known gaps to cover here:**

- Severity-tier response expectations (Sev-1 critical: respond
  within X minutes; Sev-2 warning: within X hours; Sev-3
  advisory: next business day). Currently nothing is on-call;
  alarms email the single operator with no escalation path.
- Rotation conventions if a second contributor joins. Right now,
  N/A.
- How to acknowledge an alarm without resolving it (CloudWatch
  has no native "ack" — convention TBD; possibly via manual
  `set-alarm-state` with a `<operator>-investigating` reason,
  noting the reason auto-overwrites per §2).
- Cross-reference to
  [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md) §2
  (first-response actions) — itself TODO.

---

## 5. Routine maintenance

> **Status:** TODO before first non-Raheel user. Trigger from
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §12.

**Known gaps to cover here:**

- CloudWatch Logs retention review — currently AWS-default (no
  expiration). Logs accumulate cost and clutter; periodic review
  or retention-policy-on-creation needed.
- IAM credential rotation — Cognito user pool, AWS access keys
  (none currently in use; Raheel uses local AWS profile), API
  keys for PSA / CardHedger upstreams.
- Backup retention review — re-evaluate the 7-day window
  quarterly; bump if PITR target windows grow.
- Aurora engine version updates — currently 16.4; minor version
  updates apply during the maintenance window automatically;
  major version updates require deliberate IaC change.
- Alarm threshold tuning — see §2 on conservative defaults;
  expect a weekly threshold sweep after first real traffic
  arrives.

---

*Doc complete — see
[ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §13 for the
evolution rules that govern amendments.*
