// Cognito PostConfirmation trigger.
//
// Fires once after a user confirms their email. We use it to stamp every new
// account with custom:role = "collector". The client app deliberately CANNOT
// write custom:role (it's not in the user-pool client's writeAttributes), so
// this trigger is the only path a collector role ever gets set — and admin
// promotion happens out-of-band (Cognito console, or a future admin UI).
//
// AdminUpdateUserAttributes is idempotent; no-op if the role is already set.
// Errors are logged but NEVER thrown — Cognito will block the user's sign-in
// if this Lambda fails, and a missing custom:role isn't worth that. The
// fallback DB lookup in _admin.js handles tokens without the claim.
const {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const cognito = new CognitoIdentityProviderClient({});

exports.handler = async (event) => {
  try {
    const existing = event.request?.userAttributes?.["custom:role"];
    if (existing) return event;

    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        UserAttributes: [{ Name: "custom:role", Value: "collector" }],
      })
    );
  } catch (err) {
    console.error("post-confirmation: failed to set custom:role", err);
  }
  return event;
};
