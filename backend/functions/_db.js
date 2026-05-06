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
async function ensureUser(db, sub, email) {
  const result = await db.query(
    `INSERT INTO users (cognito_sub, email)
     VALUES ($1, $2)
     ON CONFLICT (cognito_sub) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [sub, email]
  );
  return result.rows[0].id;
}

module.exports = { getPool, ensureUser };
