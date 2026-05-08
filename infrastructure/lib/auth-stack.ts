import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

export class AuthStack extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // PostConfirmation trigger — stamps custom:role = "collector" on every
    // newly-confirmed account. Created BEFORE the user pool because the pool
    // references it via lambdaTriggers; CDK auto-grants Cognito invoke perms.
    // We grant cognito-idp:AdminUpdateUserAttributes back on the pool ARN
    // after pool creation (chicken-and-egg → use addToRolePolicy below).
    const postConfirmationFn = new NodejsFunction(this, "PostConfirmation", {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      functionName: "scp-post-confirmation",
      entry: path.join(__dirname, "../../backend/functions/auth/post-confirmation.js"),
      bundling: { minify: false, sourceMap: false, target: "node20" },
    });

    // V3 — Cognito refuses schema attribute updates (preferred_username
    // required: true → false), so we recreate the pool. Old V2 pool kept
    // alive per the removalPolicy and lives on as an orphan.
    //
    // customAttributes is an ADDITIVE schema change in CloudFormation —
    // adding `role` does NOT trigger pool replacement (modifying an existing
    // attribute would). The same is true for adding/changing lambdaTriggers.
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
      // custom:role — "collector" (default for self-signups, set by trigger)
      // or "admin" (assigned manually via Cognito console / admin UI).
      // Mutable so admins can be promoted; never writeable by the client app
      // (writeAttributes below excludes it).
      customAttributes: {
        role: new cognito.StringAttribute({ minLen: 1, maxLen: 20, mutable: true }),
      },
      lambdaTriggers: {
        postConfirmation: postConfirmationFn,
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

    // Allow the trigger to write back into the pool. CDK's `lambdaTriggers`
    // wires Cognito → Lambda (invoke); this is the reverse direction.
    //
    // We CANNOT use `this.userPool.userPoolArn` here — it produces a CFN
    // ref to the pool, and combined with the pool's own ref to this Lambda
    // (via lambdaTriggers) you get a circular dependency that CloudFormation
    // refuses to resolve. The wildcard ARN below is a constructed string
    // (no CFN ref) and limits the policy to user pools in this account /
    // region — the trigger only ever needs to touch the pool that invoked it,
    // and the trigger event itself carries the userPoolId, so the wildcard
    // is just for IAM evaluation, not for runtime selection.
    const stack = cdk.Stack.of(this);
    postConfirmationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminUpdateUserAttributes"],
        resources: [`arn:aws:cognito-idp:${stack.region}:${stack.account}:userpool/*`],
      })
    );

    // readAttributes includes custom:role so it lands in the JWT id token —
    // the frontend reads it via fetchUserAttributes() and the API uses the
    // claim for admin guards. writeAttributes deliberately OMITS custom:role
    // so a compromised/curious client can't promote itself to admin.
    const readAttrs = new cognito.ClientAttributes()
      .withStandardAttributes({
        email: true, emailVerified: true,
        givenName: true, familyName: true,
        preferredUsername: true,
      })
      .withCustomAttributes("role");
    const writeAttrs = new cognito.ClientAttributes()
      .withStandardAttributes({
        email: true,
        givenName: true, familyName: true,
        preferredUsername: true,
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
      readAttributes:  readAttrs,
      writeAttributes: writeAttrs,
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
