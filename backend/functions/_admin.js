// Admin authorisation helper.
//
// Primary check: the signed `custom:role` claim from the JWT. Fast path —
// no extra calls. Cognito signs the token so the claim can't be forged.
//
// Fallback: when the claim isn't "admin", we fetch the user's attributes
// LIVE from Cognito via AdminGetUser. This is critical because:
//   1. A user promoted to admin via the Cognito console has the same
//      JWT they got when they signed in as a collector — the token is
//      frozen at issue time, so their `custom:role` claim still reads
//      "collector" until the token expires (≤1h) and they sign in again.
//   2. We don't want to require sign-out → sign-in just to apply a role
//      change. The Cognito round-trip costs ~50–100ms and only runs on
//      the slow path (non-admin claim), so the fast path stays fast.
//
// Any caller that isn't conclusively admin gets 403 — never 401 — so we
// don't leak the existence of admin endpoints to merely-authenticated users.
const { json } = require("./_response");
const {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;

async function requireAdmin(event, _db) { // _db kept for API parity with prior version
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return { error: json(401, { error: "Unauthorized" }) };

  const claimRole = claims["custom:role"];
  if (claimRole === "admin") return { claims };

  // Slow path — JWT claim isn't admin. Could be a stale token from before
  // a console promotion, OR a token issued before custom:role was added to
  // the client's readAttributes (in which case the claim isn't in the JWT
  // at all). Verify against live Cognito attributes.
  //
  // AdminGetUser's `Username` parameter expects the user pool's actual
  // username (the value in `cognito:username`), NOT the immutable `sub`.
  // Our signup flow generates a synthetic username like `u-{uuid}`, so sub
  // and cognito:username are different values for every account.
  const username = claims["cognito:username"];
  if (USER_POOL_ID && username) {
    try {
      const res = await cognito.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      }));
      const liveRole = res.UserAttributes?.find((a) => a.Name === "custom:role")?.Value;
      if (liveRole === "admin") return { claims };
    } catch (err) {
      console.error("admin-guard: AdminGetUser failed", err);
    }
  }

  return { error: json(403, { error: "Forbidden" }) };
}

module.exports = { requireAdmin };
