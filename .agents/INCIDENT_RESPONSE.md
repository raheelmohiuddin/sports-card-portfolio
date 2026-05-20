# INCIDENT_RESPONSE — Collector's Reserve

> Incident-response reference for severity classification, first-
> response actions, communication, and post-incident review.
> Created during P0 Hardening Session A (commit chain landing
> 2026-05-20) so the 9 alarms shipping in
> [infrastructure/lib/monitoring-stack.ts](../infrastructure/lib/monitoring-stack.ts)
> map to documented response procedures, per
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §11.
>
> §1 is populated — directly forced by the alarm definitions in
> Session A Commit 3. §§2–4 are skeleton stubs with "Known gaps to
> cover here" pointers; their full content is parked until
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §12's
> trigger fires (first non-Raheel user OR first real production
> incident, whichever first). Do not fill speculatively.

This doc is the "what to do *during an incident*" reference.
Operational procedures for everyday work (silencing alarms,
managing subscribers, smoke-testing the path) live in
[OPERATIONS.md](./OPERATIONS.md). Architectural facts live in
[CONTEXT.md](./CONTEXT.md); workflow conventions live in
[ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md).

**Update rule.** Amend this doc in the same commit as any change
that breaks one of its classifications or establishes a new
response convention worth codifying. Follows
[ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §11.

---

## 1. Severity classification

This section maps each of the 9 alarms deployed in Session A
Commit 3 to one of three severity tiers, and gives the operator's
first investigative move per alarm. The tier labels are
*classification* — what kind of issue the alarm represents.
Response-time policy ("how soon must you act on Sev-1?") belongs
in §2 First-response actions (TODO). At current single-operator
scale, all alarms route to one inbox with no escalation path —
see [OPERATIONS.md §4 On-call basics](./OPERATIONS.md) for the
paired known gap.

### Tier definitions

- **Sev-1 critical** — Active service degradation, outage, or
  imminent data risk. User-facing or production-state integrity
  affected.
- **Sev-2 warning** — Capacity headroom or sustained anomaly. No
  immediate user impact but trend suggests intervention before
  degradation.
- **Sev-3 advisory** — Anomalous pattern worth investigating but
  no operational urgency. Investigate during normal work cadence.

### Severity table

| Tier | Alarm name | Trigger condition |
|---|---|---|
| Sev-1 critical | `Lambda-Errors-Aggregate` | `Errors` Sum > 5 in 5min |
| Sev-1 critical | `Lambda-Throttles-Aggregate` | `Throttles` Sum > 0 in 5min |
| Sev-1 critical | `RDS-FreeableMemory-Low` | `FreeableMemory` Average < 100 MiB over 10min |
| Sev-1 critical | `HttpApi-5xx-High` | `5xx` Sum > 5 in 5min |
| Sev-2 warning | `RDS-CPU-High` | `CPUUtilization` Average > 80% over 10min |
| Sev-2 warning | `RDS-Connections-High` | `DatabaseConnections` Average > 80 in 5min |
| Sev-2 warning | `RDS-ACU-NearMax` | `ACUUtilization` Average > 87.5% over 10min |
| Sev-2 warning | `HttpApi-Latency-High` | `Latency` p99 > 3000 ms over 10min |
| Sev-3 advisory | `HttpApi-4xx-High` | `4xx` Sum > 50 in 5min |

Total: 4 Sev-1 + 4 Sev-2 + 1 Sev-3 = 9. Matches the deployed alarm
inventory and [OPERATIONS.md §2](./OPERATIONS.md) bijectively.

**Sev-1 rationale.** The four Sev-1 alarms all indicate either
active user-facing failure (`Lambda-Errors-Aggregate`,
`HttpApi-5xx-High`), capacity exhaustion at the request layer
(`Lambda-Throttles-Aggregate`), or terminal-state DB capacity
where Aurora may stall writes (`RDS-FreeableMemory-Low`).

**Sev-2 rationale.** The four Sev-2 alarms indicate pre-terminal
capacity pressure (`RDS-CPU-High`, `RDS-Connections-High`,
`RDS-ACU-NearMax`) or visible performance degradation that isn't
yet failure (`HttpApi-Latency-High`). Trend matters; immediate
user impact is bounded.

**Sev-3 rationale.** `HttpApi-4xx-High` is the only Sev-3 because
4xx responses are predominantly client-side noise (bots scanning
auth-required routes, expired Cognito tokens, misconfigured
clients) and rarely indicate a Collector's Reserve fault. Worth
watching for patterns; not worth waking anyone up.

### Alarm interpretations

Technical context (threshold rationale, metric semantics,
FreeableMemory-vs-ACU non-redundancy explanation) lives in
[OPERATIONS.md §2](./OPERATIONS.md). This subsection focuses on
the operator's first investigative move when an email arrives.

Listed in the same order as
[OPERATIONS.md §2 alarm inventory](./OPERATIONS.md) for
cross-reference parity.

- **`Lambda-Errors-Aggregate`** (Sev-1) — Lambda function(s)
  returning errors at >5/5min. First move: identify which
  function via CloudWatch Logs Insights across `/aws/lambda/scp-*`
  log groups for the last 15 minutes. The alarm doesn't pinpoint
  the function (aggregate dimension per OQ-1).

- **`Lambda-Throttles-Aggregate`** (Sev-1) — At least one Lambda
  invocation was throttled. First move: list throttled functions
  via `aws cloudwatch get-metric-statistics` filtered by the
  `FunctionName` dimension; check whether the spike is real
  traffic, a runaway recursive invocation, or account-wide
  concurrency exhaustion (default limit: 1000).

- **`RDS-CPU-High`** (Sev-2) — Aurora cluster CPU sustained above
  80% for two consecutive 5-min windows. First move: open RDS
  Performance Insights for the cluster and identify the top-SQL
  by CPU. Common culprit: a missing index forcing a sequential
  scan, or a long-running ad-hoc query against a large table.

- **`RDS-Connections-High`** (Sev-2) — Connection count averaged
  above 80 in a 5-min window. First move: query
  `pg_stat_activity` via the RDS Data API to enumerate active
  connections by `client_addr`, `state`, `query_start`, and
  `state_change`. (If `application_name` were set by our
  connection layer in
  [backend/functions/_db.js](../backend/functions/_db.js) it would
  identify the calling Lambda; we don't currently set it — see
  [ROADMAP.md](./ROADMAP.md) tech debt entry for the gap. Without
  it, identify the calling Lambda by correlating `client_addr`
  (NAT-gateway IPs) and timing with CloudWatch invocation
  metrics.) Suspect a connection-pool leak (Lambdas not closing
  connections in `finally` blocks) or a cold-start burst opening
  fresh connections faster than they idle out.

- **`RDS-FreeableMemory-Low`** (Sev-1) — Cluster has scaled to max
  ACU AND physical memory is near-exhausted. First move: confirm
  `RDS-ACU-NearMax` fired earlier (expected sequence — see
  [OPERATIONS.md §2](./OPERATIONS.md) on the non-redundancy
  between the two). If it didn't, the cluster jumped from
  comfortable to terminal in one window — anomalous; investigate
  query patterns via Performance Insights for memory-heavy
  operations (large hash joins, sorts spilling to disk).

- **`RDS-ACU-NearMax`** (Sev-2) — Cluster running at ~3.5 of 4
  ACU. First move: determine whether load is sustained (>15 min)
  or burst. Sustained → bump `serverlessV2MaxCapacity` in
  `infrastructure/lib/database-stack.ts` and deploy. Burst →
  investigate the triggering workload and consider caching or
  query optimization before raising the ceiling.

- **`HttpApi-5xx-High`** (Sev-1) — API Gateway returned >5 5xx
  responses in a 5-min window. First move: correlate with
  `Lambda-Errors-Aggregate` — they often share a root cause at
  different metric layers. Break down by route via CloudWatch
  Metrics (`ApiId` + `Route` dimensions) to identify the failing
  endpoint. 504 Gateway Timeout often indicates a Lambda
  integration exceeding the 29-second API Gateway timeout.

- **`HttpApi-4xx-High`** (Sev-3) — >50 4xx responses in a 5-min
  window. First move: identify which status code (401, 403, 404,
  422) dominates and which route is hit. Common causes: bots
  scanning auth-required routes (401/403), a recent backend
  change that broke contract with the deployed frontend (422), or
  expired Cognito tokens flooding sign-in retries. If pattern
  matches one of those, no action needed beyond noting it.

- **`HttpApi-Latency-High`** (Sev-2) — p99 latency above 3000 ms
  over a 10-min window. First move: break down by route via
  CloudWatch Metrics; compare `IntegrationLatency` against the
  total `Latency` to isolate Lambda-side slowness vs API Gateway
  overhead. Common causes: a cold-start cascade (Lambda cold-start
  + RDS connection establishment), a slow DB query, or an upstream
  third-party API call timing out (PSA, CardHedger).

### Cross-references

- **What to do operationally** —
  [OPERATIONS.md §2](./OPERATIONS.md) for silencing, subscriber
  management, smoke-testing.
- **What exists** — [CONTEXT.md](./CONTEXT.md) alarm inventory
  subsection (lands in Session A Commit 6).
- **Infrastructure source** —
  [infrastructure/lib/monitoring-stack.ts](../infrastructure/lib/monitoring-stack.ts).
- **Severity locks** —
  [.agents/p0-hardening-session-a-plan.md](./p0-hardening-session-a-plan.md)
  §8 OQ-2 (alarm + threshold + severity table).

---

## 2. First-response actions

> **Status:** TODO. Triggers from
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §12 —
> before first non-Raheel user OR after first real production
> incident, whichever first.

**Known gaps to cover here:**

- Response-time policy per severity tier (Sev-1: respond within
  X minutes; Sev-2: within X hours; Sev-3: next business day).
  Paired with [OPERATIONS.md §4 On-call basics](./OPERATIONS.md)
  — these two TODO sections fill together.
- Investigation playbooks per alarm — exact CloudWatch Logs
  Insights queries, Performance Insights views to open, common
  false-positives that don't warrant action.
- Escalation paths once a second contributor joins. Currently
  N/A — single operator, no escalation.
- Acknowledgment workflow without resolution. CloudWatch has no
  native "ack" — convention TBD; one option is manual
  `set-alarm-state` with a `<operator>-investigating` reason,
  noting per [OPERATIONS.md §2](./OPERATIONS.md) that the reason
  text auto-overwrites within ~30 seconds.

---

## 3. Communication

> **Status:** TODO before first non-Raheel user. Trigger from
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §12.

**Known gaps to cover here:**

- Stakeholder notification protocol — who, when, by what channel
  (email, status page, in-app banner). Currently no stakeholders
  beyond the operator.
- Customer-facing incident messaging — voice and transparency
  conventions, post-resolution follow-up cadence.
- Internal coordination channel — N/A at single-operator scale;
  revisit when team grows.

---

## 4. Post-incident review

> **Status:** TODO after first incident. Trigger from
> [ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §12.

**Known gaps to cover here:**

- Post-mortem template — root cause, contributing factors,
  timeline, action items.
- Blameless review conventions — what we record, what we
  deliberately don't.
- Action-item tracking — how items flow from post-mortem into
  [ROADMAP.md](./ROADMAP.md) (tech debt) or directly into
  follow-on commits.
- Pattern recognition over time — when individual incidents
  reveal systemic issues worth elevating to
  [ENGINEERING_STANDARDS.md §5](./ENGINEERING_STANDARDS.md)
  anti-patterns.

---

*Doc complete — see
[ENGINEERING_STANDARDS.md](./ENGINEERING_STANDARDS.md) §13 for
the evolution rules that govern amendments.*
