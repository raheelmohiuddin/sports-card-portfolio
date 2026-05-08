// Migration: card_shows.daily_times JSONB.
//
// Per-day schedule for multi-day shows. Each entry is an object:
//   { date: "YYYY-MM-DD", startTime: "9:00 AM", endTime: "5:00 PM" }
// Single-day shows store either a single-element array or NULL — the
// frontend treats both as equivalent ("just use show.startTime /
// show.endTime"). When a multi-day run has differing times across
// days the frontend reads from daily_times to display the right
// schedule for the day the user clicked.
//
// Idempotent.
//   aws lambda invoke --function-name scp-migration-add-daily-times --region us-east-1 out.json
const { getPool } = require("../_db");

exports.handler = async () => {
  const db = await getPool();
  await db.query("ALTER TABLE card_shows ADD COLUMN IF NOT EXISTS daily_times JSONB");
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, message: "daily_times column ensured" }),
  };
};
