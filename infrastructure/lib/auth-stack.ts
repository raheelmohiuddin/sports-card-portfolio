import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export class AuthStack extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // V3 — Cognito refuses schema attribute updates (preferred_username
    // required: true → false), so we recreate the pool. Old V2 pool kept
    // alive per the removalPolicy and lives on as an orphan.
    this.userPool = new cognito.UserPool(this, "UserPoolV3", {
      userPoolName: "sports-card-portfolio-users",
      selfSignUpEnabled: true,
      // Both email and preferred_username are accepted as sign-in identifiers.
      // Cognito requires username:true when preferredUsername is enabled
      // (the preferred_username acts as an alias on top of the primary username).
      signInAliases: { username: true, email: true, preferredUsername: true },
      autoVerify: { email: true },
      standardAttributes: {
        email:             { required: true, mutable: true },
        givenName:         { required: true, mutable: true },
        familyName:        { required: true, mutable: true },
        // preferred_username is an alias — Cognito refuses values for alias
        // attributes during signUp ("cannot be provided for unconfirmed
        // account"). Marked NOT required so signUp succeeds; user picks it
        // post-confirmation via updateUserAttributes on UsernameSetupPage.
        preferredUsername: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // MFA — TOTP via authenticator apps (Google Authenticator, Authy, 1Password, etc.).
      // OPTIONAL means users can opt in; switch to REQUIRED to force enrollment.
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: "sports-card-web",
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: { implicitCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    this.userPoolId = this.userPool.userPoolId;
    this.userPoolClientId = this.userPoolClient.userPoolClientId;

    new cdk.CfnOutput(this, "UserPoolId", { value: this.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: this.userPoolClientId });
  }
}
