# scripts/

Operational scripts run locally against the live AWS environment. Not
deployed to Lambda; not bundled with the frontend. Each script is
standalone Node and shells out to the AWS CLI for AWS calls (no SDK
install required).

## `backfill-valuations.js`

One-time backfill for the valuation rebuild
(`.agents/valuation-rebuild-plan.md` §6). Walks every card with a
`cert_number`, runs the new 4-endpoint flow (prices-by-cert →
card-details → comps → price-estimate), prints a per-card report, and
applies an `UPDATE` only after explicit `y/n` approval per card.

### Prereqs

- Node 18+ (uses built-in `fetch`).
- AWS CLI authenticated against account `501789774892` with permissions
  for `secretsmanager:GetSecretValue` and `rds-data:ExecuteStatement`.
- DB migration `0002_valuation_rebuild.sql` applied.
- Lambda code from commit 2/3/3a deployed (so the columns this script
  writes match the live write paths).
- Pre-run safety snapshot (run in RDS Query Editor):

  ```sql
  CREATE TABLE cards_pre_backfill AS SELECT * FROM cards;
  ```

  Drop it after a few days of stable runtime:

  ```sql
  DROP TABLE cards_pre_backfill;
  ```

### Run

```bash
node scripts/backfill-valuations.js
```

The script is interactive. For each card it prints the current DB row
+ what the new flow would write, then prompts `[y/n/q]`:

- `y` → applies the UPDATE
- `n` → skips
- `q` → exits the script (already-applied updates remain)

### Output

Every decision is appended to `scripts/backfill-logs/<ISO>.json` as
the script runs (so a mid-run crash still leaves an audit trail). Each
entry records the cert, the decision, and (for `applied`) the before/
after values for cardhedger_id, variant, estimate_price, confidence,
and method.
