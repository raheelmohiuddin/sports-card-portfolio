const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { Pool } = require("pg");

const smClient = new SecretsManagerClient({});
let pool;

async function getPool() {
  if (pool) return pool;

  const secret = await smClient.send(
    new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN })
  );
  const { username, password, host, port } = JSON.parse(secret.SecretString);

  pool = new Pool({
    host,
    port: parseInt(port, 10),
    database: process.env.DB_NAME,
    user: username,
    password,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
  });

  return pool;
}

// Upsert a user row from Cognito claims, returning the internal user UUID.
// Also keeps given_name / family_name in sync with whatever Cognito has —
// admin views need first/last for display, and the JWT carries them on every
// request so we get fresh data without an extra Cognito API call. We do NOT
// touch `role` here: role is set exclusively by the post-confirmation trigger
// on signup, and by admin promotion thereafter, so this code path can never
// accidentally downgrade an admin back to collector.
async function ensureUser(db, sub, email, givenName = null, familyName = null) {
  const result = await db.query(
    `INSERT INTO users (cognito_sub, email, given_name, family_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cognito_sub) DO UPDATE
       SET email       = EXCLUDED.email,
           given_name  = COALESCE(EXCLUDED.given_name,  users.given_name),
           family_name = COALESCE(EXCLUDED.family_name, users.family_name)
     RETURNING id`,
    [sub, email, givenName, familyName]
  );
  return result.rows[0].id;
}

// Resolve the role for a Cognito sub. Admin endpoints fall back to the DB
// row when the JWT claim is missing (older tokens issued before custom:role
// was added to the client's read attributes won't carry the claim).
async function getUserRole(db, sub) {
  const result = await db.query(
    `SELECT role FROM users WHERE cognito_sub = $1`,
    [sub]
  );
  return result.rows[0]?.role ?? null;
}

module.exports = { getPool, ensureUser, getUserRole };
